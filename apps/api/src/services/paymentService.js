import crypto from "crypto";
import { getPgPool } from "../infrastructure/database/client.js";
import { getPaymentStatus } from "./paymentProvider.js";
import { assertTransition } from "./paymentStateMachine.js";
export async function processPayment({ orderId, paymentMethod, }) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        /*
         * ============================================================
         * STEP 1
         * Lock the payment order.
         *
         * This prevents two requests from processing the same
         * payment order at the same time.
         * ============================================================
         */
        const orderResult = await client.query(`
      SELECT
        id,
        merchant_id,
        customer_id,
        amount,
        currency,
        status
      FROM public.payment_orders
      WHERE id = $1
      FOR UPDATE
      `, [orderId]);
        if (orderResult.rows.length === 0) {
            throw new Error("Payment order not found");
        }
        const order = orderResult.rows[0];
        /*
         * ============================================================
         * STEP 2
         * If the order is already paid, return the existing state.
         * ============================================================
         */
        if (order.status === "paid") {
            const existingAttempt = await client.query(`
        SELECT
          id,
          order_id,
          payment_method,
          status,
          failure_code,
          provider_reference,
          created_at,
          updated_at
        FROM public.payment_attempts
        WHERE order_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        `, [orderId]);
            await client.query("COMMIT");
            return {
                idempotent: true,
                payment: {
                    id: order.id,
                    merchantId: order.merchant_id,
                    customerId: order.customer_id,
                    amount: order.amount,
                    currency: order.currency,
                    status: order.status,
                    attemptId: existingAttempt.rows[0]?.id ?? null,
                    paymentMethod: existingAttempt.rows[0]?.payment_method ??
                        paymentMethod,
                },
            };
        }
        /*
         * ============================================================
         * STEP 3
         * Find an existing processing attempt.
         * ============================================================
         */
        let attemptResult = await client.query(`
      SELECT
        id,
        order_id,
        payment_method,
        status,
        failure_code,
        provider_reference,
        created_at,
        updated_at
      FROM public.payment_attempts
      WHERE order_id = $1
        AND status = 'processing'
      ORDER BY created_at DESC
      LIMIT 1
      `, [orderId]);
        let attempt;
        /*
         * ============================================================
         * STEP 4
         * Create or reuse processing attempt.
         * ============================================================
         */
        if (attemptResult.rows.length > 0) {
            attempt = attemptResult.rows[0];
        }
        else {
            attemptResult = await client.query(`
        INSERT INTO public.payment_attempts
        (
          order_id,
          payment_method,
          status
        )
        VALUES
        (
          $1,
          $2,
          'created'
        )
        RETURNING
          id,
          order_id,
          payment_method,
          status,
          failure_code,
          provider_reference,
          created_at,
          updated_at
        `, [
                orderId,
                paymentMethod,
            ]);
            attempt = attemptResult.rows[0];
            /*
             * created -> processing
             */
            assertTransition(attempt.status, "processing");
            await client.query(`
        UPDATE public.payment_attempts
        SET
          status = 'processing',
          updated_at = NOW()
        WHERE id = $1
        `, [attempt.id]);
            attempt = {
                ...attempt,
                status: "processing",
            };
        }
        /*
     * ============================================================
     * STEP 5
     * Simulated payment provider.
     *
     * The provider reference determines the result.
     *
     * rayflow_success_* -> success
     * rayflow_failed_*  -> failed
     * rayflow_pending_* -> pending
     * anything else     -> pending / unknown
     *
     * Normal payment processing creates a success reference
     * for this demo.
     * ============================================================
     */
        const providerReference = paymentMethod === "fail_test"
            ? `rayflow_failed_${Date.now()}`
            : paymentMethod === "pending_test"
                ? `rayflow_pending_${Date.now()}`
                : `rayflow_success_${Date.now()}`;
        const providerResult = await getPaymentStatus(providerReference);
        /*
         * ============================================================
         * PROVIDER SUCCESS
         * ============================================================
         */
        if (providerResult.status === "success") {
            assertTransition("processing", "success");
            /*
             * Mark attempt successful.
             */
            const updatedAttemptResult = await client.query(`
          UPDATE public.payment_attempts
          SET
            status = 'success',
            provider_reference = $2,
            failure_code = NULL,
            updated_at = NOW()
          WHERE id = $1
            AND status = 'processing'
          RETURNING
            id,
            order_id,
            payment_method,
            status,
            failure_code,
            provider_reference,
            created_at,
            updated_at
          `, [
                attempt.id,
                providerResult.providerReference,
            ]);
            if ((updatedAttemptResult.rowCount ?? 0) === 0) {
                throw new Error("Payment attempt could not be completed");
            }
            const successfulAttempt = updatedAttemptResult.rows[0];
            /*
             * ========================================================
             * Mark order paid.
             * ========================================================
             */
            const updatedOrderResult = await client.query(`
          UPDATE public.payment_orders
          SET
            status = 'paid',
            updated_at = NOW()
          WHERE id = $1
            AND status <> 'paid'
          RETURNING *
          `, [orderId]);
            /*
             * ========================================================
             * Create exactly one transaction.
             *
             * IMPORTANT:
             * rowCount can be null in the pg type definition,
             * therefore use ?? 0.
             * ========================================================
             */
            let transactionId = null;
            if ((updatedOrderResult.rowCount ?? 0) > 0) {
                transactionId = crypto.randomUUID();
                await client.query(`
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
            status = EXCLUDED.status
          `, [
                    transactionId,
                    orderId,
                    successfulAttempt.id,
                    order.amount,
                    order.currency,
                ]);
            }
            else {
                /*
                 * Order was already paid by another process.
                 * Retrieve the existing successful transaction.
                 */
                const existingTransaction = await client.query(`
            SELECT
              id
            FROM public.transactions
            WHERE order_id = $1
              AND type = 'payment'
              AND status = 'success'
            ORDER BY created_at ASC
            LIMIT 1
            `, [orderId]);
                transactionId =
                    existingTransaction.rows[0]?.id ??
                        null;
            }
            await client.query("COMMIT");
            return {
                idempotent: false,
                payment: {
                    id: order.id,
                    merchantId: order.merchant_id,
                    customerId: order.customer_id,
                    amount: order.amount,
                    currency: order.currency,
                    status: "paid",
                    attemptId: successfulAttempt.id,
                    paymentMethod: successfulAttempt.payment_method,
                    providerReference: successfulAttempt.provider_reference,
                    transactionId,
                },
            };
        }
        /*
         * ============================================================
         * PROVIDER FAILED
         * ============================================================
         */
        if (providerResult.status === "failed") {
            assertTransition("processing", "failed");
            const failureCode = providerResult.failureCode ??
                "PROVIDER_PAYMENT_FAILED";
            /*
             * Mark attempt failed.
             */
            await client.query(`
        UPDATE public.payment_attempts
        SET
          status = 'failed',
          provider_reference = $2,
          failure_code = $3,
          updated_at = NOW()
        WHERE id = $1
          AND status = 'processing'
        `, [
                attempt.id,
                providerResult.providerReference,
                failureCode,
            ]);
            /*
             * Mark order failed.
             */
            await client.query(`
        UPDATE public.payment_orders
        SET
          status = 'failed',
          updated_at = NOW()
        WHERE id = $1
          AND status <> 'paid'
        `, [orderId]);
            await client.query("COMMIT");
            return {
                idempotent: false,
                payment: {
                    id: order.id,
                    merchantId: order.merchant_id,
                    customerId: order.customer_id,
                    amount: order.amount,
                    currency: order.currency,
                    status: "failed",
                    attemptId: attempt.id,
                    paymentMethod: attempt.payment_method,
                    providerReference: providerResult.providerReference,
                    failureCode,
                },
            };
        }
        /*
         * ============================================================
         * PROVIDER UNKNOWN
         * ============================================================
         *
         * Do not mark the payment failed.
         *
         * Leave the attempt in processing so the reconciliation
         * service can resolve it later.
         * ============================================================
         */ /*
    * ============================================================
    * PROVIDER UNKNOWN / PENDING
    * ============================================================
    *
    * Do not mark the payment failed.
    *
    * Persist the provider reference so the
    * reconciliation service can query the provider later.
    * ============================================================
    */
        await client.query(`
  UPDATE public.payment_attempts
  SET
    provider_reference = $2,
    updated_at = NOW()
  WHERE id = $1
    AND status = 'processing'
  `, [
            attempt.id,
            providerResult.providerReference,
        ]);
        await client.query("COMMIT");
        return {
            idempotent: false,
            payment: {
                id: order.id,
                merchantId: order.merchant_id,
                customerId: order.customer_id,
                amount: order.amount,
                currency: order.currency,
                status: "processing",
                attemptId: attempt.id,
                paymentMethod: attempt.payment_method,
                providerReference: providerResult.providerReference,
            },
        };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=paymentService.js.map