import { Router } from "express";
import { getPool } from "../config/database.js";

const router = Router();

/**
 * GET /merchants
 *
 * Returns merchants with:
 * - business information
 * - merchant code
 * - active status
 * - payment count
 * - successful payments
 * - failed payments
 * - total payment volume
 */
router.get("/", async (req, res) => {
  try {
    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    const pool = getPool();

    const result = await pool.query(
      `
      SELECT
        m.id,
        m.business_name,
        m.merchant_code,
        m.is_active,
        m.created_at,

        COUNT(DISTINCT po.id)::int AS payment_count,

        COUNT(
          DISTINCT CASE
            WHEN po.status = 'paid'
            THEN po.id
          END
        )::int AS successful_payments,

        COUNT(
          DISTINCT CASE
            WHEN po.status IN ('failed', 'cancelled')
            THEN po.id
          END
        )::int AS failed_payments,

        COALESCE(
          SUM(
            CASE
              WHEN po.status = 'paid'
              THEN po.amount
              ELSE 0
            END
          ),
          0
        )::int AS total_volume

      FROM public.merchants m

      LEFT JOIN public.payment_orders po
        ON po.merchant_id = m.id

      WHERE
        $1 = ''
        OR LOWER(m.business_name)
          LIKE LOWER('%' || $1 || '%')
        OR LOWER(m.merchant_code)
          LIKE LOWER('%' || $1 || '%')

      GROUP BY
        m.id,
        m.business_name,
        m.merchant_code,
        m.is_active,
        m.created_at

      ORDER BY m.created_at DESC
      `,
      [search],
    );

    return res.json({
      status: "ok",
      merchants: result.rows,
    });
  } catch (error) {
    console.error("Merchants API error:", error);

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch merchants",
    });
  }
});

/**
 * GET /merchants/:id
 *
 * Returns one merchant with payment history.
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const pool = getPool();

    const merchantResult = await pool.query(
      `
      SELECT
        m.id,
        m.business_name,
        m.merchant_code,
        m.is_active,
        m.created_at,

        u.email AS user_email,
        u.first_name,
        u.last_name

      FROM public.merchants m

      LEFT JOIN public.users u
        ON u.id = m.user_id

      WHERE m.id = $1
      `,
      [id],
    );

    if (merchantResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        error: "Merchant not found",
      });
    }

    const paymentsResult = await pool.query(
      `
      SELECT
        po.id,
        po.amount,
        po.currency,
        po.status,
        po.created_at,

        c.name AS customer_name,
        c.email AS customer_email

      FROM public.payment_orders po

      LEFT JOIN public.customers c
        ON c.id = po.customer_id

      WHERE po.merchant_id = $1

      ORDER BY po.created_at DESC

      LIMIT 100
      `,
      [id],
    );

    return res.json({
      status: "ok",
      merchant: merchantResult.rows[0],
      payments: paymentsResult.rows,
    });
  } catch (error) {
    console.error("Merchant details API error:", error);

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch merchant",
    });
  }
});

export default router;