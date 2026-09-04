import crypto from "node:crypto";
import { getPgPool } from "../infrastructure/database/client.js";
import { getPaymentStatus, } from "./paymentProvider.js";
/**
 * Reconcile stale payment attempts.
 *
 * Flow:
 *
 * processing
 *     |
 *     v
 * provider lookup
 *     |
 *     +---- success ---> success + paid + transaction
 *     |
 *     +---- failed ----> failed
 *     |
 *     +---- unknown ---> skipped
 *
 * Important properties:
 *
 * - Only stale processing attempts are considered.
 * - Provider status is treated as the source of truth.
 * - Transactions are idempotent through attempt_id.
 * - Already-paid orders are protected from duplicate transactions.
 * - Reconciliation actions are written to audit_logs.
 */
export async function reconcileStalePaymentAttempts(staleMinutes = 15) {
    if (!Number.isFinite(staleMinutes) ||
        staleMinutes <= 0) {
        throw new Error("staleMinutes must be a positive number");
    }
    const pool = getPgPool();
    const client = await pool.connect();
    const result = {
        scanned: 0,
        reconciled: 0,
        skipped: 0,
        results: [],
    };
    try {
        await client.query("BEGIN");
        /*
         * -------------------------------------------------------
         * STEP 1
         * Find stale processing attempts.
         * -------------------------------------------------------
         */
        const attemptsResult = await client.query(`
      SELECT
        pa.id,
        pa.order_id,
        pa.status,
        pa.provider_reference,
        pa.created_at,
        pa.updated_at,

        po.status AS order_status,
        po.amount,
        po.currency

      FROM public.payment_attempts pa

      INNER JOIN public.payment_orders po
        ON po.id = pa.order_id

      WHERE pa.status = 'processing'

        AND pa.updated_at <
          NOW() - ($1 * INTERVAL '1 minute')

      ORDER BY pa.updated_at ASC

      FOR UPDATE OF pa, po SKIP LOCKED
      `, [staleMinutes]);
        result.scanned =
            attemptsResult.rowCount ?? 0;
        /*
         * -------------------------------------------------------
         * STEP 2
         * Process every stale attempt.
         * -------------------------------------------------------
         */
        for (const attempt of attemptsResult.rows) {
            /*
             * -----------------------------------------------------
             * CASE A
             * Order already paid.
             *
             * Another attempt successfully completed the order.
             *
             * Do NOT create another transaction.
             * -----------------------------------------------------
             */
            if (attempt.order_status === "paid") {
                const updateResult = await client.query(`
            UPDATE public.payment_attempts
            SET
              status = 'failed',
              failure_code =
                'RECONCILED_ALREADY_PAID',
              updated_at = NOW()
            WHERE id = $1
              AND status = 'processing'
            RETURNING id
            `, [attempt.id]);
                if ((updateResult.rowCount ?? 0) === 0) {
                    continue;
                }
                await client.query(`
          INSERT INTO public.audit_logs
          (
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES
          (
            'payment_reconciliation',
            'payment_order',
            $1,
            $2
          )
          `, [
                    attempt.order_id,
                    JSON.stringify({
                        attemptId: attempt.id,
                        previousStatus: "processing",
                        action: "marked_failed",
                        reason: "Order was already paid by another successful attempt.",
                    }),
                ]);
                result.reconciled++;
                result.results.push({
                    attemptId: attempt.id,
                    orderId: attempt.order_id,
                    previousStatus: "processing",
                    action: "marked_failed",
                    reason: "Payment order was already paid by another successful attempt.",
                });
                continue;
            }
            /*
             * -----------------------------------------------------
             * CASE B
             * No provider reference.
             *
             * We cannot safely query the provider.
             * Leave the attempt processing.
             * -----------------------------------------------------
             */
            if (!attempt.provider_reference) {
                await client.query(`
          INSERT INTO public.audit_logs
          (
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES
          (
            'payment_reconciliation',
            'payment_order',
            $1,
            $2
          )
          `, [
                    attempt.order_id,
                    JSON.stringify({
                        attemptId: attempt.id,
                        previousStatus: "processing",
                        action: "skipped",
                        reason: "No provider reference is available.",
                    }),
                ]);
                result.skipped++;
                result.results.push({
                    attemptId: attempt.id,
                    orderId: attempt.order_id,
                    previousStatus: "processing",
                    action: "skipped",
                    reason: "No provider reference is available for provider reconciliation.",
                });
                continue;
            }
            /*
             * -----------------------------------------------------
             * STEP 3
             * Ask the payment provider.
             * -----------------------------------------------------
             */
            const providerResult = await getPaymentStatus(attempt.provider_reference);
            /*
             * -----------------------------------------------------
             * CASE C
             * Provider SUCCESS
             * -----------------------------------------------------
             */
            if (providerResult.status === "success") {
                /*
                 * Mark attempt successful.
                 */
                const updatedAttemptResult = await client.query(`
            UPDATE public.payment_attempts
            SET
              status = 'success',
              provider_reference =
                COALESCE($2, provider_reference),
              failure_code = NULL,
              updated_at = NOW()
            WHERE id = $1
              AND status = 'processing'
            RETURNING id
            `, [
                    attempt.id,
                    providerResult.providerReference,
                ]);
                if ((updatedAttemptResult.rowCount ?? 0) ===
                    0) {
                    continue;
                }
                /*
                 * Mark order paid only if it is not
                 * already paid.
                 */
                const updatedOrderResult = await client.query(`
            UPDATE public.payment_orders
            SET
              status = 'paid',
              updated_at = NOW()
            WHERE id = $1
              AND status <> 'paid'
            RETURNING id
            `, [attempt.order_id]);
                /*
                 * Another process may have paid the order
                 * between the initial SELECT and this UPDATE.
                 *
                 * In that case do not create a second transaction.
                 */
                if ((updatedOrderResult.rowCount ?? 0) ===
                    0) {
                    await client.query(`
            INSERT INTO public.audit_logs
            (
              action,
              entity_type,
              entity_id,
              metadata
            )
            VALUES
            (
              'payment_reconciliation',
              'payment_order',
              $1,
              $2
            )
            `, [
                        attempt.order_id,
                        JSON.stringify({
                            attemptId: attempt.id,
                            action: "marked_success",
                            transactionCreated: false,
                            reason: "Provider confirmed success, but the order was already paid.",
                        }),
                    ]);
                    result.reconciled++;
                    result.results.push({
                        attemptId: attempt.id,
                        orderId: attempt.order_id,
                        previousStatus: "processing",
                        action: "marked_success",
                        reason: "Provider confirmed success, but the order was already paid.",
                    });
                    continue;
                }
                /*
                 * ---------------------------------------------------
                 * Create exactly one transaction.
                 *
                 * amount and currency come from payment_orders.
                 * ---------------------------------------------------
                 */
                const transactionId = crypto.randomUUID();
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
                    attempt.order_id,
                    attempt.id,
                    attempt.amount,
                    attempt.currency,
                ]);
                /*
                 * Audit reconciliation.
                 */
                await client.query(`
          INSERT INTO public.audit_logs
          (
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES
          (
            'payment_reconciliation',
            'payment_order',
            $1,
            $2
          )
          `, [
                    attempt.order_id,
                    JSON.stringify({
                        attemptId: attempt.id,
                        transactionId,
                        providerReference: providerResult.providerReference,
                        previousStatus: "processing",
                        action: "reconciled_success",
                        reason: "Provider confirmed successful payment.",
                    }),
                ]);
                result.reconciled++;
                result.results.push({
                    attemptId: attempt.id,
                    orderId: attempt.order_id,
                    previousStatus: "processing",
                    action: "reconciled_success",
                    reason: "Provider confirmed successful payment.",
                });
                continue;
            }
            /*
             * -----------------------------------------------------
             * CASE D
             * Provider FAILED
             * -----------------------------------------------------
             */
            if (providerResult.status === "failed") {
                const updatedAttemptResult = await client.query(`
            UPDATE public.payment_attempts
            SET
              status = 'failed',
              provider_reference =
                COALESCE($2, provider_reference),
              failure_code = $3,
              updated_at = NOW()
            WHERE id = $1
              AND status = 'processing'
            RETURNING id
            `, [
                    attempt.id,
                    providerResult.providerReference,
                    providerResult.failureCode ??
                        "PROVIDER_PAYMENT_FAILED",
                ]);
                if ((updatedAttemptResult.rowCount ?? 0) ===
                    0) {
                    continue;
                }
                /*
                 * The order should only be marked failed
                 * if it is not already paid.
                 */
                await client.query(`
          UPDATE public.payment_orders
          SET
            status = 'failed',
            updated_at = NOW()
          WHERE id = $1
            AND status <> 'paid'
          `, [attempt.order_id]);
                await client.query(`
          INSERT INTO public.audit_logs
          (
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES
          (
            'payment_reconciliation',
            'payment_order',
            $1,
            $2
          )
          `, [
                    attempt.order_id,
                    JSON.stringify({
                        attemptId: attempt.id,
                        providerReference: providerResult.providerReference,
                        previousStatus: "processing",
                        action: "marked_failed",
                        failureCode: providerResult.failureCode ??
                            "PROVIDER_PAYMENT_FAILED",
                        reason: "Provider confirmed that the payment failed.",
                    }),
                ]);
                result.reconciled++;
                result.results.push({
                    attemptId: attempt.id,
                    orderId: attempt.order_id,
                    previousStatus: "processing",
                    action: "marked_failed",
                    reason: "Provider confirmed that the payment failed.",
                });
                continue;
            }
            /*
             * -----------------------------------------------------
             * CASE E
             * Provider UNKNOWN / PENDING
             *
             * Do not change financial state.
             * -----------------------------------------------------
             */
            await client.query(`
        INSERT INTO public.audit_logs
        (
          action,
          entity_type,
          entity_id,
          metadata
        )
        VALUES
        (
          'payment_reconciliation',
          'payment_order',
          $1,
          $2
        )
        `, [
                attempt.order_id,
                JSON.stringify({
                    attemptId: attempt.id,
                    providerReference: attempt.provider_reference,
                    previousStatus: "processing",
                    action: "skipped",
                    reason: "Provider could not determine the final payment status.",
                }),
            ]);
            result.skipped++;
            result.results.push({
                attemptId: attempt.id,
                orderId: attempt.order_id,
                previousStatus: "processing",
                action: "skipped",
                reason: "Provider could not determine the final payment status.",
            });
        }
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=reconciliationService.js.map