import { Router } from "express";
import { getPool } from "../config/database.js";

const router = Router();

/**
 * GET /customers
 *
 * Returns:
 * - customer information
 * - payment count
 * - successful payments
 * - failed payments
 * - total payment volume
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    const result = await pool.query(
      `
      SELECT
        c.id,
        c.name,
        c.email,
        c.phone,
        c.created_at AS "createdAt",

        COUNT(DISTINCT po.id)::int AS "paymentCount",

        COUNT(
          DISTINCT CASE
            WHEN LOWER(po.status) IN ('paid', 'success', 'completed')
            THEN po.id
          END
        )::int AS "successfulPayments",

        COUNT(
          DISTINCT CASE
            WHEN LOWER(po.status) IN ('failed', 'cancelled')
            THEN po.id
          END
        )::int AS "failedPayments",

        COALESCE(
          SUM(
            CASE
              WHEN LOWER(po.status) IN ('paid', 'success', 'completed')
              THEN po.amount
              ELSE 0
            END
          ),
          0
        )::int AS "totalVolume"

      FROM public.customers c

      LEFT JOIN public.payment_orders po
        ON po.customer_id = c.id

      WHERE
        $1 = ''
        OR LOWER(COALESCE(c.name, '')) LIKE LOWER('%' || $1 || '%')
        OR LOWER(COALESCE(c.email, '')) LIKE LOWER('%' || $1 || '%')
        OR COALESCE(c.phone, '') LIKE '%' || $1 || '%'

      GROUP BY
        c.id,
        c.name,
        c.email,
        c.phone,
        c.created_at

      ORDER BY c.created_at DESC
      `,
      [search],
    );

    return res.json({
      status: "ok",
      customers: result.rows,
    });
  } catch (error) {
    console.error("Customers API error:", error);

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch customers",
    });
  }
});

/**
 * GET /customers/:id
 *
 * Returns one customer with payment history.
 */
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();

    const { id } = req.params;

    const customerResult = await pool.query(
      `
      SELECT
        c.id,
        c.name,
        c.email,
        c.phone,
        c.created_at AS "createdAt"
      FROM public.customers c
      WHERE c.id = $1
      `,
      [id],
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        error: "Customer not found",
      });
    }

    const paymentsResult = await pool.query(
      `
      SELECT
        po.id,
        po.amount,
        po.currency,
        po.status,
        po.created_at AS "createdAt",

        pa.payment_method AS "paymentMethod",
        pa.status AS "attemptStatus",
        pa.failure_code AS "failureCode",
        pa.created_at AS "attemptCreatedAt"

      FROM public.payment_orders po

      LEFT JOIN public.payment_attempts pa
        ON pa.order_id = po.id

      WHERE po.customer_id = $1

      ORDER BY po.created_at DESC
      `,
      [id],
    );

    return res.json({
      status: "ok",
      customer: customerResult.rows[0],
      payments: paymentsResult.rows,
    });
  } catch (error) {
    console.error("Customer details API error:", error);

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch customer",
    });
  }
});

export default router;