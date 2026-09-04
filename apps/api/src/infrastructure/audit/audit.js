import { getPool } from "../../config/database.js";
/**
 * Create a financial/system audit log.
 *
 * Audit logging is intentionally best-effort:
 * a failure to write an audit record should not
 * cause the underlying payment operation to fail.
 */
export async function createAuditLog(input) {
    const pool = getPool();
    try {
        await pool.query(`
      INSERT INTO public.audit_logs
      (
        user_id,
        action,
        entity_type,
        entity_id,
        metadata
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5
      )
      `, [
            input.userId ?? null,
            input.action,
            input.entityType,
            input.entityId ?? null,
            input.metadata
                ? JSON.stringify(input.metadata)
                : null,
        ]);
    }
    catch (error) {
        console.error("Audit log creation failed:", error);
    }
}
//# sourceMappingURL=audit.js.map