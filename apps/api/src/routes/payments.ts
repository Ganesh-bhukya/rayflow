import express from "express";
import { randomUUID } from "crypto";
import { getPgPool } from "../infrastructure/database/client.js";
import { processPayment } from "../services/paymentService.js";

const router = express.Router();

/*
 * ============================================================
 * GET /payments
 * ============================================================
 *
 * Returns the latest 100 payment orders with:
 * - customer
 * - merchant
 * - latest payment attempt
 * - latest transaction
 */
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
  } catch (error) {
    console.error("Failed to fetch payments:", error);

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch payments",
    });
  }
});


/*
 * ============================================================
 * POST /payments
 * ============================================================
 *
 * Creates a new payment order.
 *
 * Header:
 * Idempotency-Key: unique-request-key
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

  try {
    /*
     * STEP 1
     * Read Idempotency-Key
     */
    const rawIdempotencyKey =
      req.header("Idempotency-Key");

    if (!rawIdempotencyKey) {
      return res.status(400).json({
        status: "error",
        error: "Idempotency-Key header is required",
      });
    }

    const idempotencyKey =
      rawIdempotencyKey.trim();

    if (
      idempotencyKey.length === 0 ||
      idempotencyKey.length > 255
    ) {
      return res.status(400).json({
        status: "error",
        error:
          "Idempotency-Key must contain between 1 and 255 characters",
      });
    }

    /*
     * STEP 2
     * Read request body
     */
    const {
      amount,
      currency = "INR",
      merchantId,
      customerId,
      paymentMethod = "card",
    } = req.body ?? {};

    /*
     * STEP 3
     * Validate amount
     */
    const numericAmount = Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return res.status(400).json({
        status: "error",
        error: "amount must be a positive number",
      });
    }

    /*
     * Money is stored in the smallest currency unit.
     */
    const normalizedAmount =
      Math.round(numericAmount);

    /*
     * STEP 4
     * Validate currency
     */
    const normalizedCurrency =
      String(currency)
        .trim()
        .toUpperCase();

    if (normalizedCurrency.length !== 3) {
      return res.status(400).json({
        status: "error",
        error:
          "currency must be a valid 3-letter currency code",
      });
    }

    /*
     * STEP 5
     * Validate merchant
     */
    if (
      typeof merchantId !== "string" ||
      merchantId.trim() === ""
    ) {
      return res.status(400).json({
        status: "error",
        error: "merchantId is required",
      });
    }

    /*
     * STEP 6
     * Validate customer
     */
    if (
      typeof customerId !== "string" ||
      customerId.trim() === ""
    ) {
      return res.status(400).json({
        status: "error",
        error: "customerId is required",
      });
    }

    /*
     * STEP 7
     * Validate payment method
     */
    const normalizedPaymentMethod =
      String(paymentMethod)
        .trim()
        .toLowerCase();

    const allowedPaymentMethods = [
      "card",
      "upi",
      "netbanking",
      "wallet",
    ];

    if (
      !allowedPaymentMethods.includes(
        normalizedPaymentMethod,
      )
    ) {
      return res.status(400).json({
        status: "error",
        error: "Unsupported payment method",
        allowedPaymentMethods,
      });
    }

    /*
     * STEP 8
     * Start database transaction
     */
    await client.query("BEGIN");

    /*
     * STEP 9
     * Check idempotency key
     */
    const existingPaymentResult =
      await client.query(
        `
        SELECT
          id,
          amount,
          currency,
          status,
          idempotency_key AS "idempotencyKey",
          merchant_id AS "merchantId",
          customer_id AS "customerId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"

        FROM public.payment_orders

        WHERE idempotency_key = $1

        LIMIT 1

        FOR UPDATE
        `,
        [idempotencyKey],
      );

    /*
     * STEP 10
     * Existing request
     */
    if (
      existingPaymentResult.rows.length > 0
    ) {
      const existingPayment =
        existingPaymentResult.rows[0];

      const requestMatches =
        Number(existingPayment.amount) ===
          normalizedAmount &&
        String(
          existingPayment.currency,
        ).toUpperCase() ===
          normalizedCurrency &&
        String(
          existingPayment.merchantId,
        ) === merchantId &&
        String(
          existingPayment.customerId,
        ) === customerId;

      if (!requestMatches) {
        await client.query("ROLLBACK");

        return res.status(409).json({
          status: "error",
          error:
            "Idempotency-Key has already been used with different payment details",
        });
      }

      await client.query("COMMIT");

      return res.status(200).json({
        status: "ok",
        idempotent: true,
        message:
          "Existing payment returned for Idempotency-Key",
        payment: existingPayment,
      });
    }

    /*
     * STEP 11
     * Verify merchant
     */
    const merchantResult =
      await client.query(
        `
        SELECT
          id,
          business_name,
          merchant_code,
          is_active

        FROM public.merchants

        WHERE id = $1

        LIMIT 1
        `,
        [merchantId],
      );

    if (merchantResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        status: "error",
        error: "Merchant not found",
      });
    }

    const merchant =
      merchantResult.rows[0];

    if (!merchant.is_active) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        status: "error",
        error: "Merchant is inactive",
      });
    }

    /*
     * STEP 12
     * Verify customer
     */
    const customerResult =
      await client.query(
        `
        SELECT
          id,
          name,
          email,
          phone

        FROM public.customers

        WHERE id = $1

        LIMIT 1
        `,
        [customerId],
      );

    if (customerResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        status: "error",
        error: "Customer not found",
      });
    }

    /*
     * STEP 13
     * Generate order ID
     */
    const orderId = randomUUID();

    /*
     * STEP 14
     * Create payment order
     */
    const orderResult =
      await client.query(
        `
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
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        `,
        [
          orderId,
          merchantId,
          customerId,
          normalizedAmount,
          normalizedCurrency,
          idempotencyKey,
        ],
      );

    const payment =
      orderResult.rows[0];

    /*
     * STEP 15
     * Create initial payment attempt
     */
    const attemptId = randomUUID();

    await client.query(
      `
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
      `,
      [
        attemptId,
        orderId,
        normalizedPaymentMethod,
      ],
    );

    /*
     * STEP 16
     * Move attempt to processing
     */
    await client.query(
      `
      UPDATE public.payment_attempts

      SET
        status = 'processing',
        updated_at = NOW()

      WHERE id = $1
      `,
      [attemptId],
    );

    /*
     * STEP 17
     * Commit
     */
    await client.query("COMMIT");

    /*
     * STEP 18
     * Return created payment
     */
    return res.status(201).json({
      status: "ok",
      idempotent: false,
      message: "Payment created successfully",
      payment: {
        ...payment,
        attemptId,
        paymentMethod:
          normalizedPaymentMethod,
      },
    });
  } catch (error: any) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Payment rollback error:",
        rollbackError,
      );
    }

    /*
     * Handle idempotency race condition.
     */
    if (
      error?.code === "23505" &&
      error?.constraint ===
        "payment_orders_idempotency_key_unique"
    ) {
      try {
        const existingResult =
          await pool.query(
            `
            SELECT
              id,
              amount,
              currency,
              status,
              idempotency_key AS "idempotencyKey",
              merchant_id AS "merchantId",
              customer_id AS "customerId",
              created_at AS "createdAt",
              updated_at AS "updatedAt"

            FROM public.payment_orders

            WHERE idempotency_key = $1

            LIMIT 1
            `,
            [req.header("Idempotency-Key")],
          );

        if (
          existingResult.rows.length > 0
        ) {
          return res.status(200).json({
            status: "ok",
            idempotent: true,
            message:
              "Existing payment returned for Idempotency-Key",
            payment:
              existingResult.rows[0],
          });
        }
      } catch (lookupError) {
        console.error(
          "Failed to retrieve existing idempotent payment:",
          lookupError,
        );
      }
    }

    console.error(
      "Payment creation error:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error: "Failed to create payment",
    });
  } finally {
    client.release();
  }
});


