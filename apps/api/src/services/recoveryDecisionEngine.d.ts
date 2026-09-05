/**
 * RayFlow Recovery Intelligence 2.0
 *
 * Responsibility:
 * - Analyze a failed payment
 * - Calculate an explainable recovery score
 * - Estimate recovery probability
 * - Estimate expected recoverable revenue
 * - Assess recovery risk
 * - Select a bounded recovery strategy
 * - Prioritize recovery opportunities
 * - Explain the decision
 *
 * IMPORTANT:
 * This engine does NOT:
 * - modify the database
 * - call Razorpay
 * - change payment state
 * - execute a retry
 *
 * The engine only produces bounded decision intelligence.
 *
 * The payment state machine and recovery executor remain
 * responsible for validating and executing any action.
 *
 * The scoring model is deterministic and explainable.
 * It is not presented as a trained ML probability model.
 */
export type RecoveryAction = "RETRY" | "STOP" | "ESCALATE";
export type RecoveryRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type RecoveryStrategy = "IMMEDIATE_RETRY" | "STOP_RECOVERY" | "MANUAL_REVIEW";
export type RecoveryPriority = "HIGH" | "MEDIUM" | "LOW";
export type RecoveryDecisionInput = {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    failureCode?: string | null;
    previousFailedAttempts?: number;
};
export type RecoveryDecision = {
    action: RecoveryAction;
    confidence: number;
    /**
     * Explainable recovery opportunity score.
     *
     * Range: 0 to 100.
     */
    recoveryScore: number;
    /**
     * Estimated recovery probability derived transparently
     * from the recovery score.
     *
     * Range: 0 to 1.
     */
    recoveryProbability: number;
    /**
     * Expected recoverable amount in the same smallest
     * currency unit used by input.amount.
     */
    expectedRecoveryAmount: number;
    /**
     * Risk associated with the recommended recovery path.
     */
    riskLevel: RecoveryRiskLevel;
    /**
     * Recommended recovery strategy.
     */
    recoveryStrategy: RecoveryStrategy;
    /**
     * Business priority of the recovery opportunity.
     */
    recoveryPriority: RecoveryPriority;
    /**
     * Human-readable explanation.
     */
    reason: string;
    /**
     * Signals used by the decision engine.
     */
    signals: string[];
    /**
     * Whether automated retry execution is allowed.
     */
    automated: boolean;
};
/**
 * Main Recovery Intelligence 2.0 decision function.
 *
 * Safety priority:
 *
 * 1. Invalid input -> ESCALATE
 * 2. Retry limit reached -> STOP
 * 3. Non-retryable failure -> STOP
 * 4. Retryable failure -> RETRY
 * 5. Unknown failure -> ESCALATE
 *
 * Optimization signals are only applied after safety checks
 * have established that the category is safe to optimize.
 */
export declare function decideRecoveryAction(input: RecoveryDecisionInput): RecoveryDecision;
/**
 * Convenience helper for callers that only need to know
 * whether automated retry execution is allowed.
 */
export declare function canAutomateRecovery(decision: RecoveryDecision): boolean;
/**
 * Expose configured retry limit.
 */
export declare function getMaxAutomatedRetries(): number;
//# sourceMappingURL=recoveryDecisionEngine.d.ts.map