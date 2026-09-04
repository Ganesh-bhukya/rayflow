import express from "express";
import { reconcileStalePaymentAttempts, } from "../services/reconciliationService.js";
const router = express.Router();
/**
 * POST /reconciliation/run
 *
 * Reconcile stale payment attempts.
 *
 * Optional query parameter:
 *
 * ?staleMinutes=15
 *
 * Example:
 * POST /reconciliation/run?staleMinutes=15
 */
router.post("/run", async (req, res) => {
    try {
        const rawStaleMinutes = req.query.staleMinutes;
        let staleMinutes = 15;
        if (rawStaleMinutes !== undefined) {
            const parsed = Number(rawStaleMinutes);
            if (!Number.isFinite(parsed) ||
                parsed <= 0) {
                return res.status(400).json({
                    status: "error",
                    error: "staleMinutes must be a positive number",
                });
            }
            staleMinutes = parsed;
        }
        const result = await reconcileStalePaymentAttempts(staleMinutes);
        return res.status(200).json({
            status: "ok",
            message: "Payment reconciliation completed.",
            staleMinutes,
            ...result,
        });
    }
    catch (error) {
        console.error("Reconciliation error:", error);
        return res.status(500).json({
            status: "error",
            error: error instanceof Error
                ? error.message
                : "Payment reconciliation failed",
        });
    }
});
export default router;
//# sourceMappingURL=reconciliation.js.map