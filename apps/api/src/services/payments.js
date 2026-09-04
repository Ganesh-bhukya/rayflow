import express from "express";
import { randomUUID } from "crypto";
import { getPgPool } from "../infrastructure/database/client.js";
import { assertTransition } from "../services/paymentStateMachine.js";
import { createRayFlowRazorpayOrder } from "../services/razorpayOrderService.js";
import { verifyRazorpayPayment, } from "./razorpayVerificationService.js";
console.log("🔥 RAZORPAY PAYMENTS ROUTE LOADED:", new Date().toISOString());
const router = express.Router();
/**
 * ============================================================
 * GET /payments
 * ============================================================
 *
 * Returns the latest 100 payment orders with:
 * - customer
 * - merchant
 * - latest payment attempt
 * - latest transaction
 * - Razorpay order ID
 */ /**
* ============================================================
* POST /payments/razorpay/verify
* ============================================================
*
* Verifies a successful Razorpay Checkout payment.
*
* The client sends:
*
* {
*   "rayflowPaymentId": "...",
*   "razorpayPaymentId": "...",
*   "razorpayOrderId": "...",
*   "razorpaySignature": "..."
* }
*
* The server:
*
* 1. Finds the RayFlow payment.
* 2. Confirms the Razorpay Order ID matches the
*    server-stored Razorpay Order ID.
* 3. Verifies the Razorpay HMAC signature.
* 4. Locks the RayFlow payment.
* 5. Marks the payment attempt successful.
* 6. Marks the payment order paid.
* 7. Creates the successful transaction.
*
* This endpoint is intentionally server-side.
*/
router.post("/razorpay/verify", async (req, res) => {
    try {
        const { rayflowPaymentId, razorpayPaymentId, razorpayOrderId, razorpaySignature, } = req.body ?? {};
        if (typeof rayflowPaymentId !== "string" ||
            rayflowPaymentId.trim() === "") {
            return res.status(400).json({
                status: "error",
                error: "rayflowPaymentId is required",
            });
        }
        if (typeof razorpayPaymentId !== "string" ||
            razorpayPaymentId.trim() === "") {
            return res.status(400).json({
                status: "error",
                error: "razorpayPaymentId is required",
            });
        }
        if (typeof razorpayOrderId !== "string" ||
            razorpayOrderId.trim() === "") {
            return res.status(400).json({
                status: "error",
                error: "razorpayOrderId is required",
            });
        }
        if (typeof razorpaySignature !== "string" ||
            razorpaySignature.trim() === "") {
            return res.status(400).json({
                status: "error",
                error: "razorpaySignature is required",
            });
        }
        const result = await verifyRazorpayPayment({
            rayflowPaymentId: rayflowPaymentId.trim(),
            razorpayPaymentId: razorpayPaymentId.trim(),
            razorpayOrderId: razorpayOrderId.trim(),
            razorpaySignature: razorpaySignature.trim(),
        });
        return res.status(200).json({
            ...result,
            status: "ok",
        });
    }
    catch (error) {
        console.error("Razorpay payment verification error:", error);
        const message = error instanceof Error
            ? error.message
            : "Failed to verify Razorpay payment";
        if (message === "Payment not found") {
            return res.status(404).json({
                status: "error",
                error: message,
            });
        }
        if (message ===
            "Razorpay order ID does not match the RayFlow payment") {
            return res.status(409).json({
                status: "error",
                error: message,
            });
        }
        if (message === "Invalid Razorpay payment signature") {
            return res.status(400).json({
                status: "error",
                error: message,
            });
        }
        if (message ===
            "Payment order is already paid") {
            return res.status(200).json({
                status: "ok",
                verified: true,
                idempotent: true,
                message,
            });
        }
        return res.status(500).json({
            status: "error",
            error: "Failed to verify Razorpay payment",
        });
    }
});
router.get("/", async (_req, res) => {
    try {
        const pool = getPgPool();
        const query = `
      SELECT
        po.id,
        po.amount,
        po.currency,
        po.status,
        po.idempotency_key AS "idempotencyKey",
        po.razorpay_order_id AS "razorpayOrderId",
        po.created_at AS "createdAt",
        po.updated_at AS "updatedAt",

        m.id AS "merchantId",
        m.business_name AS "merchantName",
        m.merchant_code AS "merchantCode",

        c.id AS "customerId",
        c.name AS "customerName",
        c.email AS "customerEmail",
        c.phone AS "customerPhone",

        pa.id AS "attemptId",
        pa.payment_method AS "paymentMethod",
        pa.status AS "attemptStatus",
        pa.provider_reference AS "providerReference",
        pa.failure_code AS "failureCode",
        pa.created_at AS "attemptCreatedAt",

        t.id AS "transactionId",
        t.amount AS "transactionAmount",
        t.currency AS "transactionCurrency",
        t.type AS "transactionType",
        t.status AS "transactionStatus",
        t.created_at AS "transactionCreatedAt"

      FROM public.payment_orders po

      LEFT JOIN public.merchants m
        ON m.id = po.merchant_id

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      LEFT JOIN LATERAL (
        SELECT
          id,
          payment_method,
          status,
          provider_reference,
          failure_code,
          created_at
        FROM public.payment_attempts
        WHERE order_id = po.id
        ORDER BY created_at DESC
        LIMIT 1
      ) pa ON true

      LEFT JOIN LATERAL (
        SELECT
          id,
          amount,
          currency,
          type,
          status,
          created_at
        FROM public.transactions
        WHERE order_id = po.id
        ORDER BY created_at DESC
        LIMIT 1
      ) t ON true

      ORDER BY po.created_at DESC
      LIMIT 100;
    `;
        const result = await pool.query(query);
        return res.json({
            status: "ok",
            payments: result.rows,
        });
    }
    catch (error) {
        console.error("Failed to fetch payments:", error);
        return res.status(500).json({
            status: "error",
            error: "Failed to fetch payments",
        });
    }
});
/**
 * ============================================================
 * POST /payments
 * ============================================================
 *
 * Creates a new RayFlow payment order and a Razorpay Test Mode
 * order.
 *
 * REQUIRED HEADER:
 *
 * Idempotency-Key: unique-client-request-id
 *
 * The same Idempotency-Key can safely be retried.
 *
 * Example:
 *
 * POST /payments
 *
 * Headers:
 * Idempotency-Key: order_12345
 *
 * Body:
 * {
 *   "amount": 50000,
 *   "currency": "INR",
 *   "merchantId": "...",
 *   "customerId": "...",
 *   "paymentMethod": "card"
 * }
 */
