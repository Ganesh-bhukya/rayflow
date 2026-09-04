import "dotenv/config";
import { getPgPool } from "./infrastructure/database/client.js";
const pool = getPgPool();
const attemptId = "168348a0-9b63-4cba-9fb6-b6e03c6a43b4";
try {
    const result = await pool.query(`
    UPDATE public.payment_attempts
    SET
      provider_reference = 'rayflow_failed_test_001',
      updated_at = NOW() - INTERVAL '10 minutes'
    WHERE id = $1
    RETURNING
      id,
      order_id,
      status,
      provider_reference,
      updated_at
    `, [attemptId]);
    console.log(JSON.stringify(result.rows[0], null, 2));
}
catch (error) {
    console.error(error);
    process.exitCode = 1;
}
finally {
    await pool.end();
}
//# sourceMappingURL=test-reconciliation-failed.js.map