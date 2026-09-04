import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";

const pool = getPgPool();

const result = await pool.query(
  `
  SELECT
    id,
    amount,
    currency,
    status,
    idempotency_key,
    razorpay_order_id
  FROM public.payment_orders
  WHERE id = $1
  `,
  ["f7d63dc5-7662-441d-b07b-5912d07cce96"],
);

console.log(JSON.stringify(result.rows, null, 2));

await pool.end();
