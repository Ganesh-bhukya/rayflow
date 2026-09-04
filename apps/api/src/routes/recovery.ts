import { Router } from "express";
import { randomUUID } from "crypto";
import { getPool } from "../config/database.js";
import {
  assertTransition,
} from "../services/paymentStateMachine.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| GET /recovery
|--------------------------------------------------------------------------
| Returns payment orders whose latest payment attempt has failed.
|--------------------------------------------------------------------------
*/

router.get("/", async (_req, res) => {
  const pool = getPool();

  try {
    /*
     * Get the latest attempt for every payment order.
     */
    const paymentsResult = await pool.query(`
      WITH latest_attempts AS (
        SELECT
          pa.id,
          pa.order_id,
          pa.payment_method,
          pa.status AS attempt_status,
          pa.failure_code,
          pa.created_at,

          ROW_NUMBER() OVER (
            PARTITION BY pa.order_id
            ORDER BY pa.created_at DESC
          ) AS row_number

        FROM public.payment_attempts pa
      )

      SELECT
        po.id AS order_id,
        po.amount,
        po.currency,
        po.status AS order_status,

        la.id AS attempt_id,
        la.payment_method,
        la.attempt_status,
        la.failure_code,
        la.created_at AS attempt_created_at

      FROM public.payment_orders po

      INNER JOIN latest_attempts la
        ON la.order_id = po.id
        AND la.row_number = 1

      WHERE
        la.attempt_status = 'failed'
        AND po.status <> 'paid'

      ORDER BY la.created_at DESC
    `);

    /*
     * Count successful payment transactions.
     */
    /*
 * Count successful payment orders.
 *
 * Recovery overview metrics are based on payment orders,
 * not individual transactions. This keeps successfulPayments
 * consistent with totalPayments.
 */
const successfulResult = await pool.query(`
  SELECT
    COUNT(*)::int AS successful_count,
    COALESCE(SUM(amount), 0)::bigint AS successful_amount

  FROM public.payment_orders

  WHERE
    status = 'paid'
`);

    const failedPayments =
      paymentsResult.rows.length;

    const totalRecoverable =
      paymentsResult.rows.reduce(
        (sum, payment) =>
          sum + Number(payment.amount),
        0,
      );

    const successfulPayments = Number(
      successfulResult.rows[0]
        ?.successful_count ?? 0,
    );

    const successfulAmount = Number(
      successfulResult.rows[0]
        ?.successful_amount ?? 0,
    );

    /*
     * Total payment orders.
     */
    const totalResult = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM public.payment_orders
    `);

    const totalPayments = Number(
      totalResult.rows[0]?.total ?? 0,
    );

    /*
     * Recovery rate.
     */
    const recoveryBase =
      successfulPayments + failedPayments;

    const recoveryRate =
      recoveryBase > 0
        ? Math.round(
            (successfulPayments /
              recoveryBase) *
              100,
          )
        : 0;

    /*
     * Failure reason counts.
     */
    const failureReasons: Record<
      string,
      number
    > = {};

    for (const payment of paymentsResult.rows) {
      const reason =
        payment.failure_code ??
        "UNKNOWN";

      failureReasons[reason] =
        (failureReasons[reason] ?? 0) + 1;
    }

    /*
     * Format response for frontend.
     */
    const payments =
      paymentsResult.rows.map(
        (payment) => ({
          orderId: payment.order_id,
          attemptId: payment.attempt_id,
          amount: Number(payment.amount),
          currency: payment.currency,
          paymentMethod:
            payment.payment_method,
          status: payment.attempt_status,
          failureCode:
            payment.failure_code,
          createdAt:
            payment.attempt_created_at,
        }),
      );

    return res.json({
      status: "ok",

      summary: {
        failedPayments,
        successfulPayments,
        totalRecoverable,
        successfulAmount,
        recoveryRate,
        totalPayments,
      },

      failureReasons,

      payments,
    });
  } catch (error) {
    console.error(
      "Recovery GET error:",
      error,
    );

    return res.status(500).json({
      status: "error",
      message:
        "Unable to load recovery data.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /recovery/:orderId/complete
|--------------------------------------------------------------------------
| Recover a failed payment.
|--------------------------------------------------------------------------
*/

router.post(
  "/:orderId/complete",
  async (req, res) => {
    const { orderId } = req.params;

    const pool = getPool();
    const client = await pool.connect();

    try {
      /*
       * ----------------------------------------------------
       * START DATABASE TRANSACTION
       * ----------------------------------------------------
       */
      await client.query("BEGIN");

      /*
       * ----------------------------------------------------
       * STEP 1
       * Lock the payment order.
       * ----------------------------------------------------
       */
      const orderResult =
        await client.query(
          `
          SELECT
            id,
            amount,
            currency,
            status

          FROM public.payment_orders

          WHERE id = $1

          FOR UPDATE
          `,
          [orderId],
        );

      /*
       * Order does not exist.
       */
      if (
        orderResult.rows.length === 0
      ) {
        await client.query(
          "ROLLBACK",
        );

        return res.status(404).json({
          status: "error",
          message:
            "Payment order not found.",
        });
      }

      const order =
        orderResult.rows[0];

      /*
       * Never recover an already-paid order.
       */
      if (order.status === "paid") {
        await client.query(
          "ROLLBACK",
        );

        return res.status(409).json({
          status: "error",
          message:
            "Payment order is already paid.",
        });
      }

      /*
       * ----------------------------------------------------
       * STEP 2
       * Find and lock the latest payment attempt.
       * ----------------------------------------------------
       */
      const attemptResult =
        await client.query(
          `
          SELECT
            id,
            order_id,
            payment_method,
            status,
            failure_code,
            created_at

          FROM public.payment_attempts

          WHERE order_id = $1

          ORDER BY created_at DESC

          LIMIT 1

          FOR UPDATE
          `,
          [orderId],
        );

      /*
       * No attempt exists.
       */
      if (
        attemptResult.rows.length === 0
      ) {
        await client.query(
          "ROLLBACK",
        );

        return res.status(400).json({
          status: "error",
          message:
            "No payment attempt exists for this order.",
        });
      }

      const attempt =
        attemptResult.rows[0];

      /*
       * Already successful.
       */
      if (attempt.status === "success") {
        await client.query(
          "ROLLBACK",
        );

        return res.status(409).json({
          status: "error",
          message:
            "This payment has already been recovered.",
        });
      }

      /*
       * Only failed payments can start recovery.
       */
      if (attempt.status !== "failed") {
        await client.query(
          "ROLLBACK",
        );

        return res.status(400).json({
          status: "error",
          message:
            "Only failed payments can be recovered.",
          currentStatus:
            attempt.status,
        });
      }

      /*
       * ----------------------------------------------------
       * STEP 3
       * State machine validation:
       *
       * failed -> processing
       * ----------------------------------------------------
       */
      assertTransition(
        attempt.status,
        "processing",
      );

      /*
       * Move the failed attempt into
       * processing before recovery.
       */
      await client.query(
        `
        UPDATE public.payment_attempts

        SET
          status = 'processing'

        WHERE id = $1
        `,
        [attempt.id],
      );

      /*
       * ----------------------------------------------------
       * STEP 4
       * State machine validation:
       *
       * processing -> success
       *
       * In this RayFlow simulation,
       * recovery succeeds immediately.
       * ----------------------------------------------------
       */
      assertTransition(
        "processing",
        "success",
      );

      /*
       * Mark the payment attempt successful.
       */
      await client.query(
        `
        UPDATE public.payment_attempts

        SET
          status = 'success',
          failure_code = NULL

        WHERE id = $1
        `,
        [attempt.id],
      );

      /*
       * ----------------------------------------------------
       * STEP 5
       * Mark payment order as paid.
       * ----------------------------------------------------
       */
      await client.query(
        `
        UPDATE public.payment_orders

        SET
          status = 'paid'

        WHERE id = $1
        `,
        [orderId],
      );

      /*
       * ----------------------------------------------------
       * STEP 6
       * Check whether a transaction already exists.
       *
       * This is an additional application-level
       * protection before the database UNIQUE constraint.
       * ----------------------------------------------------
       */
      const existingTransactionResult =
        await client.query(
          `
          SELECT
            id,
            order_id,
            attempt_id,
            amount,
            currency,
            type,
            status,
            created_at

          FROM public.transactions

          WHERE attempt_id = $1

          LIMIT 1
          `,
          [attempt.id],
        );

      let finalTransactionId: string;

      /*
       * Transaction already exists.
       */
      if (
        existingTransactionResult.rows
          .length > 0
      ) {
        finalTransactionId =
          existingTransactionResult
            .rows[0].id;
      } else {
        /*
         * --------------------------------------------------
         * STEP 7
         * Create successful payment transaction.
         * --------------------------------------------------
         */
        const transactionId =
          randomUUID();

        const transactionResult =
          await client.query(
            `
            INSERT INTO public.transactions
            (
              id,
              order_id,
              attempt_id,
              amount,
              currency,
              type,
              status
            )

            VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              'payment',
              'success'
            )

            ON CONFLICT (attempt_id)
            DO UPDATE SET
              order_id = EXCLUDED.order_id,
              amount = EXCLUDED.amount,
              currency = EXCLUDED.currency,
              type = EXCLUDED.type,
              status = EXCLUDED.status

            RETURNING id
            `,
            [
              transactionId,
              orderId,
              attempt.id,
              order.amount,
              order.currency,
            ],
          );

        finalTransactionId =
          transactionResult.rows[0]
            ?.id ?? transactionId;
      }

      /*
       * ----------------------------------------------------
       * STEP 8
       * Commit everything together.
       * ----------------------------------------------------
       */
      await client.query("COMMIT");

      /*
       * ----------------------------------------------------
       * STEP 9
       * Return successful recovery response.
       * ----------------------------------------------------
       */
      return res.status(200).json({
        status: "ok",

        message:
          "Payment recovery completed successfully.",

        recovery: {
          orderId,
          attemptId: attempt.id,
          transactionId:
            finalTransactionId,
          amount: Number(
            order.amount,
          ),
          currency:
            order.currency,
          paymentMethod:
            attempt.payment_method,
          previousStatus: "failed",
          status: "success",
        },
      });
    } catch (error) {
      /*
       * ----------------------------------------------------
       * ROLLBACK
       * ----------------------------------------------------
       */
      try {
        await client.query(
          "ROLLBACK",
        );
      } catch (rollbackError) {
        console.error(
          "Rollback error:",
          rollbackError,
        );
      }

      console.error(
        "Recovery POST error:",
        error,
      );

      /*
       * Invalid state transition should
       * return a conflict instead of a
       * generic server error.
       */
      if (
        error instanceof Error &&
        error.message.startsWith(
          "Invalid payment state transition:",
        )
      ) {
        return res.status(409).json({
          status: "error",
          message:
            error.message,
        });
      }

      return res.status(500).json({
        status: "error",
        message:
          "Unable to complete payment recovery.",
      });
    } finally {
      /*
       * Always release the database connection.
       */
      client.release();
    }
  },
);

export default router;