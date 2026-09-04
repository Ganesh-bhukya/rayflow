import express from "express";

import { getPgPool } from "../infrastructure/database/client.js";
import {
  createRazorpayRefund,
} from "../infrastructure/razorpay/razorpayClient.js";

const router = express.Router();

/*
 * ------------------------------------------------------------
 * GET /refunds
 *
 * Returns all refunds with transaction,
 * customer and merchant information.
 * ------------------------------------------------------------
 */
router.get("/", async (_req, res) => {
  try {
    const pool = getPgPool();

    const query = `
      SELECT
        r.id,
        r.transaction_id AS "transactionId",
        r.amount,
        r.status,
        r.reason,
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",

        t.order_id AS "orderId",
        t.amount AS "transactionAmount",
        t.currency AS "currency",
        t.status AS "transactionStatus",
        t.type AS "transactionType",

        c.id AS "customerId",
        c.name AS "customerName",
        c.email AS "customerEmail",

        m.id AS "merchantId",
        m.business_name AS "merchantName"

      FROM public.refunds r

      INNER JOIN public.transactions t
        ON t.id = r.transaction_id

      LEFT JOIN public.payment_orders po
        ON po.id = t.order_id

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      LEFT JOIN public.merchants m
        ON m.id = po.merchant_id

      ORDER BY r.created_at DESC

      LIMIT 100;
    `;

    const result =
      await pool.query(query);

    return res.json({
      status: "ok",
      refunds: result.rows,
    });
  } catch (error) {
    console.error(
      "Failed to fetch refunds:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch refunds",
    });
  }
});


/*
 * ------------------------------------------------------------
 * GET /refunds/:id
 *
 * Returns details for one refund.
 * ------------------------------------------------------------
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } =
      req.params;

    if (!id) {
      return res.status(400).json({
        status: "error",
        error: "Refund ID is required",
      });
    }

    const pool =
      getPgPool();

    const query = `
      SELECT
        r.id,
        r.transaction_id AS "transactionId",
        r.amount,
        r.status,
        r.reason,
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",

        t.order_id AS "orderId",
        t.amount AS "transactionAmount",
        t.currency AS "currency",
        t.status AS "transactionStatus",
        t.type AS "transactionType",
        t.created_at AS "transactionCreatedAt",

        c.id AS "customerId",
        c.name AS "customerName",
        c.email AS "customerEmail",
        c.phone AS "customerPhone",

        m.id AS "merchantId",
        m.business_name AS "merchantName",
        m.merchant_code AS "merchantCode"

      FROM public.refunds r

      INNER JOIN public.transactions t
        ON t.id = r.transaction_id

      LEFT JOIN public.payment_orders po
        ON po.id = t.order_id

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      LEFT JOIN public.merchants m
        ON m.id = po.merchant_id

      WHERE r.id = $1

      LIMIT 1;
    `;

    const result =
      await pool.query(
        query,
        [id],
      );

    if (
      result.rows.length === 0
    ) {
      return res.status(404).json({
        status: "error",
        error: "Refund not found",
      });
    }

    return res.json({
      status: "ok",
      refund: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Failed to fetch refund details:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch refund details",
    });
  }
});


/*
 * ------------------------------------------------------------
 * POST /refunds
 *
 * Creates a real Razorpay full or partial refund.
 *
 * Body:
 *
 * {
 *   "transactionId": "...",
 *   "amount": 5000,
 *   "reason": "Customer requested refund"
 * }
 *
 * Amount is stored in the smallest currency unit.
 *
 * Example:
 * INR 50.00 = 5000
 * ------------------------------------------------------------
 */
