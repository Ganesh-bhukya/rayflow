import express from "express";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { getPgPool } from "../infrastructure/database/client.js";
import { canTransition } from "../services/paymentStateMachine.js";
import { razorpayConfig } from "../config/razorpay.js";
const router = express.Router();
/*
 * ============================================================
 * POST /webhooks/payment
 * ============================================================
 *
 * Internal/provider-agnostic payment webhook.
 *
 * Supported events:
 *
 *   payment.success
 *   payment.failed
 *
 * This route is kept intentionally separate from the
 * Razorpay-specific webhook below.
 * ============================================================
 */
router.post("/payment", express.json(), async (req, res) => {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
        const { eventId, eventType, orderId, attemptId, providerReference, } = req.body ?? {};
        /*
         * --------------------------------------------------------
         * STEP 1
         * Validate required fields.
         * --------------------------------------------------------
         */
        if (!eventId ||
            !eventType ||
            !orderId ||
            !attemptId) {
            return res.status(400).json({
                status: "error",
                error: "eventId, eventType, orderId and attemptId are required",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 2
         * Only process supported payment events.
         * --------------------------------------------------------
         */
        const supportedEvents = [
            "payment.success",
            "payment.failed",
        ];
        if (!supportedEvents.includes(eventType)) {
            return res.status(400).json({
                status: "error",
                error: "Unsupported webhook event",
            });
        }
        await client.query("BEGIN");
        /*
         * --------------------------------------------------------
         * STEP 3
         * Check whether this webhook was already received.
         *
         * Do NOT use FOR UPDATE here.
         *
         * The unique event_id constraint protects against
         * concurrent duplicate webhook inserts.
         * --------------------------------------------------------
         */
        const existingEvent = await client.query(`
      SELECT
        id,
        status
      FROM public.webhook_events
      WHERE event_id = $1
      LIMIT 1
      `, [eventId]);
        if (existingEvent.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(200).json({
                status: "ok",
                duplicate: true,
                message: "Webhook already processed",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 4
         * Verify payment order exists and lock it.
         * --------------------------------------------------------
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
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "error",
                error: "Payment order not found",
            });
        }
        const order = orderResult.rows[0];
        /*
         * --------------------------------------------------------
         * STEP 5
         * Verify payment attempt belongs to this order.
         *
         * Lock the attempt to prevent concurrent state changes.
         * --------------------------------------------------------
         */
        const attemptResult = await client.query(`
      SELECT
        id,
        order_id,
        payment_method,
        status,
        provider_reference,
        failure_code
      FROM public.payment_attempts
      WHERE id = $1
        AND order_id = $2
      FOR UPDATE
      `, [attemptId, orderId]);
        if (attemptResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "error",
                error: "Payment attempt not found",
            });
        }
        const attempt = attemptResult.rows[0];
        /*
         * --------------------------------------------------------
         * STEP 6
         * Store webhook event.
         * --------------------------------------------------------
         */
        const webhookPayload = JSON.stringify(req.body);
        const webhookResult = await client.query(`
      INSERT INTO public.webhook_events
      (
        id,
        event_id,
        event_type,
        order_id,
        payload,
        status,
        attempts
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        'processing',
        1
      )
      RETURNING id
      `, [
            randomUUID(),
            eventId,
            eventType,
            orderId,
            webhookPayload,
        ]);
        const webhookEventId = webhookResult.rows[0].id;
        /*
         * --------------------------------------------------------
         * STEP 6.5
         * Validate payment state transition.
         *
         * Prevents stale/out-of-order provider events from
         * moving a finalized payment backwards.
         * --------------------------------------------------------
         */
        const targetStatus = eventType === "payment.success"
            ? "success"
            : "failed";
        if (!canTransition(attempt.status, targetStatus)) {
            await client.query(`
        UPDATE public.webhook_events
        SET
          status = 'processed',
          processed_at = now(),
          updated_at = now()
        WHERE id = $1
        `, [webhookEventId]);
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
          'payment_webhook_ignored_invalid_transition',
          'payment_order',
          $1,
          $2
        )
        `, [
                orderId,
                JSON.stringify({
                    eventId,
                    eventType,
                    attemptId,
                    currentStatus: attempt.status,
                    requestedStatus: targetStatus,
                }),
            ]);
            await client.query("COMMIT");
            return res.status(200).json({
                status: "ok",
                eventId,
                eventType,
                processed: false,
                ignored: true,
                reason: "Invalid payment state transition",
                currentStatus: attempt.status,
            });
        }
        /*
         * ========================================================
         * PAYMENT SUCCESS
         * ========================================================
         */
        if (eventType === "payment.success") {
            /*
             * ------------------------------------------------------
             * STEP 7A
             * Mark attempt successful.
             * ------------------------------------------------------
             */
            await client.query(`
        UPDATE public.payment_attempts
        SET
          status = 'success',
          provider_reference = COALESCE($1, provider_reference),
          failure_code = NULL,
          updated_at = now()
        WHERE id = $2
        `, [
                providerReference ?? null,
                attempt.id,
            ]);
            /*
             * ------------------------------------------------------
             * STEP 8A
             * Mark order paid.
             * ------------------------------------------------------
             */
            await client.query(`
        UPDATE public.payment_orders
        SET
          status = 'paid',
          updated_at = now()
        WHERE id = $1
        `, [orderId]);
            /*
             * ------------------------------------------------------
             * STEP 9A
             * Check whether transaction already exists.
             * ------------------------------------------------------
             */
            const existingTransaction = await client.query(`
          SELECT
            id
          FROM public.transactions
          WHERE attempt_id = $1
          LIMIT 1
          `, [attempt.id]);
            let transactionId;
            if (existingTransaction.rows.length > 0) {
                transactionId =
                    existingTransaction.rows[0].id;
            }
            else {
                /*
                 * ----------------------------------------------------
                 * STEP 10A
                 * Create successful transaction.
                 * ----------------------------------------------------
                 */
                transactionId = randomUUID();
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
          `, [
                    transactionId,
                    orderId,
                    attempt.id,
                    order.amount,
                    order.currency,
                ]);
            }
            /*
             * ------------------------------------------------------
             * STEP 11A
             * Connect webhook event to transaction.
             * ------------------------------------------------------
             */
            await client.query(`
        UPDATE public.webhook_events
        SET
          transaction_id = $1,
          status = 'processed',
          processed_at = now(),
          updated_at = now()
        WHERE id = $2
        `, [
                transactionId,
                webhookEventId,
            ]);
            /*
             * ------------------------------------------------------
             * STEP 12A
             * Audit log.
             * ------------------------------------------------------
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
          'payment_webhook_processed',
          'payment_order',
          $1,
          $2
        )
        `, [
                orderId,
                JSON.stringify({
                    eventId,
                    eventType,
                    transactionId,
                    attemptId,
                }),
            ]);
            await client.query("COMMIT");
            return res.status(200).json({
                status: "ok",
                eventId,
                eventType,
                processed: true,
                transactionId,
            });
        }
        /*
         * ========================================================
         * PAYMENT FAILED
         * ========================================================
         */
        if (eventType === "payment.failed") {
            /*
             * ------------------------------------------------------
             * STEP 7B
             * Mark attempt failed.
             * ------------------------------------------------------
             */
            const failureCode = req.body.failureCode ??
                "PAYMENT_FAILED";
            await client.query(`
        UPDATE public.payment_attempts
        SET
          status = 'failed',
          failure_code = $1,
          provider_reference = COALESCE($2, provider_reference),
          updated_at = now()
        WHERE id = $3
        `, [
                failureCode,
                providerReference ?? null,
                attempt.id,
            ]);
            /*
             * ------------------------------------------------------
             * STEP 8B
             * Mark order failed.
             * ------------------------------------------------------
             */
            await client.query(`
        UPDATE public.payment_orders
        SET
          status = 'failed',
          updated_at = now()
        WHERE id = $1
        `, [orderId]);
            /*
             * ------------------------------------------------------
             * STEP 9B
             * Mark webhook processed.
             * ------------------------------------------------------
             */
            await client.query(`
        UPDATE public.webhook_events
        SET
          status = 'processed',
          processed_at = now(),
          updated_at = now()
        WHERE id = $1
        `, [webhookEventId]);
            /*
             * ------------------------------------------------------
             * STEP 10B
             * Audit log.
             * ------------------------------------------------------
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
          'payment_failed_webhook_processed',
          'payment_order',
          $1,
          $2
        )
        `, [
                orderId,
                JSON.stringify({
                    eventId,
                    eventType,
                    attemptId,
                    failureCode,
                }),
            ]);
            await client.query("COMMIT");
            return res.status(200).json({
                status: "ok",
                eventId,
                eventType,
                processed: true,
                failureCode,
            });
        }
        await client.query("ROLLBACK");
        return res.status(400).json({
            status: "error",
            error: "Unsupported webhook event",
        });
    }
    catch (error) {
        try {
            await client.query("ROLLBACK");
        }
        catch {
            // Ignore rollback errors.
        }
        console.error("Payment webhook error:", error);
        if (error?.code === "23505") {
            return res.status(200).json({
                status: "ok",
                duplicate: true,
                message: "Webhook already processed",
            });
        }
        return res.status(500).json({
            status: "error",
            error: "Failed to process payment webhook",
        });
    }
    finally {
        client.release();
    }
});
/*
 * ============================================================
 * Razorpay Webhook Helpers
 * ============================================================
 */
/**
 * Verify Razorpay's webhook signature.
 *
 * Razorpay signs the RAW HTTP request body using HMAC-SHA256.
 */
function verifyRazorpayWebhookSignature(rawBody, signature) {
    if (!signature) {
        return false;
    }
    const expectedSignature = createHmac("sha256", razorpayConfig.webhookSecret)
        .update(rawBody)
        .digest("hex");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const receivedBuffer = Buffer.from(signature.trim(), "utf8");
    if (expectedBuffer.length !==
        receivedBuffer.length) {
        return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
}
/**
 * Extract the Razorpay refund entity from the webhook.
 */
function getRazorpayRefundEntity(payload) {
    return (payload?.payload?.refund?.entity ??
        null);
}
/**
 * Extract RayFlow refund ID from Razorpay refund notes.
 *
 * Our refund creation service sends:
 *
 * notes.rayflowRefundId
 */
function getRayFlowRefundId(refundEntity) {
    const value = refundEntity?.notes?.rayflowRefundId;
    if (typeof value !== "string" ||
        !value.trim()) {
        return null;
    }
    return value.trim();
}
/*
 * ============================================================
 * POST /webhooks/razorpay
 * ============================================================
 *
 * Receives Razorpay webhook events.
 *
 * Supported refund events:
 *
 *   refund.created
 *   refund.processed
 *   refund.failed
 *
 * Important:
 *
 * Razorpay webhook delivery is at-least-once.
 * Therefore x-razorpay-event-id is used for idempotency.
 *
 * The RayFlow refund ID is read from:
 *
 *   payload.refund.entity.notes.rayflowRefundId
 *
 * The raw request body is required for signature
 * verification.
 * ============================================================
 */
router.post("/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    const signature = req.header("x-razorpay-signature");
    const razorpayEventId = req.header("x-razorpay-event-id");
    /*
     * --------------------------------------------------------
     * STEP 1
     * Validate raw body and signature.
     * --------------------------------------------------------
     */
    if (!rawBody) {
        console.error("Razorpay webhook rejected: raw body unavailable.");
        return res.status(400).json({
            status: "error",
            error: "Raw request body unavailable",
        });
    }
    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
        console.error("Razorpay webhook rejected: invalid signature.");
        return res.status(400).json({
            status: "error",
            error: "Invalid Razorpay webhook signature",
        });
    }
    /*
     * --------------------------------------------------------
     * STEP 2
     * Event ID is required for reliable deduplication.
     * --------------------------------------------------------
     */
    if (!razorpayEventId?.trim()) {
        return res.status(400).json({
            status: "error",
            error: "x-razorpay-event-id header is required",
        });
    }
    /*
     * --------------------------------------------------------
     * STEP 3
     * Parse the already-verified raw payload.
     * --------------------------------------------------------
     */
    let payload;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
    }
    catch {
        return res.status(400).json({
            status: "error",
            error: "Invalid JSON webhook payload",
        });
    }
    const eventType = payload?.event;
    const supportedRefundEvents = [
        "refund.created",
        "refund.processed",
        "refund.failed",
    ];
    if (!supportedRefundEvents.includes(eventType)) {
        /*
         * Signature is valid, but this RayFlow endpoint
         * does not process this event type.
         *
         * Return 200 so Razorpay does not repeatedly retry
         * an event that RayFlow intentionally does not handle.
         */
        return res.status(200).json({
            status: "ok",
            eventId: razorpayEventId,
            eventType,
            processed: false,
            ignored: true,
            reason: "Unsupported Razorpay refund event",
        });
    }
    const refundEntity = getRazorpayRefundEntity(payload);
    if (!refundEntity) {
        return res.status(400).json({
            status: "error",
            error: "Razorpay refund entity not found",
        });
    }
    const rayFlowRefundId = getRayFlowRefundId(refundEntity);
    if (!rayFlowRefundId) {
        /*
         * We cannot safely associate this refund with a
         * RayFlow refund record.
         */
        console.error("Razorpay refund webhook missing RayFlow refund ID.", {
            eventId: razorpayEventId,
            eventType,
            razorpayRefundId: refundEntity?.id,
        });
        return res.status(400).json({
            status: "error",
            error: "RayFlow refund ID missing from Razorpay refund notes",
        });
    }
    const pool = getPgPool();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        /*
         * --------------------------------------------------------
         * STEP 4
         * Deduplicate Razorpay event.
         * --------------------------------------------------------
         */
        const existingEvent = await client.query(`
        SELECT
          id,
          status
        FROM public.webhook_events
        WHERE event_id = $1
        LIMIT 1
        `, [razorpayEventId]);
        if (existingEvent.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(200).json({
                status: "ok",
                duplicate: true,
                eventId: razorpayEventId,
                eventType,
                message: "Razorpay webhook already received",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 5
         * Lock RayFlow refund.
         *
         * This prevents two different Razorpay refund events
         * from changing the same refund simultaneously.
         * --------------------------------------------------------
         */
        const refundResult = await client.query(`
        SELECT
          id,
          transaction_id,
          amount,
          status,
          reason,
          created_at,
          updated_at
        FROM public.refunds
        WHERE id = $1
        FOR UPDATE
        `, [rayFlowRefundId]);
        if (refundResult.rows.length === 0) {
            /*
             * Store the event as failed/ignored so that the
             * same event does not repeatedly cause expensive
             * database work.
             */
            await client.query(`
        INSERT INTO public.webhook_events
        (
          id,
          event_id,
          event_type,
          payload,
          status,
          attempts
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          'failed',
          1
        )
        `, [
                randomUUID(),
                razorpayEventId,
                eventType,
                rawBody.toString("utf8"),
            ]);
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
          'razorpay_refund_webhook_refund_not_found',
          'refund',
          $1,
          $2
        )
        `, [
                rayFlowRefundId,
                JSON.stringify({
                    eventId: razorpayEventId,
                    eventType,
                    razorpayRefundId: refundEntity?.id ?? null,
                }),
            ]);
            await client.query("COMMIT");
            return res.status(404).json({
                status: "error",
                error: "RayFlow refund not found",
            });
        }
        const refund = refundResult.rows[0];
        /*
         * --------------------------------------------------------
         * STEP 6
         * Validate provider refund amount.
         * --------------------------------------------------------
         *
         * This prevents an incorrectly correlated webhook from
         * changing a refund for a different amount.
         */
        if (Number(refundEntity.amount) !==
            Number(refund.amount)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                status: "error",
                error: "Razorpay refund amount does not match RayFlow refund",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 7
         * Store webhook event.
         * --------------------------------------------------------
         */
        const webhookResult = await client.query(`
        INSERT INTO public.webhook_events
        (
          id,
          event_id,
          event_type,
          payload,
          status,
          attempts
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          'processing',
          1
        )
        RETURNING id
        `, [
            randomUUID(),
            razorpayEventId,
            eventType,
            rawBody.toString("utf8"),
        ]);
        const webhookEventId = webhookResult.rows[0].id;
        /*
         * ========================================================
         * STEP 8
         * Determine desired RayFlow refund state.
         * ========================================================
         */
        let requestedStatus;
        if (eventType === "refund.processed") {
            requestedStatus = "success";
        }
        else if (eventType === "refund.failed") {
            requestedStatus = "failed";
        }
        else {
            requestedStatus = "pending";
        }
        /*
         * --------------------------------------------------------
         * STEP 9
         * Protect refund state from stale/out-of-order events.
         *
         * Valid:
         *
         * pending -> success
         * pending -> failed
         *
         * refund.created does not regress success/failed.
         *
         * Invalid:
         *
         * success -> pending
         * success -> failed
         * failed  -> pending
         * failed  -> success
         * --------------------------------------------------------
         */
        const currentStatus = refund.status;
        let shouldUpdateRefund = false;
        if (currentStatus === "pending") {
            if (requestedStatus === "success" ||
                requestedStatus === "failed") {
                shouldUpdateRefund = true;
            }
        }
        /*
         * If refund.created arrives while the refund is already
         * pending, there is nothing to change.
         */
        if (currentStatus === "pending" &&
            requestedStatus === "pending") {
            shouldUpdateRefund = false;
        }
        /*
         * If the refund is already finalized, do not move it
         * backwards regardless of webhook ordering.
         */
        if (currentStatus === "success" ||
            currentStatus === "failed") {
            shouldUpdateRefund = false;
        }
        /*
         * --------------------------------------------------------
         * STEP 10
         * Update refund when the transition is valid.
         * --------------------------------------------------------
         */
        if (shouldUpdateRefund) {
            await client.query(`
        UPDATE public.refunds
        SET
          status = $1,
          updated_at = now()
        WHERE id = $2
        `, [
                requestedStatus,
                refund.id,
            ]);
        }
        /*
         * --------------------------------------------------------
         * STEP 11
         * Mark webhook processed.
         * --------------------------------------------------------
         */
        await client.query(`
      UPDATE public.webhook_events
      SET
        status = 'processed',
        processed_at = now(),
        updated_at = now()
      WHERE id = $1
      `, [webhookEventId]);
        /*
         * --------------------------------------------------------
         * STEP 12
         * Audit the provider event.
         *
         * Provider refund ID and complete provider metadata are
         * retained in the audit log because the current refunds
         * table does not contain a dedicated provider_refund_id
         * column.
         * --------------------------------------------------------
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
        'refund',
        $2,
        $3
      )
      `, [
            shouldUpdateRefund
                ? "razorpay_refund_webhook_processed"
                : "razorpay_refund_webhook_ignored_state",
            refund.id,
            JSON.stringify({
                eventId: razorpayEventId,
                eventType,
                rayFlowRefundId: refund.id,
                razorpayRefundId: refundEntity?.id ?? null,
                razorpayPaymentId: refundEntity?.payment_id ?? null,
                razorpayStatus: refundEntity?.status ?? null,
                amount: refundEntity?.amount ?? null,
                currency: refundEntity?.currency ?? null,
                speedProcessed: refundEntity?.speed_processed ??
                    null,
                speedRequested: refundEntity?.speed_requested ??
                    null,
                currentStatus,
                requestedStatus,
                finalStatus: shouldUpdateRefund
                    ? requestedStatus
                    : currentStatus,
            }),
        ]);
        await client.query("COMMIT");
        /*
         * --------------------------------------------------------
         * STEP 13
         * Return successful acknowledgement.
         * --------------------------------------------------------
         */
        return res.status(200).json({
            status: "ok",
            eventId: razorpayEventId,
            eventType,
            processed: true,
            updated: shouldUpdateRefund,
            refundId: refund.id,
            razorpayRefundId: refundEntity?.id ?? null,
            previousStatus: currentStatus,
            currentStatus: shouldUpdateRefund
                ? requestedStatus
                : currentStatus,
        });
    }
    catch (error) {
        try {
            await client.query("ROLLBACK");
        }
        catch {
            // Ignore rollback errors.
        }
        console.error("Razorpay webhook error:", error);
        /*
         * Concurrent duplicate event.
         *
         * webhook_events.event_id is protected by a unique
         * database constraint.
         */
        if (error?.code === "23505") {
            return res.status(200).json({
                status: "ok",
                duplicate: true,
                eventId: razorpayEventId,
                message: "Razorpay webhook already processed",
            });
        }
        return res.status(500).json({
            status: "error",
            error: "Failed to process Razorpay webhook",
        });
    }
    finally {
        client.release();
    }
});
export default router;
//# sourceMappingURL=webhooks.js.map