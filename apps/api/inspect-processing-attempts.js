import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";
const pool = getPgPool();
try {
    const result = await pool.query(`
    SELECT
      pa.id,
      pa.order_id,
      pa.status,
      pa.provider_reference,
      pa.created_at,
      pa.updated_at,
      po.status AS order_status,
      po.amount,
      po.currency
    FROM public.payment_attempts pa
    JOIN public.payment_orders po
      ON po.id = pa.order_id
    WHERE pa.status = 'processing'
    ORDER BY pa.updated_at ASC
  `);
    console.log(JSON.stringify(result.rows, null, 2));
}
catch (error) {
    console.error(error);
}
finally {
    await pool.end();
}
//# sourceMappingURL=inspect-processing-attempts.js.map