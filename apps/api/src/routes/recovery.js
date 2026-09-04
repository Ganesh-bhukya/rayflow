import { Router } from "express";
import { randomUUID } from "crypto";
import { getPool } from "../config/database.js";
import { assertTransition, } from "../services/paymentStateMachine.js";
import { decideRecoveryAction, } from "../services/recoveryDecisionEngine.js";
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
         * Count successful payment orders.
         *
         * Recovery overview metrics are based on payment orders,
         * not individual transactions.
         */
        const successfulResult = await pool.query(`
      SELECT
        COUNT(*)::int AS successful_count,
        COALESCE(SUM(amount), 0)::bigint AS successful_amount

      FROM public.payment_orders

      WHERE
        status = 'paid'
    `);
        const failedPayments = paymentsResult.rows.length;
        const totalRecoverable = paymentsResult.rows.reduce((sum, payment) => sum + Number(payment.amount), 0);
        const successfulPayments = Number(successfulResult.rows[0]
            ?.successful_count ?? 0);
        const successfulAmount = Number(successfulResult.rows[0]
            ?.successful_amount ?? 0);
        /*
         * Total payment orders.
         */
        const totalResult = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM public.payment_orders
    `);
        const totalPayments = Number(totalResult.rows[0]?.total ?? 0);
        /*
         * Recovery rate.
         */
        const recoveryBase = successfulPayments +
            failedPayments;
        const recoveryRate = recoveryBase > 0
            ? Math.round((successfulPayments /
                recoveryBase) *
                100)
            : 0;
        /*
         * Failure reason counts.
         */
        const failureReasons = {};
        for (const payment of paymentsResult.rows) {
            const reason = payment.failure_code ??
                "UNKNOWN";
            failureReasons[reason] =
                (failureReasons[reason] ?? 0) + 1;
        }
        /*
         * Format response for frontend.
         */
        const payments = paymentsResult.rows.map((payment) => ({
            orderId: payment.order_id,
            attemptId: payment.attempt_id,
            amount: Number(payment.amount),
            currency: payment.currency,
            paymentMethod: payment.payment_method,
            status: payment.attempt_status,
            failureCode: payment.failure_code,
            createdAt: payment.attempt_created_at,
        }));
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
    }
    catch (error) {
        console.error("Recovery GET error:", error);
        return res.status(500).json({
            status: "error",
            message: "Unable to load recovery data.",
        });
    }
});
/*
|--------------------------------------------------------------------------
| POST /recovery/:orderId/complete
|--------------------------------------------------------------------------
| Analyze and recover a failed payment.
|
| Flow:
|
| 1. Lock payment
| 2. Lock latest attempt
| 3. Count previous failed attempts
| 4. Ask Recovery Decision Engine
| 5. STOP / ESCALATE safely when required
| 6. RETRY only when the decision engine allows it
| 7. Validate state transitions
| 8. Complete bounded recovery
| 9. Create transaction
| 10. Write audit record
|--------------------------------------------------------------------------
*/
router.post("/:orderId/complete", async (req, res) => {
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
        const orderResult = await client.query(`
            SELECT
              id,
              amount,
              currency,
              status

            FROM public.payment_orders

            WHERE id = $1

            FOR UPDATE
          `, [orderId]);
        /*
         * Order does not exist.
         */
        if (orderResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "error",
                message: "Payment order not found.",
            });
        }
        const order = orderResult.rows[0];
        /*
         * Never recover an already-paid order.
         */
        if (order.status === "paid") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                status: "error",
                message: "Payment order is already paid.",
            });
        }
        /*
         * ----------------------------------------------------
         * STEP 2
         * Find and lock the latest payment attempt.
         * ----------------------------------------------------
         */
        const attemptResult = await client.query(`
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
          `, [orderId]);
        /*
         * No attempt exists.
         */
        if (attemptResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                status: "error",
                message: "No payment attempt exists for this order.",
            });
        }
        const attempt = attemptResult.rows[0];
        /*
         * Already successful.
         */
        if (attempt.status === "success") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                status: "error",
                message: "This payment has already been recovered.",
            });
        }
        /*
         * Only failed payments can start recovery.
         */
        if (attempt.status !== "failed") {
            await client.query("ROLLBACK");
            return res.status(400).json({
                status: "error",
                message: "Only failed payments can be recovered.",
                currentStatus: attempt.status,
            });
        }
        /*
         * ----------------------------------------------------
         * STEP 3
         * Count previous failed attempts.
         *
         * The current attempt is already failed, so subtract
         * one to determine how many failed attempts happened
         * before the current recovery request.
         * ----------------------------------------------------
         */
        const failedAttemptsResult = await client.query(`
            SELECT
              COUNT(*)::int AS failed_count

            FROM public.payment_attempts

            WHERE
              order_id = $1
              AND status = 'failed'
          `, [orderId]);
        const totalFailedAttempts = Number(failedAttemptsResult
            .rows[0]
            ?.failed_count ?? 1);
        const previousFailedAttempts = Math.max(totalFailedAttempts - 1, 0);
        /*
         * ----------------------------------------------------
         * STEP 4
         * Ask the Recovery Decision Engine.
         *
         * IMPORTANT:
         * The decision engine does not modify the database
         * and does not change payment state.
         * ----------------------------------------------------
         */
        const decision = decideRecoveryAction({
            orderId,
            amount: Number(order.amount),
            currency: String(order.currency),
            paymentMethod: String(attempt.payment_method),
            failureCode: attempt.failure_code,
            previousFailedAttempts,
        });
        /*
         * ----------------------------------------------------
         * STEP 5
         * Write the AI/recovery decision to the audit trail.
         *
         * user_id is intentionally omitted because this
         * automated system decision is not tied to a logged-in
         * human user.
         * ----------------------------------------------------
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
            $1,
            $2,
            $3,
            $4
          )
        `, [
            "recovery.decision",
            "payment_order",
            orderId,
            JSON.stringify({
                orderId,
                attemptId: attempt.id,
                action: decision.action,
                confidence: decision.confidence,
                automated: decision.automated,
                reason: decision.reason,
                signals: decision.signals,
                failureCode: attempt.failure_code,
                previousFailedAttempts,
            }),
        ]);
        /*
         * ----------------------------------------------------
         * STEP 6
         * STOP / ESCALATE
         *
         * These decisions do NOT change the payment.
         * The failed state remains intact.
         * ----------------------------------------------------
         */
        if (decision.action ===
            "STOP" ||
            decision.action ===
                "ESCALATE") {
            await client.query("COMMIT");
            return res.status(200).json({
                status: "ok",
                recovered: false,
                message: decision.action ===
                    "STOP"
                    ? "Recovery stopped by the recovery policy."
                    : "Recovery escalated for manual review.",
                decision: {
                    action: decision.action,
                    confidence: decision.confidence,
                    automated: decision.automated,
                    reason: decision.reason,
                    signals: decision.signals,
                },
                recovery: {
                    orderId,
                    attemptId: attempt.id,
                    previousStatus: attempt.status,
                    status: attempt.status,
                    amount: Number(order.amount),
                    currency: order.currency,
                    paymentMethod: attempt.payment_method,
                },
            });
        }
        /*
         * ----------------------------------------------------
         * STEP 7
         * RETRY SAFETY CHECK
         * ----------------------------------------------------
         */
        if (decision.action !==
            "RETRY") {
            await client.query("COMMIT");
            return res.status(200).json({
                status: "ok",
                recovered: false,
                message: "No automated recovery action was executed.",
                decision,
            });
        }
        if (!decision.automated) {
            await client.query("COMMIT");
            return res.status(200).json({
                status: "ok",
                recovered: false,
                message: "Recovery retry was blocked by the automation safety policy.",
                decision,
            });
        }
        /*
         * ----------------------------------------------------
         * STEP 8
         * State machine validation:
         *
         * failed -> processing
         * ----------------------------------------------------
         */
        assertTransition(attempt.status, "processing");
        /*
         * Move the failed attempt into processing.
         */
        await client.query(`
          UPDATE public.payment_attempts

          SET
            status = 'processing'

          WHERE id = $1
        `, [attempt.id]);
        /*
         * ----------------------------------------------------
         * STEP 9
         * Execute bounded retry.
         *
         * This buildathon prototype uses a deterministic
         * successful retry after the decision engine has
         * explicitly allowed the action.
         *
         * The important difference from the old implementation
         * is that success is no longer unconditional:
         *
         * unknown/non-retryable failures never reach this point.
         * ----------------------------------------------------
         */
        assertTransition("processing", "success");
        await client.query(`
          UPDATE public.payment_attempts

          SET
            status = 'success',
            failure_code = NULL

          WHERE id = $1
        `, [attempt.id]);
        /*
         * ----------------------------------------------------
         * STEP 10
         * Mark payment order as paid.
         * ----------------------------------------------------
         */
        await client.query(`
          UPDATE public.payment_orders

          SET
            status = 'paid'

          WHERE id = $1
        `, [orderId]);
        /*
         * ----------------------------------------------------
         * STEP 11
         * Check whether a transaction already exists.
         * ----------------------------------------------------
         */
        const existingTransactionResult = await client.query(`
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
          `, [attempt.id]);
        let finalTransactionId;
        /*
         * Transaction already exists.
         */
        if (existingTransactionResult
            .rows.length > 0) {
            finalTransactionId =
                existingTransactionResult
                    .rows[0].id;
        }
        else {
            /*
             * --------------------------------------------------
             * STEP 12
             * Create successful payment transaction.
             * --------------------------------------------------
             */
            const transactionId = randomUUID();
            const transactionResult = await client.query(`
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
            `, [
                transactionId,
                orderId,
                attempt.id,
                order.amount,
                order.currency,
            ]);
            finalTransactionId =
                transactionResult
                    .rows[0]
                    ?.id ??
                    transactionId;
        }
        /*
         * ----------------------------------------------------
         * STEP 13
         * Record successful recovery outcome.
         * ----------------------------------------------------
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
            $1,
            $2,
            $3,
            $4
          )
        `, [
            "recovery.completed",
            "payment_order",
            orderId,
            JSON.stringify({
                orderId,
                attemptId: attempt.id,
                transactionId: finalTransactionId,
                action: decision.action,
                confidence: decision.confidence,
                previousStatus: "failed",
                currentStatus: "success",
                amount: Number(order.amount),
                currency: order.currency,
                paymentMethod: attempt.payment_method,
                failureCode: attempt.failure_code,
                reason: decision.reason,
            }),
        ]);
        /*
         * ----------------------------------------------------
         * STEP 14
         * Commit everything together.
         * ----------------------------------------------------
         */
        await client.query("COMMIT");
        /*
         * ----------------------------------------------------
         * STEP 15
         * Return recovery result.
         * ----------------------------------------------------
         */
        return res.status(200).json({
            status: "ok",
            recovered: true,
            message: "Payment recovery completed successfully.",
            decision: {
                action: decision.action,
                confidence: decision.confidence,
                automated: decision.automated,
                reason: decision.reason,
                signals: decision.signals,
            },
            recovery: {
                orderId,
                attemptId: attempt.id,
                transactionId: finalTransactionId,
                amount: Number(order.amount),
                currency: order.currency,
                paymentMethod: attempt.payment_method,
                previousStatus: "failed",
                status: "success",
            },
        });
    }
    catch (error) {
        /*
         * ----------------------------------------------------
         * ROLLBACK
         * ----------------------------------------------------
         */
        try {
            await client.query("ROLLBACK");
        }
        catch (rollbackError) {
            console.error("Rollback error:", rollbackError);
        }
        console.error("Recovery POST error:", error);
        /*
         * Invalid state transition should
         * return a conflict instead of a
         * generic server error.
         */
        if (error instanceof Error &&
            error.message.startsWith("Invalid payment state transition:")) {
            return res.status(409).json({
                status: "error",
                message: error.message,
            });
        }
        return res.status(500).json({
            status: "error",
            message: "Unable to complete payment recovery.",
        });
    }
    finally {
        /*
         * Always release the database connection.
         */
        client.release();
    }
});
/*
|--------------------------------------------------------------------------
| GET /recovery/intelligence
|--------------------------------------------------------------------------
| Revenue Recovery Intelligence
|
| Read-only analytics layer built from:
| - current failed payment attempts
| - bounded recovery decision engine
| - recovery audit events
|
| This endpoint does not execute recovery and does not write to the DB.
|--------------------------------------------------------------------------
*/
router.get("/intelligence", async (_req, res) => {
    const pool = getPool();
    try {
        /*
         * 1. Get the latest failed attempt for every unpaid order.
         *
         * We also calculate the number of failed attempts for the
         * order and subtract the current failed attempt. This gives
         * the decision engine the actual number of previous failures.
         *
         * Example:
         *
         *   first failed attempt  -> previousFailedAttempts = 0
         *   second failed attempt -> previousFailedAttempts = 1
         *
         * This keeps the intelligence endpoint consistent with the
         * actual recovery execution policy.
         */
        const failedPaymentsResult = await pool.query(`
      WITH attempt_history AS (
        SELECT
          pa.id AS attempt_id,
          pa.order_id,
          pa.payment_method,
          pa.status,
          pa.failure_code,
          pa.created_at,

          COUNT(*) FILTER (
            WHERE pa.status = 'failed'
          ) OVER (
            PARTITION BY pa.order_id
          ) AS total_failed_attempts,

          ROW_NUMBER() OVER (
            PARTITION BY pa.order_id
            ORDER BY pa.created_at DESC
          ) AS row_number

        FROM public.payment_attempts pa
      )

      SELECT
        ah.attempt_id,
        ah.order_id,
        ah.payment_method,
        ah.status,
        ah.failure_code,
        ah.created_at,

        GREATEST(
          ah.total_failed_attempts - 1,
          0
        )::int AS previous_failed_attempts,

        po.amount,
        po.currency,
        po.status AS order_status

      FROM attempt_history ah

      INNER JOIN public.payment_orders po
        ON po.id = ah.order_id

      WHERE
        ah.row_number = 1
        AND ah.status = 'failed'
        AND po.status <> 'paid'

      ORDER BY ah.created_at DESC
    `);
        /*
         * 2. Convert each failed payment into a bounded AI recovery decision.
         *
         * We do not write these decisions to audit_logs because this endpoint
         * is analytics-only. Actual recovery execution continues to create
         * recovery.decision audit events in the execution route.
         */
        const decisions = failedPaymentsResult.rows.map((payment) => {
            const previousFailedAttempts = Number(payment.previous_failed_attempts ?? 0);
            const decision = decideRecoveryAction({
                orderId: payment.order_id,
                amount: Number(payment.amount),
                currency: payment.currency,
                paymentMethod: payment.payment_method,
                failureCode: payment.failure_code,
                previousFailedAttempts,
            });
            return {
                orderId: payment.order_id,
                attemptId: payment.attempt_id,
                amount: Number(payment.amount),
                currency: payment.currency,
                paymentMethod: payment.payment_method,
                failureCode: payment.failure_code,
                createdAt: payment.created_at,
                previousFailedAttempts,
                action: decision.action,
                confidence: decision.confidence,
                automated: decision.automated,
                reason: decision.reason,
                signals: decision.signals,
            };
        });
        /*
         * 3. Aggregate the current recovery opportunity.
         */
        const actionSummary = {
            RETRY: {
                cases: 0,
                amount: 0,
            },
            STOP: {
                cases: 0,
                amount: 0,
            },
            ESCALATE: {
                cases: 0,
                amount: 0,
            },
        };
        for (const decision of decisions) {
            actionSummary[decision.action].cases += 1;
            actionSummary[decision.action].amount += decision.amount;
        }
        /*
         * 4. Get completed recovery events.
         *
         * Recovery completion is linked to the order through entity_id.
         * We deduplicate by order_id and keep the latest completion event.
         */
        const completedRecoveriesResult = await pool.query(`
        WITH recovery_completions AS (
          SELECT
            id,
            entity_id,
            metadata,
            created_at,

            ROW_NUMBER() OVER (
              PARTITION BY entity_id
              ORDER BY created_at DESC
            ) AS row_number

          FROM public.audit_logs

          WHERE
            action = 'recovery.completed'
            AND entity_type = 'payment_order'
            AND entity_id IS NOT NULL
        )

        SELECT
          id,
          entity_id,
          metadata,
          created_at

        FROM recovery_completions

        WHERE row_number = 1

        ORDER BY created_at DESC

        LIMIT 100
      `);
        /*
         * 5. Parse completed recovery metadata safely.
         */
        const completedRecoveries = completedRecoveriesResult.rows
            .map((row) => {
            let metadata = {};
            try {
                metadata =
                    typeof row.metadata ===
                        "string"
                        ? JSON.parse(row.metadata)
                        : row.metadata ?? {};
            }
            catch {
                metadata = {};
            }
            return {
                auditId: row.id,
                orderId: row.entity_id,
                amount: typeof metadata.amount ===
                    "number"
                    ? metadata.amount
                    : Number(metadata.amount ?? 0),
                currency: typeof metadata.currency ===
                    "string"
                    ? metadata.currency
                    : null,
                action: typeof metadata.action ===
                    "string"
                    ? metadata.action
                    : null,
                confidence: typeof metadata.confidence ===
                    "number"
                    ? metadata.confidence
                    : Number(metadata.confidence ?? 0),
                failureCode: typeof metadata.failureCode ===
                    "string"
                    ? metadata.failureCode
                    : null,
                createdAt: row.created_at,
            };
        })
            .filter((recovery) => recovery.amount > 0);
        /*
         * 6. Recovery revenue metrics.
         */
        const recoveredRevenue = completedRecoveries.reduce((total, recovery) => total + recovery.amount, 0);
        const recoveryCases = completedRecoveries.length;
        const successfulRecoveryCases = completedRecoveries.filter((recovery) => recovery.action === "RETRY").length;
        const recoverySuccessRate = recoveryCases > 0
            ? Math.round((successfulRecoveryCases /
                recoveryCases) *
                100)
            : 0;
        const revenueAtRisk = decisions.reduce((total, decision) => total + decision.amount, 0);
        const automatedRecoveryOpportunity = actionSummary.RETRY.amount;
        const escalationAmount = actionSummary.ESCALATE.amount;
        const stoppedAmount = actionSummary.STOP.amount;
        /*
         * 7. Failure reason distribution.
         */
        const failureReasons = {};
        for (const decision of decisions) {
            const reason = decision.failureCode ||
                "UNKNOWN";
            if (!failureReasons[reason]) {
                failureReasons[reason] = {
                    cases: 0,
                    amount: 0,
                };
            }
            failureReasons[reason].cases += 1;
            failureReasons[reason].amount +=
                decision.amount;
        }
        /*
         * 8. Return a buildathon-friendly intelligence payload.
         */
        return res.json({
            status: "ok",
            summary: {
                recoveryCases: decisions.length,
                revenueAtRisk,
                automatedRecoveryOpportunity,
                escalationAmount,
                stoppedAmount,
                recoveredRevenue,
                completedRecoveryCases: recoveryCases,
                recoverySuccessRate,
            },
            actionBreakdown: {
                RETRY: actionSummary.RETRY,
                STOP: actionSummary.STOP,
                ESCALATE: actionSummary.ESCALATE,
            },
            failureReasons,
            currentDecisions: decisions.slice(0, 20),
            recentRecoveries: completedRecoveries.slice(0, 20),
        });
    }
    catch (error) {
        console.error("Failed to build recovery intelligence:", error);
        return res.status(500).json({
            status: "error",
            error: "Failed to build recovery intelligence",
        });
    }
});
export default router;
//# sourceMappingURL=recovery.js.map