/*
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

    const paymentResult =
      await pool.query(
        paymentQuery,
        [id],
      );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        error: "Payment not found",
      });
    }

    /*
     * Get all payment attempts.
     */
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

    const attemptsResult =
      await pool.query(
        attemptsQuery,
        [id],
      );

    /*
     * Get all transactions.
     */
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

    const transactionsResult =
      await pool.query(
        transactionsQuery,
        [id],
      );

    /*
     * Get all refunds.
     */
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

    const refundsResult =
      await pool.query(
        refundsQuery,
        [id],
      );

    return res.json({
      status: "ok",

      payment:
        paymentResult.rows[0],

      attempts:
        attemptsResult.rows,

      transactions:
        transactionsResult.rows,

      refunds:
        refundsResult.rows,
    });
  } catch (error) {
    console.error(
      "Failed to fetch payment details:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch payment details",
    });
  }
});


/*
 * ============================================================
 * POST /payments/process
 * ============================================================
 *
 * Processes an existing payment order.
 *
 * Body:
 * {
 *   "orderId": "...",
 *   "paymentMethod": "card"
 * }
 */
router.post("/process", async (req, res) => {
  try {
    const {
      orderId,
      paymentMethod,
    } = req.body ?? {};

    if (!orderId || !paymentMethod) {
      return res.status(400).json({
        status: "error",
        error:
          "orderId and paymentMethod are required",
      });
    }

    const result = await processPayment({
      orderId,
      paymentMethod,
    });

    return res.status(201).json({
      status: "ok",
      ...result,
    });
  } catch (error) {
    console.error(
      "Payment processing error:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Payment processing failed",
    });
  }
});


export default router;