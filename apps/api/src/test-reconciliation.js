import "dotenv/config";
import { getPgPool } from "./infrastructure/database/client.js";
const pool = getPgPool();
const attemptId = "67801b11-5a9c-4c35-aebf-62fcc8dfdcc6";
try {
    const result = await pool.query(`
    UPDATE public.payment_attempts
    SET
      provider_reference = 'rayflow_success_test_001',
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
//# sourceMappingURL=test-reconciliation.js.map