export type ReconciliationResult = {
    scanned: number;
    reconciled: number;
    skipped: number;
    results: Array<{
        attemptId: string;
        orderId: string;
        previousStatus: string;
        action: string;
        reason: string;
    }>;
};
/**
 * Reconcile stale payment attempts.
 *
 * Flow:
 *
 * processing
 *     |
 *     v
 * provider lookup
 *     |
 *     +---- success ---> success + paid + transaction
 *     |
 *     +---- failed ----> failed
 *     |
 *     +---- unknown ---> skipped
 *
 * Important properties:
 *
 * - Only stale processing attempts are considered.
 * - Provider status is treated as the source of truth.
 * - Transactions are idempotent through attempt_id.
 * - Already-paid orders are protected from duplicate transactions.
 * - Reconciliation actions are written to audit_logs.
 */
export declare function reconcileStalePaymentAttempts(staleMinutes?: number): Promise<ReconciliationResult>;
//# sourceMappingURL=reconciliationService.d.ts.map