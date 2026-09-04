import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";

const pool = getPgPool();

try {
  const result = await pool.query(`
    SELECT
      po.id,
      po.merchant_id,
      po.customer_id,
      po.amount,
      po.currency
    FROM public.payment_orders po
    WHERE po.status = 'processing'
    ORDER BY po.created_at DESC
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    throw new Error("No processing payment order available for reconciliation test.");
  }

  const order = result.rows[0];

  const attempt = await pool.query(
    `
    INSERT INTO public.payment_attempts (
      id,
      order_id,
      payment_method,
      status,
      provider_reference,
      failure_code,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      $1,
      'card',
      'processing',
      $2,
      NULL,
      NOW() - INTERVAL '30 minutes',
      NOW() - INTERVAL '30 minutes'
    )
    RETURNING
      id,
      order_id,
      payment_method,
      status,
      provider_reference,
      created_at,
      updated_at
    `,
    [
      order.id,
      `rayflow_success_reconciliation_${Date.now()}`
    ],
  );

  console.log(JSON.stringify({
    order,
    attempt: attempt.rows[0],
  }, null, 2));
} catch (error) {
  console.error(error);
} finally {
  await pool.end();
}