router.post("/", async (req, res) => {
  const {
    transactionId,
    amount,
    reason,
  } = req.body ?? {};

  /*
   * Validate transaction ID.
   */
  if (
    !transactionId ||
    typeof transactionId !== "string"
  ) {
    return res.status(400).json({
      status: "error",
      error: "transactionId is required",
    });
  }

  /*
   * Validate amount.
   */
  const refundAmount =
    Number(amount);

  if (
    !Number.isInteger(refundAmount) ||
    refundAmount <= 0
  ) {
    return res.status(400).json({
      status: "error",
      error:
        "amount must be a positive integer in the smallest currency unit",
    });
  }

  /*
   * Validate reason.
   */
  if (
    reason !== undefined &&
    reason !== null &&
    typeof reason !== "string"
  ) {
    return res.status(400).json({
      status: "error",
      error: "reason must be a string",
    });
  }

  const pool =
    getPgPool();

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * --------------------------------------------------------
     * STEP 1
     *
     * Lock the transaction row.
     *
     * This prevents concurrent refund requests from
     * refunding more than the original payment amount.
     * --------------------------------------------------------
     */
    const transactionResult =
      await client.query(
        `
        SELECT
          id,
          order_id,
          amount,
          currency,
          status,
          type
        FROM public.transactions
        WHERE id = $1
        FOR UPDATE
        `,
        [transactionId],
      );

    if (
      transactionResult.rows.length === 0
    ) {
      await client.query(
        "ROLLBACK",
      );

      return res.status(404).json({
        status: "error",
        error: "Transaction not found",
      });
    }

    const transaction =
      transactionResult.rows[0];

    /*
     * Only successful payment transactions
     * can currently be refunded.
     */
    if (
      String(
        transaction.status,
      ).toLowerCase() !==
      "success"
    ) {
      await client.query(
        "ROLLBACK",
      );

      return res.status(409).json({
        status: "error",
        error:
          "Only successful transactions can be refunded",
      });
    }

    /*
     * Only payment transactions should be refunded.
     */
    if (
      String(
        transaction.type,
      ).toLowerCase() !==
      "payment"
    ) {
      await client.query(
        "ROLLBACK",
      );

      return res.status(409).json({
        status: "error",
        error:
          "Only payment transactions can be refunded",
      });
    }

    /*
     * --------------------------------------------------------
     * STEP 2
     *
     * Find the Razorpay payment ID.
     *
     * During successful Razorpay verification,
     * razorpay_payment_id is stored in provider_reference.
     * --------------------------------------------------------
     */
    const attemptResult =
      await client.query(
        `
        SELECT
          id,
          provider_reference,
          status,
          payment_method
        FROM public.payment_attempts
        WHERE order_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [transaction.order_id],
      );

    if (
      attemptResult.rows.length === 0
    ) {
      await client.query(
        "ROLLBACK",
      );

      return res.status(409).json({
        status: "error",
        error:
          "Payment attempt not found for this transaction",
      });
    }

    const attempt =
      attemptResult.rows[0];

    const razorpayPaymentId =
      String(
        attempt.provider_reference ??
        "",
      ).trim();

    if (
      !razorpayPaymentId
    ) {
      await client.query(
        "ROLLBACK",
      );

      return res.status(409).json({
        status: "error",
        error:
          "This transaction is not linked to a Razorpay payment",
        details: {
          transactionId,
          attemptId: attempt.id,
        },
      });
    }

    /*
     * --------------------------------------------------------
     * STEP 3
     *
     * Calculate already refunded amount.
     *
     * Failed/cancelled refunds are excluded.
     * --------------------------------------------------------
     */
    const refundedResult =
      await client.query(
        `
        SELECT
          COALESCE(
            SUM(amount) FILTER (
              WHERE status NOT IN (
                'failed',
                'cancelled'
              )
            ),
            0
          )::int AS "refundedAmount"
        FROM public.refunds
        WHERE transaction_id = $1
        `,
        [transactionId],
      );

    const alreadyRefunded =
      Number(
        refundedResult.rows[0]
          ?.refundedAmount || 0,
      );

    const transactionAmount =
      Number(
        transaction.amount,
      );

    const remainingRefundable =
      transactionAmount -
      alreadyRefunded;

    /*
     * --------------------------------------------------------
     * STEP 4
     *
     * Prevent over-refunding.
     * --------------------------------------------------------
     */
    if (
      refundAmount >
      remainingRefundable
    ) {
      await client.query(
        "ROLLBACK",
      );

      return res.status(409).json({
        status: "error",
        error:
          "Refund amount exceeds remaining refundable amount",
        details: {
          transactionAmount,
          alreadyRefunded,
          remainingRefundable,
          requestedRefund:
            refundAmount,
        },
      });
    }

    /*
     * --------------------------------------------------------
     * STEP 5
     *
     * Determine full or partial refund.
     * --------------------------------------------------------
     */
    const refundType =
      refundAmount ===
      remainingRefundable
        ? "full"
        : "partial";

    /*
     * --------------------------------------------------------
     * STEP 6
     *
     * Create a RayFlow refund record first.
     *
     * We use pending initially because the provider call
     * happens immediately after this record is created.
     * --------------------------------------------------------
     */
    const refundResult =
      await client.query(
        `
        INSERT INTO public.refunds (
          transaction_id,
          amount,
          status,
          reason
        )
        VALUES (
          $1,
          $2,
          'pending',
          $3
        )
        RETURNING
          id,
          transaction_id AS "transactionId",
          amount,
          status,
          reason,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          transactionId,
          refundAmount,
          reason || null,
        ],
      );

    const refund =
      refundResult.rows[0];

    /*
     * --------------------------------------------------------
     * STEP 7
     *
     * Create the REAL Razorpay refund.
     * --------------------------------------------------------
     */
    let razorpayRefund;

    try {
      razorpayRefund =
        await createRazorpayRefund({
          paymentId:
            razorpayPaymentId,
          amount:
            refundAmount,
          currency:
            transaction.currency,
          receipt:
            `rf_${refund.id.replace(
              /-/g,
              "",
            ).slice(0, 32)}`,
          notes: {
            rayflowRefundId:
              refund.id,
            rayflowTransactionId:
              transactionId,
            rayflowOrderId:
              transaction.order_id,
          },
        });
    } catch (razorpayError) {
      /*
       * Razorpay rejected the refund.
       *
       * Keep the RayFlow refund record for auditability,
       * but mark it failed.
       */
      const errorMessage =
        razorpayError instanceof Error
          ? razorpayError.message
          : "Razorpay refund failed";

      await client.query(
        `
        UPDATE public.refunds
        SET
          status = 'failed',
          updated_at = NOW()
        WHERE id = $1
        `,
        [refund.id],
      );

      await client.query(
        `
        INSERT INTO public.audit_logs (
          action,
          entity_type,
          entity_id,
          metadata
        )
        VALUES (
          $1,
          $2,
          $3,
          $4
        )
        `,
        [
          "razorpay_refund_failed",
          "refund",
          refund.id,
          JSON.stringify({
            transactionId,
            razorpayPaymentId,
            amount:
              refundAmount,
            currency:
              transaction.currency,
            error:
              errorMessage,
          }),
        ],
      );

      await client.query(
        "COMMIT",
      );

      return res.status(502).json({
        status: "error",
        error:
          "Razorpay refund failed",
        details: {
          refundId: refund.id,
          message:
            errorMessage,
        },
      });
    }

    /*
     * --------------------------------------------------------
     * STEP 8
     *
     * Map Razorpay refund status into RayFlow status.
     *
     * Razorpay generally returns a refund object immediately.
     * We keep non-final states as pending.
     * --------------------------------------------------------
     */
    const razorpayStatus =
      String(
        razorpayRefund.status ||
        "",
      ).toLowerCase();

    const rayflowRefundStatus =
      razorpayStatus ===
        "processed"
        ? "success"
        : razorpayStatus ===
            "failed"
          ? "failed"
          : "pending";

    /*
     * --------------------------------------------------------
     * STEP 9
     *
     * Update RayFlow refund with provider result.
     *
     * The existing refunds table does not currently have
     * a dedicated razorpay_refund_id column, so the provider
     * reference is stored in audit metadata for now.
     * --------------------------------------------------------
     */
    const updatedRefundResult =
      await client.query(
        `
        UPDATE public.refunds
        SET
          status = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING
          id,
          transaction_id AS "transactionId",
          amount,
          status,
          reason,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          rayflowRefundStatus,
          refund.id,
        ],
      );

    const updatedRefund =
      updatedRefundResult.rows[0];

    /*
     * --------------------------------------------------------
     * STEP 10
     *
     * Calculate refund state.
     * --------------------------------------------------------
     */
    const totalRefundResult =
      await client.query(
        `
        SELECT
          COALESCE(
            SUM(amount) FILTER (
              WHERE status = 'success'
            ),
            0
          )::int AS "totalRefunded"
        FROM public.refunds
        WHERE transaction_id = $1
        `,
        [transactionId],
      );

    const totalRefunded =
      Number(
        totalRefundResult.rows[0]
          ?.totalRefunded || 0,
      );

    const refundState =
      totalRefunded >=
      transactionAmount
        ? "refunded"
        : "partially_refunded";

    /*
     * --------------------------------------------------------
     * STEP 11
     *
     * Audit successful provider interaction.
     * --------------------------------------------------------
     */
    await client.query(
      `
      INSERT INTO public.audit_logs (
        action,
        entity_type,
        entity_id,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4
      )
      `,
      [
        "razorpay_refund_created",
        "refund",
        refund.id,
        JSON.stringify({
          transactionId,
          transactionAmount,
          amount:
            refundAmount,
          currency:
            transaction.currency,
          refundType,
          alreadyRefunded,
          remainingRefundable,
          razorpayPaymentId,
          razorpayRefundId:
            razorpayRefund.id,
          razorpayStatus:
            razorpayRefund.status,
          razorpaySpeedRequested:
            razorpayRefund.speedRequested,
          razorpaySpeedProcessed:
            razorpayRefund.speedProcessed,
          refundState,
          reason:
            reason || null,
        }),
      ],
    );

    /*
     * --------------------------------------------------------
     * STEP 12
     *
     * Commit RayFlow state.
     * --------------------------------------------------------
     */
    await client.query(
      "COMMIT",
    );

    return res.status(201).json({
      status: "ok",

      message:
        rayflowRefundStatus ===
        "success"
          ? "Razorpay refund processed successfully"
          : "Razorpay refund created successfully",

      refund: {
        ...updatedRefund,

        currency:
          transaction.currency,

        refundType,

        transactionAmount,

        alreadyRefunded,

        totalRefunded,

        remainingRefundable:
          Math.max(
            transactionAmount -
              totalRefunded,
            0,
          ),

        refundState,

        razorpayPaymentId,

        razorpayRefundId:
          razorpayRefund.id,

        razorpayStatus:
          razorpayRefund.status,

        razorpaySpeedRequested:
          razorpayRefund.speedRequested,

        razorpaySpeedProcessed:
          razorpayRefund.speedProcessed,
      },
    });
  } catch (error) {
    try {
      await client.query(
        "ROLLBACK",
      );
    } catch (
      rollbackError
    ) {
      console.error(
        "Refund rollback error:",
        rollbackError,
      );
    }

    console.error(
      "Failed to create refund:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error:
        "Failed to create refund",
      details:
        error instanceof Error
          ? error.message
          : undefined,
    });
  } finally {
    client.release();
  }
});


/*
 * ------------------------------------------------------------
 * POST /refunds/:id/complete
 *
 * Legacy development endpoint.
 *
 * Real Razorpay refunds are now created through
 * POST /refunds.
 *
 * This endpoint is retained so the existing frontend
 * does not break, but it does NOT simulate a provider
 * refund anymore.
 * ------------------------------------------------------------
 */
router.post(
  "/:id/complete",
  async (req, res) => {
    const { id } =
      req.params;

    if (!id) {
      return res.status(400).json({
        status: "error",
        error: "Refund ID is required",
      });
    }

    const pool =
      getPgPool();

    const client =
      await pool.connect();

    try {
      await client.query(
        "BEGIN",
      );

      const refundResult =
        await client.query(
          `
          SELECT
            r.id,
            r.transaction_id AS "transactionId",
            r.amount,
            r.status,
            r.reason,

            t.order_id AS "orderId",
            t.amount AS "transactionAmount",
            t.currency,
            t.status AS "transactionStatus",
            t.type AS "transactionType"

          FROM public.refunds r

          INNER JOIN public.transactions t
            ON t.id = r.transaction_id

          WHERE r.id = $1

          FOR UPDATE
          `,
          [id],
        );

      if (
        refundResult.rows.length === 0
      ) {
        await client.query(
          "ROLLBACK",
        );

        return res.status(404).json({
          status: "error",
          error: "Refund not found",
        });
      }

      const refund =
        refundResult.rows[0];

      /*
       * If Razorpay already processed the refund,
       * return the current state.
       */
      if (
        String(
          refund.status,
        ).toLowerCase() ===
        "success"
      ) {
        await client.query(
          "COMMIT",
        );

        return res.json({
          status: "ok",
          message:
            "Refund is already completed",
          refund,
        });
      }

      /*
       * We intentionally do not simulate provider
       * completion anymore.
       */
      await client.query(
        "ROLLBACK",
      );

      return res.status(409).json({
        status: "error",
        error:
          "Manual refund completion is disabled. Refunds are processed through Razorpay.",
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK",
        );
      } catch {}

      console.error(
        "Failed to complete refund:",
        error,
      );

      return res.status(500).json({
        status: "error",
        error:
          "Failed to complete refund",
      });
    } finally {
      client.release();
    }
  },
);

export default router;