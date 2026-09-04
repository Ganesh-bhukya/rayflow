/**
 * RayFlow Recovery Decision Engine
 *
 * Responsibility:
 * - Analyze a failed payment
 * - Determine the safest recovery action
 * - Explain the decision
 *
 * IMPORTANT:
 * This engine does NOT:
 * - modify the database
 * - call Razorpay
 * - change payment state
 * - execute a retry
 *
 * It only produces a bounded recovery decision.
 *
 * The payment state machine and recovery executor remain
 * responsible for validating and executing the decision.
 */
export type RecoveryAction = "RETRY" | "STOP" | "ESCALATE";
export type RecoveryDecisionInput = {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    failureCode?: string | null;
    /**
     * Number of previous failed recovery/payment attempts.
     *
     * Example:
     * 0 = first failure
     * 1 = one previous failed attempt
     * 2 = two previous failed attempts
     */
    previousFailedAttempts?: number;
};
export type RecoveryDecision = {
    action: RecoveryAction;
    /**
     * Confidence is represented as a value between 0 and 1.
     */
    confidence: number;
    /**
     * Human-readable explanation suitable for:
     * - dashboard
     * - audit logs
     * - buildathon demo
     */
    reason: string;
    /**
     * Signals used to reach the decision.
     */
    signals: string[];
    /**
     * Whether the decision is allowed to trigger
     * an automated retry.
     */
    automated: boolean;
};
/**
 * Main recovery decision function.
 *
 * Decision priority:
 *
 * 1. Invalid/unsafe input -> ESCALATE
 * 2. Retry limit reached -> STOP
 * 3. Clearly non-retryable failure -> STOP
 * 4. Clearly temporary failure -> RETRY
 * 5. Unknown failure -> ESCALATE
 *
 * This ordering is intentional:
 * safety boundaries always take priority over
 * recovery optimization.
 */
export declare function decideRecoveryAction(input: RecoveryDecisionInput): RecoveryDecision;
/**
 * Convenience helper for callers that only need
 * to know whether an automated retry is allowed.
 */
export declare function canAutomateRecovery(decision: RecoveryDecision): boolean;
/**
 * Expose the configured retry limit for:
 * - tests
 * - dashboards
 * - documentation
 */
export declare function getMaxAutomatedRetries(): number;
//# sourceMappingURL=recoveryDecisionEngine.d.ts.map