import "dotenv/config";
import { getPgPool } from "./src/infrastructure/database/client.js";

const pool = getPgPool();

try {
  const result = await pool.query(`
    SELECT
      id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    FROM public.audit_logs
    ORDER BY created_at DESC
    LIMIT 20
  `);

  console.log(JSON.stringify(result.rows, null, 2));
} catch (error) {
  console.error(error);
} finally {
  await pool.end();
}
