import express from "express";
import { getPgPool } from "../infrastructure/database/client.js";

const router = express.Router();

/**
 * GET /transactions
 *
 * Supports:
 *
 * GET /transactions
 * GET /transactions?page=1&limit=10
 * GET /transactions?status=success
 * GET /transactions?type=payment
 * GET /transactions?search=INR
 * GET /transactions?status=success&type=payment
 *
 * Returns:
 * - transaction
 * - customer
 * - merchant
 * - payment order
 * - payment attempt
 * - pagination
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPgPool();

    /*
     * ----------------------------------------------------
     * PAGINATION
     * ----------------------------------------------------
     */

    const requestedPage = Number(
      req.query.page ?? 1,
    );

    const requestedLimit = Number(
      req.query.limit ?? 10,
    );

    const page =
      Number.isFinite(requestedPage) &&
      requestedPage >= 1
        ? Math.floor(requestedPage)
        : 1;

    const limit =
      Number.isFinite(requestedLimit) &&
      requestedLimit >= 1
        ? Math.min(
            Math.floor(requestedLimit),
            100,
          )
        : 10;

    const offset = (page - 1) * limit;

    /*
     * ----------------------------------------------------
     * FILTERS
     * ----------------------------------------------------
     */

    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim().toLowerCase()
        : "";

    const type =
      typeof req.query.type === "string"
        ? req.query.type.trim().toLowerCase()
        : "";

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    /*
     * ----------------------------------------------------
     * BUILD WHERE CLAUSE
     * ----------------------------------------------------
     */

    const conditions: string[] = [];
    const filterValues: unknown[] = [];

    if (status) {
      filterValues.push(status);

      conditions.push(
        `LOWER(t.status) = $${filterValues.length}`,
      );
    }

    if (type) {
      filterValues.push(type);

      conditions.push(
        `LOWER(t.type) = $${filterValues.length}`,
      );
    }

    if (search) {
      filterValues.push(`%${search}%`);

      const searchParameter =
        `$${filterValues.length}`;

      conditions.push(`
        (
          t.id::text ILIKE ${searchParameter}
          OR t.order_id::text ILIKE ${searchParameter}
          OR t.attempt_id::text ILIKE ${searchParameter}
          OR t.currency ILIKE ${searchParameter}
          OR t.type ILIKE ${searchParameter}
          OR t.status ILIKE ${searchParameter}
          OR c.name ILIKE ${searchParameter}
          OR c.email ILIKE ${searchParameter}
          OR m.business_name ILIKE ${searchParameter}
        )
      `);
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    /*
     * ----------------------------------------------------
     * COUNT TOTAL RESULTS
     * ----------------------------------------------------
     */

    const countQuery = `
      SELECT
        COUNT(*)::int AS total

      FROM public.transactions t

      LEFT JOIN public.payment_orders po
        ON po.id = t.order_id

      LEFT JOIN public.merchants m
        ON m.id = po.merchant_id

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      LEFT JOIN public.payment_attempts pa
        ON pa.id = t.attempt_id

      ${whereClause};
    `;

    const countResult = await pool.query(
      countQuery,
      filterValues,
    );

    const total = Number(
      countResult.rows[0]?.total ?? 0,
    );

    /*
     * ----------------------------------------------------
     * FETCH TRANSACTIONS
     * ----------------------------------------------------
     */

    const dataValues = [...filterValues];

    dataValues.push(limit);

    const limitParameter =
      `$${dataValues.length}`;

    dataValues.push(offset);

    const offsetParameter =
      `$${dataValues.length}`;

    const query = `
      SELECT
        t.id,
        t.order_id AS "orderId",
        t.attempt_id AS "attemptId",

        t.amount,
        t.currency,
        t.type,
        t.status,
        t.created_at AS "createdAt",

        po.id AS "paymentOrderId",
        po.status AS "orderStatus",
        po.idempotency_key AS "idempotencyKey",

        m.id AS "merchantId",
        m.business_name AS "merchantName",
        m.merchant_code AS "merchantCode",

        c.id AS "customerId",
        c.name AS "customerName",
        c.email AS "customerEmail",
        c.phone AS "customerPhone",

        pa.payment_method AS "paymentMethod",
        pa.status AS "attemptStatus",
        pa.provider_reference AS "providerReference",
        pa.failure_code AS "failureCode"

      FROM public.transactions t

      LEFT JOIN public.payment_orders po
        ON po.id = t.order_id

      LEFT JOIN public.merchants m
        ON m.id = po.merchant_id

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      LEFT JOIN public.payment_attempts pa
        ON pa.id = t.attempt_id

      ${whereClause}

      ORDER BY t.created_at DESC

      LIMIT ${limitParameter}

      OFFSET ${offsetParameter};
    `;

    const result = await pool.query(
      query,
      dataValues,
    );

    /*
     * ----------------------------------------------------
     * PAGINATION INFORMATION
     * ----------------------------------------------------
     */

    const totalPages =
      total === 0
        ? 0
        : Math.ceil(total / limit);

    /*
     * ----------------------------------------------------
     * RESPONSE
     * ----------------------------------------------------
     */

    return res.json({
      status: "ok",

      transactions: result.rows,

      pagination: {
        page,
        limit,
        total,
        totalPages,

        hasNextPage:
          page < totalPages,

        hasPreviousPage:
          page > 1,
      },

      filters: {
        status: status || null,
        type: type || null,
        search: search || null,
      },
    });
  } catch (error) {
    console.error(
      "Failed to fetch transactions:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch transactions",
    });
  }
});


