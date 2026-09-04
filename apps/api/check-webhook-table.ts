import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";

const pool = getPgPool();

try {
  const result = await pool.query(`
    SELECT
      table_schema,
      table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'webhook_events'
  `);

  console.log(JSON.stringify(result.rows, null, 2));
} catch (error) {
  console.error(error);
} finally {
  await pool.end();
}
