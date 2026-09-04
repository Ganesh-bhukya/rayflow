import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";
const pool = getPgPool();
try {
    const result = await pool.query(`
    SELECT
      id,
      order_id,
      attempt_id,
      amount,
      currency,
      type,
      status,
      created_at
    FROM public.transactions
    ORDER BY created_at DESC
    LIMIT 10
  `);
    console.log(JSON.stringify(result.rows, null, 2));
}
catch (error) {
    console.error(error);
}
finally {
    await pool.end();
}
//# sourceMappingURL=inspect-transactions.js.map