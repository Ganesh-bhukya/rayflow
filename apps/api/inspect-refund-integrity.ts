import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";

const pool = getPgPool();

try {
  const result = await pool.query(`
    SELECT
      t.id AS transaction_id,
      t.amount AS transaction_amount,
      t.currency,
      t.status AS transaction_status,

      COALESCE(
        SUM(
          CASE
            WHEN r.status = 'success'
            THEN r.amount
            ELSE 0
          END
        ),
        0
      ) AS refunded_amount,

      t.amount -
      COALESCE(
        SUM(
          CASE
            WHEN r.status = 'success'
            THEN r.amount
            ELSE 0
          END
        ),
        0
      ) AS remaining_refundable

    FROM public.transactions t

    LEFT JOIN public.refunds r
      ON r.transaction_id = t.id

    GROUP BY
      t.id,
      t.amount,
      t.currency,
      t.status

    ORDER BY t.created_at DESC;
  `);

  console.log(JSON.stringify(result.rows, null, 2));
} catch (error) {
  console.error(error);
} finally {
  await pool.end();
}