router.post("/", async (req, res) => {
    const pool = getPgPool();
    const client = await pool.connect();
    let idempotencyKey = "";
    try {
        /*
         * --------------------------------------------------------
         * STEP 1
         * Read Idempotency-Key
         * --------------------------------------------------------
         */
        const rawIdempotencyKey = req.header("Idempotency-Key");
        if (!rawIdempotencyKey) {
            return res.status(400).json({
                status: "error",
                error: "Idempotency-Key header is required",
            });
        }
        const idempotencyKey = rawIdempotencyKey.trim();
        /*
         * Prevent excessively large keys.
         */
        if (idempotencyKey.length === 0 ||
            idempotencyKey.length > 255) {
            return res.status(400).json({
                status: "error",
                error: "Idempotency-Key must contain between 1 and 255 characters",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 2
         * Read request body
         * --------------------------------------------------------
         */
        const { amount, currency = "INR", merchantId, customerId, paymentMethod = "card", } = req.body ?? {};
        /*
         * --------------------------------------------------------
         * STEP 3
         * Validate amount
         * --------------------------------------------------------
         */
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) ||
            numericAmount <= 0) {
            return res.status(400).json({
                status: "error",
                error: "amount must be a positive number",
            });
        }
        /*
         * --------------------------------------------------------
         * RayFlow stores money in the smallest currency unit.
         *
         * Example:
         *
         * ₹500 = 50000 paise
         *
         * Razorpay Orders API also expects the smallest
         * currency unit.
         * --------------------------------------------------------
         */
        const normalizedAmount = Math.round(numericAmount);
        /*
         * --------------------------------------------------------
         * STEP 4
         * Validate currency
         * --------------------------------------------------------
         */
        const normalizedCurrency = String(currency)
            .trim()
            .toUpperCase();
        if (normalizedCurrency.length !== 3) {
            return res.status(400).json({
                status: "error",
                error: "currency must be a valid 3-letter currency code",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 5
         * Validate merchant
         * --------------------------------------------------------
         */
        if (typeof merchantId !== "string" ||
            merchantId.trim() === "") {
            return res.status(400).json({
                status: "error",
                error: "merchantId is required",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 6
         * Validate customer
         * --------------------------------------------------------
         */
        if (typeof customerId !== "string" ||
            customerId.trim() === "") {
            return res.status(400).json({
                status: "error",
                error: "customerId is required",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 7
         * Validate payment method
         * --------------------------------------------------------
         */
        const normalizedPaymentMethod = String(paymentMethod)
            .trim()
            .toLowerCase();
        const allowedPaymentMethods = [
            "card",
            "upi",
            "netbanking",
            "wallet",
        ];
        if (!allowedPaymentMethods.includes(normalizedPaymentMethod)) {
            return res.status(400).json({
                status: "error",
                error: "Unsupported payment method",
                allowedPaymentMethods,
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 8
         * Start database transaction
         * --------------------------------------------------------
         *
         * The payment row is locked while we perform the
         * Razorpay order creation.
         *
         * This is intentional for this buildathon implementation:
         * it prevents two simultaneous requests with the same
         * Idempotency-Key from creating two Razorpay orders.
         */
        await client.query("BEGIN");
        /*
         * --------------------------------------------------------
         * STEP 9
         * Check whether this Idempotency-Key already exists.
         * --------------------------------------------------------
         */
        const existingPaymentResult = await client.query(`
        SELECT
          id,
          amount,
          currency,
          status,
          idempotency_key AS "idempotencyKey",
          razorpay_order_id AS "razorpayOrderId",
          merchant_id AS "merchantId",
          customer_id AS "customerId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"

        FROM public.payment_orders

        WHERE idempotency_key = $1

        LIMIT 1

        FOR UPDATE
        `, [idempotencyKey]);
        /*
         * --------------------------------------------------------
         * STEP 10
         * Existing request found.
         * --------------------------------------------------------
         */
        if (existingPaymentResult.rows.length > 0) {
            const existingPayment = existingPaymentResult.rows[0];
            /*
             * Same idempotency key must represent
             * the same logical request.
             */
            const requestMatches = Number(existingPayment.amount) ===
                normalizedAmount &&
                String(existingPayment.currency).toUpperCase() ===
                    normalizedCurrency &&
                String(existingPayment.merchantId) === merchantId &&
                String(existingPayment.customerId) === customerId;
            if (!requestMatches) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    status: "error",
                    error: "Idempotency-Key has already been used with different payment details",
                });
            }
            /*
             * Safe retry.
             *
             * Do NOT create:
             * - another RayFlow payment
             * - another Razorpay order
             * - another payment attempt
             */
            await client.query("COMMIT");
            return res.status(200).json({
                status: "ok",
                idempotent: true,
                message: "Existing payment returned for Idempotency-Key",
                payment: existingPayment,
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 11
         * Verify merchant exists and is active.
         * --------------------------------------------------------
         */
        const merchantResult = await client.query(`
        SELECT
          id,
          business_name,
          merchant_code,
          is_active

        FROM public.merchants

        WHERE id = $1

        LIMIT 1
        `, [merchantId]);
        if (merchantResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "error",
                error: "Merchant not found",
            });
        }
        const merchant = merchantResult.rows[0];
        if (!merchant.is_active) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                status: "error",
                error: "Merchant is inactive",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 12
         * Verify customer exists.
         * --------------------------------------------------------
         */
        const customerResult = await client.query(`
        SELECT
          id,
          name,
          email,
          phone

        FROM public.customers

        WHERE id = $1

        LIMIT 1
        `, [customerId]);
        if (customerResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                status: "error",
                error: "Customer not found",
            });
        }
        /*
         * --------------------------------------------------------
         * STEP 13
         * Generate RayFlow payment order ID.
         * --------------------------------------------------------
         */
        const orderId = randomUUID();
        /*
         * --------------------------------------------------------
         * STEP 14
         * Create RayFlow payment order.
         * --------------------------------------------------------
         */
        const orderResult = await client.query(`
        INSERT INTO public.payment_orders
        (
          id,
          merchant_id,
          customer_id,
          amount,
          currency,
          status,
          idempotency_key
        )

        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          'processing',
          $6
        )

        RETURNING
          id,
          merchant_id AS "merchantId",
          customer_id AS "customerId",
          amount,
          currency,
          status,
          idempotency_key AS "idempotencyKey",
          razorpay_order_id AS "razorpayOrderId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `, [
            orderId,
            merchantId,
            customerId,
            normalizedAmount,
            normalizedCurrency,
            idempotencyKey,
        ]);
        const payment = orderResult.rows[0];
        /*
         * --------------------------------------------------------
         * STEP 15
         * Create Razorpay Test Mode Order.
         * --------------------------------------------------------
         *
         * IMPORTANT:
         *
         * normalizedAmount is already in the smallest currency
         * unit, which is exactly what Razorpay Orders API expects.
         */
        const razorpayOrder = await createRayFlowRazorpayOrder({
            orderId,
            amount: normalizedAmount,
            currency: normalizedCurrency,
            merchantId,
            customerId,
        });
        /*
         * --------------------------------------------------------
         * STEP 16
         * Persist Razorpay Order ID.
         * --------------------------------------------------------
         */
        const razorpayUpdateResult = await client.query(`
        UPDATE public.payment_orders

        SET
          razorpay_order_id = $1,
          updated_at = now()

        WHERE id = $2

        RETURNING
          id,
          merchant_id AS "merchantId",
          customer_id AS "customerId",
          amount,
          currency,
          status,
          idempotency_key AS "idempotencyKey",
          razorpay_order_id AS "razorpayOrderId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `, [
            razorpayOrder.id,
            orderId,
        ]);
        const paymentWithRazorpayOrder = razorpayUpdateResult.rows[0];
        /*
         * --------------------------------------------------------
         * STEP 17
         * Create initial payment attempt.
         *
         * State machine:
         *
         * created -> processing
         * --------------------------------------------------------
         */
        const attemptId = randomUUID();
        await client.query(`
      INSERT INTO public.payment_attempts
      (
        id,
        order_id,
        payment_method,
        status
      )

      VALUES
      (
        $1,
        $2,
        $3,
        'created'
      )
      `, [
            attemptId,
            orderId,
            normalizedPaymentMethod,
        ]);
        /*
         * --------------------------------------------------------
         * STEP 18
         * Move attempt to processing.
         * --------------------------------------------------------
         */
        assertTransition("created", "processing");
        await client.query(`
      UPDATE public.payment_attempts

      SET
        status = 'processing'

      WHERE id = $1
      `, [attemptId]);
        /*
         * --------------------------------------------------------
         * STEP 19
         * Commit payment creation.
         * --------------------------------------------------------
         */
        await client.query("COMMIT");
        /*
         * --------------------------------------------------------
         * STEP 20
         * Return created payment.
         * --------------------------------------------------------
         */
        return res.status(201).json({
            status: "ok",
            idempotent: false,
            message: "Payment and Razorpay order created successfully",
            payment: {
                ...paymentWithRazorpayOrder,
                attemptId,
                paymentMethod: normalizedPaymentMethod,
                razorpay: {
                    orderId: razorpayOrder.id,
                    amount: razorpayOrder.amount,
                    currency: razorpayOrder.currency,
                    status: razorpayOrder.status,
                    receipt: razorpayOrder.receipt,
                },
            },
        });
    }
    catch (error) {
        /*
         * --------------------------------------------------------
         * Rollback on error.
         * --------------------------------------------------------
         */
        try {
            await client.query("ROLLBACK");
        }
        catch (rollbackError) {
            console.error("Payment rollback error:", rollbackError);
        }
        /*
         * --------------------------------------------------------
         * Handle PostgreSQL unique constraint.
         *
         * This protects us from two simultaneous requests
         * using the same Idempotency-Key.
         * --------------------------------------------------------
         */
        if (error?.code === "23505" &&
            error?.constraint ===
                "payment_orders_idempotency_key_unique") {
            try {
                const existingResult = await pool.query(`
            SELECT
              id,
              amount,
              currency,
              status,
              idempotency_key AS "idempotencyKey",
              razorpay_order_id AS "razorpayOrderId",
              merchant_id AS "merchantId",
              customer_id AS "customerId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"

            FROM public.payment_orders

            WHERE idempotency_key = $1

            LIMIT 1
            `, [idempotencyKey]);
                if (existingResult.rows.length > 0) {
                    return res.status(200).json({
                        status: "ok",
                        idempotent: true,
                        message: "Existing payment returned for Idempotency-Key",
                        payment: existingResult.rows[0],
                    });
                }
            }
            catch (lookupError) {
                console.error("Failed to retrieve existing idempotent payment:", lookupError);
            }
        }
        console.error("Payment creation error:", error);
        return res.status(500).json({
            status: "error",
            error: "Failed to create payment",
        });
    }
    finally {
        client.release();
    }
});
/**
 * ============================================================
 * GET /payments/:id
 * ============================================================
 *
 * Returns complete details for one payment.
 */
router.get("/:id", async (req, res) => {
    try {
        const pool = getPgPool();
        const { id } = req.params;
        const paymentQuery = `
      SELECT
        po.id,
        po.amount,
        po.currency,
        po.status,
        po.idempotency_key AS "idempotencyKey",
        po.razorpay_order_id AS "razorpayOrderId",
        po.created_at AS "createdAt",
        po.updated_at AS "updatedAt",

        m.id AS "merchantId",
        m.business_name AS "merchantName",
        m.merchant_code AS "merchantCode",

        c.id AS "customerId",
        c.name AS "customerName",
        c.email AS "customerEmail",
        c.phone AS "customerPhone",

        pa.id AS "attemptId",
        pa.payment_method AS "paymentMethod",
        pa.status AS "attemptStatus",
        pa.provider_reference AS "providerReference",
        pa.failure_code AS "failureCode",
        pa.created_at AS "attemptCreatedAt",

        t.id AS "transactionId",
        t.amount AS "transactionAmount",
        t.currency AS "transactionCurrency",
        t.type AS "transactionType",
        t.status AS "transactionStatus",
        t.created_at AS "transactionCreatedAt"

      FROM public.payment_orders po

      LEFT JOIN public.merchants m
        ON m.id = po.merchant_id

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      LEFT JOIN LATERAL (
        SELECT
          id,
          payment_method,
          status,
          provider_reference,
          failure_code,
          created_at
        FROM public.payment_attempts
        WHERE order_id = po.id
        ORDER BY created_at DESC
        LIMIT 1
      ) pa ON true

      LEFT JOIN LATERAL (
        SELECT
          id,
          amount,
          currency,
          type,
          status,
          created_at
        FROM public.transactions
        WHERE order_id = po.id
        ORDER BY created_at DESC
        LIMIT 1
      ) t ON true

      WHERE po.id = $1
      LIMIT 1;
    `;
        const paymentResult = await pool.query(paymentQuery, [id]);
        if (paymentResult.rows.length === 0) {
            return res.status(404).json({
                status: "error",
                error: "Payment not found",
            });
        }
        const attemptsQuery = `
      SELECT
        id,
        payment_method AS "paymentMethod",
        status,
        provider_reference AS "providerReference",
        failure_code AS "failureCode",
        created_at AS "createdAt",
        updated_at AS "updatedAt"

      FROM public.payment_attempts

      WHERE order_id = $1

      ORDER BY created_at DESC;
    `;
        const attemptsResult = await pool.query(attemptsQuery, [id]);
        const transactionsQuery = `
      SELECT
        id,
        amount,
        currency,
        type,
        status,
        created_at AS "createdAt"

      FROM public.transactions

      WHERE order_id = $1

      ORDER BY created_at DESC;
    `;
        const transactionsResult = await pool.query(transactionsQuery, [id]);
        const refundsQuery = `
      SELECT
        r.id,
        r.transaction_id AS "transactionId",
        r.amount,
        r.status,
        r.reason,
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt"

      FROM public.refunds r

      INNER JOIN public.transactions t
        ON t.id = r.transaction_id

      WHERE t.order_id = $1

      ORDER BY r.created_at DESC;
    `;
        const refundsResult = await pool.query(refundsQuery, [id]);
        return res.json({
            status: "ok",
            payment: paymentResult.rows[0],
            attempts: attemptsResult.rows,
            transactions: transactionsResult.rows,
            refunds: refundsResult.rows,
        });
    }
    catch (error) {
        console.error("Failed to fetch payment details:", error);
        return res.status(500).json({
            status: "error",
            error: "Failed to fetch payment details",
        });
    }
});
export default router;
//# sourceMappingURL=payments.js.map