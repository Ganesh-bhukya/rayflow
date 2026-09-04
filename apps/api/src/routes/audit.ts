import { Router } from "express";
import { getPool } from "../config/database.js";

const router = Router();

/*
 * GET /audit-logs
 *
 * Returns recent audit events.
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      100,
    );

    const result = await getPool().query(
      `
      SELECT
        id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        created_at
      FROM public.audit_logs
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit],
    );

    return res.json({
      status: "ok",
      auditLogs: result.rows,
    });
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);

    return res.status(500).json({
      status: "error",
      error: "Failed to fetch audit logs",
    });
  }
});

export default router;