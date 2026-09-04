import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";
const pool = getPgPool();
try {
    const result = await pool.query(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'payment_orders',
        'payment_attempts',
        'transactions'
      )
    ORDER BY table_name, ordinal_position
  `);
    console.log(JSON.stringify(result.rows, null, 2));
}
catch (error) {
    console.error(error);
}
finally {
    await pool.end();
}
//# sourceMappingURL=inspect-payment-schema.js.map