/**
 * GET /transactions/:id
 *
 * Returns complete details for one transaction.
 */
router.get("/:id", async (req, res) => {
  try {
    const pool = getPgPool();

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: "error",
        error: "Transaction ID is required",
      });
    }

    /*
     * ----------------------------------------------------
     * TRANSACTION DETAILS
     * ----------------------------------------------------
     */

    const transactionQuery = `
      SELECT
        t.id,
        t.order_id AS "orderId",
        t.attempt_id AS "attemptId",

        t.amount,
        t.currency,
        t.type,
        t.status,
        t.created_at AS "createdAt",

        po.id AS "paymentOrderId",
        po.amount AS "orderAmount",
        po.currency AS "orderCurrency",
        po.status AS "orderStatus",
        po.idempotency_key AS "idempotencyKey",

        po.created_at AS "orderCreatedAt",
        po.updated_at AS "orderUpdatedAt",

        m.id AS "merchantId",
        m.business_name AS "merchantName",
        m.merchant_code AS "merchantCode",

        c.id AS "customerId",
        c.name AS "customerName",
        c.email AS "customerEmail",
        c.phone AS "customerPhone",

        pa.id AS "paymentAttemptId",
        pa.payment_method AS "paymentMethod",
        pa.status AS "attemptStatus",
        pa.provider_reference AS "providerReference",
        pa.failure_code AS "failureCode",
        pa.created_at AS "attemptCreatedAt",
        pa.updated_at AS "attemptUpdatedAt"

      FROM public.transactions t

      LEFT JOIN public.payment_orders po
        ON po.id = t.order_id

      LEFT JOIN public.merchants m
        ON m.id = po.merchant_id

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      LEFT JOIN public.payment_attempts pa
        ON pa.id = t.attempt_id

      WHERE t.id = $1

      LIMIT 1;
    `;

    const transactionResult =
      await pool.query(
        transactionQuery,
        [id],
      );

    if (
      transactionResult.rows.length === 0
    ) {
      return res.status(404).json({
        status: "error",
        error: "Transaction not found",
      });
    }

    /*
     * ----------------------------------------------------
     * RELATED REFUNDS
     * ----------------------------------------------------
     */

    const refundsQuery = `
      SELECT
        id,
        transaction_id AS "transactionId",
        amount,
        status,
        reason,
        created_at AS "createdAt",
        updated_at AS "updatedAt"

      FROM public.refunds

      WHERE transaction_id = $1

      ORDER BY created_at DESC;
    `;

    const refundsResult =
      await pool.query(
        refundsQuery,
        [id],
      );

    /*
     * ----------------------------------------------------
     * RESPONSE
     * ----------------------------------------------------
     */

    return res.json({
      status: "ok",

      transaction:
        transactionResult.rows[0],

      refunds:
        refundsResult.rows,
    });
  } catch (error) {
    console.error(
      "Failed to fetch transaction details:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error:
        "Failed to fetch transaction details",
    });
  }
});


export default router;