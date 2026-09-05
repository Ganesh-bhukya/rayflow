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
/**
 * Failures where an immediate retry is generally not useful.
 */
const STOP_FAILURE_CODES = new Set([
    "INSUFFICIENT_FUNDS",
    "ACCOUNT_BLOCKED",
    "ACCOUNT_CLOSED",
    "INVALID_ACCOUNT",
    "CARD_EXPIRED",
    "CARD_BLOCKED",
    "PAYMENT_NOT_ALLOWED",
]);
/**
 * Failures where a temporary provider/network condition
 * means another bounded attempt may succeed.
 */
const RETRYABLE_FAILURE_CODES = new Set([
    "TIMEOUT",
    "NETWORK_ERROR",
    "GATEWAY_TIMEOUT",
    "PROVIDER_UNAVAILABLE",
    "TEMPORARY_ERROR",
    "PROCESSING_ERROR",
]);
/**
 * Maximum number of automated recovery retries.
 *
 * Safety boundary:
 * RayFlow must never retry indefinitely.
 */
const MAX_AUTOMATED_RETRIES = 1;
/**
 * Base explainable scoring weights.
 */
const RETRYABLE_BASE_SCORE = 82;
const STOP_BASE_SCORE = 8;
const UNKNOWN_BASE_SCORE = 45;
/**
 * Amount thresholds are intentionally used only for
 * prioritization, never to override safety decisions.
 *
 * Amount is assumed to be in the smallest currency unit.
 */
const HIGH_VALUE_AMOUNT = 10000;
const MEDIUM_VALUE_AMOUNT = 2500;
/**
 * Normalize provider failure codes.
 */
function normalizeFailureCode(failureCode) {
    return String(failureCode ?? "")
        .trim()
        .toUpperCase();
}
/**
 * Clamp a number to a supplied range.
 */
function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}
/**
 * Clamp confidence to [0, 1].
 */
function clampConfidence(value) {
    return clamp(value, 0, 1);
}
/**
 * Convert recovery score into a transparent opportunity
 * probability estimate.
 *
 * This is an explainable score conversion, not a trained
 * statistical probability model.
 */
function scoreToProbability(score) {
    return Number((clamp(score, 0, 100) / 100).toFixed(2));
}
/**
 * Calculate expected recovery amount.
 */
function calculateExpectedRecovery(amount, recoveryProbability) {
    return Number((amount * recoveryProbability).toFixed(2));
}
/**
 * Determine risk from the selected action and score.
 */
function getRiskLevel(action, recoveryScore) {
    if (action === "STOP") {
        return "HIGH";
    }
    if (action === "ESCALATE") {
        return "MEDIUM";
    }
    if (recoveryScore >= 75) {
        return "LOW";
    }
    if (recoveryScore >= 50) {
        return "MEDIUM";
    }
    return "HIGH";
}
/**
 * Determine recovery strategy.
 *
 * Strategy is intentionally narrower than action:
 *
 * RETRY     -> IMMEDIATE_RETRY
 * STOP      -> STOP_RECOVERY
 * ESCALATE  -> MANUAL_REVIEW
 */
function getRecoveryStrategy(action) {
    switch (action) {
        case "RETRY":
            return "IMMEDIATE_RETRY";
        case "STOP":
            return "STOP_RECOVERY";
        case "ESCALATE":
        default:
            return "MANUAL_REVIEW";
    }
}
/**
 * Determine business priority.
 *
 * Priority is based on recovery opportunity and value,
 * but it NEVER overrides safety policy.
 */
function getRecoveryPriority(action, recoveryScore, expectedRecoveryAmount, amount) {
    if (action === "STOP") {
        return "LOW";
    }
    if (action === "ESCALATE") {
        if (recoveryScore >= 50 &&
            expectedRecoveryAmount >= MEDIUM_VALUE_AMOUNT) {
            return "HIGH";
        }
        return "MEDIUM";
    }
    if (recoveryScore >= 80 &&
        expectedRecoveryAmount >= MEDIUM_VALUE_AMOUNT) {
        return "HIGH";
    }
    if (recoveryScore >= 65 ||
        amount >= HIGH_VALUE_AMOUNT) {
        return "MEDIUM";
    }
    return "LOW";
}
/**
 * Apply attempt-history intelligence.
 *
 * Recovery opportunity decreases as repeated failures accumulate.
 */
function applyAttemptHistoryAdjustment(score, previousFailedAttempts, signals) {
    const normalizedAttempts = Math.max(0, Math.floor(previousFailedAttempts));
    if (normalizedAttempts === 0) {
        signals.push("First failed attempt increases recovery opportunity");
        return score + 5;
    }
    if (normalizedAttempts === 1) {
        signals.push("One previous failed attempt reduces recovery opportunity");
        return score - 10;
    }
    const penalty = Math.min(normalizedAttempts * 12, 36);
    signals.push(`${normalizedAttempts} previous failed attempts reduce recovery opportunity`);
    return score - penalty;
}
/**
 * Apply payment-method context.
 *
 * Payment method is deliberately a modest signal.
 * It can never override a safety-critical failure.
 */
function applyPaymentMethodAdjustment(score, paymentMethod, signals) {
    const normalizedMethod = paymentMethod.trim().toLowerCase();
    if (normalizedMethod.includes("card") ||
        normalizedMethod.includes("upi")) {
        signals.push(`Payment method ${paymentMethod} is supported for automated recovery analysis`);
        return score + 3;
    }
    signals.push(`Payment method ${paymentMethod} has limited recovery history in the current policy`);
    return score - 3;
}
/**
 * Apply transaction-value intelligence.
 *
 * Higher-value transactions receive a small opportunity
 * adjustment because recovering them has greater business value.
 *
 * This does NOT change safety-critical STOP decisions.
 */
function applyAmountAdjustment(score, amount, signals) {
    if (amount >= HIGH_VALUE_AMOUNT) {
        signals.push("High-value payment increases recovery opportunity priority");
        return score + 4;
    }
    if (amount >= MEDIUM_VALUE_AMOUNT) {
        signals.push("Medium-value payment receives a modest recovery-value adjustment");
        return score + 2;
    }
    signals.push("Payment value does not materially increase recovery score");
    return score;
}
/**
 * Add expected-value signals.
 */
function addExpectedValueSignals(expectedRecoveryAmount, amount, currency, signals) {
    signals.push(`Expected recovery value: ${expectedRecoveryAmount} ${currency}`);
    const expectedValueRatio = amount > 0
        ? expectedRecoveryAmount / amount
        : 0;
    signals.push(`Expected recovery ratio: ${Math.round(expectedValueRatio * 100)}%`);
}
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
export function decideRecoveryAction(input) {
    const { orderId, amount, currency, paymentMethod, previousFailedAttempts = 0, } = input;
    const failureCode = normalizeFailureCode(input.failureCode);
    const signals = [];
    /*
     * ----------------------------------------------------------
     * SAFETY CHECK 1
     * Validate essential input.
     * ----------------------------------------------------------
     */
    if (!orderId ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !currency ||
        !paymentMethod) {
        return {
            action: "ESCALATE",
            confidence: 0.99,
            recoveryScore: 0,
            recoveryProbability: 0,
            expectedRecoveryAmount: 0,
            riskLevel: "HIGH",
            recoveryStrategy: "MANUAL_REVIEW",
            recoveryPriority: "HIGH",
            reason: "Recovery cannot be automated because required payment data is incomplete or invalid.",
            signals: [
                "Invalid or incomplete recovery input",
                "Recovery score unavailable because payment context is invalid",
                "Automated recovery blocked by safety policy",
            ],
            automated: false,
        };
    }
    /*
     * ----------------------------------------------------------
     * BASE SIGNALS
     * ----------------------------------------------------------
     */
    signals.push(`Payment method: ${paymentMethod}`);
    signals.push(`Amount: ${amount} ${currency}`);
    if (failureCode) {
        signals.push(`Failure code: ${failureCode}`);
    }
    else {
        signals.push("Failure code unavailable");
    }
    signals.push(`Previous failed attempts: ${previousFailedAttempts}`);
    /*
     * ----------------------------------------------------------
     * SAFETY CHECK 2
     * Bounded retry policy.
     * ----------------------------------------------------------
     */
    if (previousFailedAttempts >=
        MAX_AUTOMATED_RETRIES) {
        signals.push(`Automated retry limit reached (${MAX_AUTOMATED_RETRIES})`);
        signals.push("Further automated execution is blocked to prevent repeated payment attempts");
        const recoveryScore = 5;
        const recoveryProbability = scoreToProbability(recoveryScore);
        const expectedRecoveryAmount = calculateExpectedRecovery(amount, recoveryProbability);
        addExpectedValueSignals(expectedRecoveryAmount, amount, currency, signals);
        return {
            action: "STOP",
            confidence: 0.99,
            recoveryScore,
            recoveryProbability,
            expectedRecoveryAmount,
            riskLevel: "HIGH",
            recoveryStrategy: "STOP_RECOVERY",
            recoveryPriority: "LOW",
            reason: "RayFlow stopped automated recovery because the retry limit has been reached and further attempts would violate the recovery safety policy.",
            signals,
            automated: false,
        };
    }
    /*
     * ----------------------------------------------------------
     * DECISION 1
     * KNOWN NON-RETRYABLE FAILURE
     * ----------------------------------------------------------
     */
    if (STOP_FAILURE_CODES.has(failureCode)) {
        let recoveryScore = STOP_BASE_SCORE;
        signals.push("Failure classified as non-retryable");
        signals.push("Immediate retry has low expected recovery value");
        /*
         * Keep history intelligence for explainability,
         * but never allow it to turn a STOP into RETRY.
         */
        recoveryScore =
            applyAttemptHistoryAdjustment(recoveryScore, previousFailedAttempts, signals);
        /*
         * Payment-method and amount signals are intentionally
         * NOT allowed to override the safety classification.
         */
        recoveryScore = clamp(recoveryScore, 0, 25);
        const recoveryProbability = scoreToProbability(recoveryScore);
        const expectedRecoveryAmount = calculateExpectedRecovery(amount, recoveryProbability);
        addExpectedValueSignals(expectedRecoveryAmount, amount, currency, signals);
        signals.push("Safety policy overrides recovery optimization for this failure");
        return {
            action: "STOP",
            confidence: 0.97,
            recoveryScore,
            recoveryProbability,
            expectedRecoveryAmount,
            riskLevel: "HIGH",
            recoveryStrategy: "STOP_RECOVERY",
            recoveryPriority: "LOW",
            reason: "RayFlow stopped recovery because the failure indicates a condition that is unlikely to be resolved by an immediate retry.",
            signals,
            automated: false,
        };
    }
    /*
     * ----------------------------------------------------------
     * DECISION 2
     * KNOWN TEMPORARY / RETRYABLE FAILURE
     * ----------------------------------------------------------
     */
    if (RETRYABLE_FAILURE_CODES.has(failureCode)) {
        let recoveryScore = RETRYABLE_BASE_SCORE;
        signals.push("Failure classified as temporary/retryable");
        /*
         * Attempt history.
         */
        recoveryScore =
            applyAttemptHistoryAdjustment(recoveryScore, previousFailedAttempts, signals);
        /*
         * Payment method.
         */
        recoveryScore =
            applyPaymentMethodAdjustment(recoveryScore, paymentMethod, signals);
        /*
         * Transaction value.
         */
        recoveryScore =
            applyAmountAdjustment(recoveryScore, amount, signals);
        /*
         * Keep automated recovery inside a bounded range.
         */
        recoveryScore = clamp(recoveryScore, 50, 95);
        const recoveryProbability = scoreToProbability(recoveryScore);
        const expectedRecoveryAmount = calculateExpectedRecovery(amount, recoveryProbability);
        signals.push("Retry remains within the automated recovery limit");
        addExpectedValueSignals(expectedRecoveryAmount, amount, currency, signals);
        signals.push(`Recovery opportunity score: ${recoveryScore}/100`);
        signals.push(`Estimated recovery probability: ${Math.round(recoveryProbability * 100)}%`);
        const riskLevel = getRiskLevel("RETRY", recoveryScore);
        const recoveryStrategy = getRecoveryStrategy("RETRY");
        const recoveryPriority = getRecoveryPriority("RETRY", recoveryScore, expectedRecoveryAmount, amount);
        signals.push(`Recovery risk: ${riskLevel}`);
        signals.push(`Recovery strategy: ${recoveryStrategy}`);
        signals.push(`Recovery priority: ${recoveryPriority}`);
        return {
            action: "RETRY",
            confidence: 0.94,
            recoveryScore,
            recoveryProbability,
            expectedRecoveryAmount,
            riskLevel,
            recoveryStrategy,
            recoveryPriority,
            reason: "RayFlow identified a temporary provider or network failure and recommends one bounded retry because the recovery opportunity remains strong.",
            signals,
            automated: true,
        };
    }
    /*
     * ----------------------------------------------------------
     * DECISION 3
     * UNKNOWN FAILURE
     * ----------------------------------------------------------
     *
     * Unknown failures are deliberately NOT retried.
     * Safe automation requires sufficient classification
     * confidence before attempting another payment.
     */
    signals.push("Failure type is unknown or not classified");
    signals.push("Recovery probability cannot be established with sufficient confidence");
    signals.push("Automated recovery blocked until the failure is reviewed");
    const recoveryScore = UNKNOWN_BASE_SCORE;
    const recoveryProbability = scoreToProbability(recoveryScore);
    const expectedRecoveryAmount = calculateExpectedRecovery(amount, recoveryProbability);
    addExpectedValueSignals(expectedRecoveryAmount, amount, currency, signals);
    const recoveryStrategy = getRecoveryStrategy("ESCALATE");
    const recoveryPriority = getRecoveryPriority("ESCALATE", recoveryScore, expectedRecoveryAmount, amount);
    signals.push(`Recovery strategy: ${recoveryStrategy}`);
    signals.push(`Recovery priority: ${recoveryPriority}`);
    return {
        action: "ESCALATE",
        confidence: clampConfidence(0.90),
        recoveryScore,
        recoveryProbability,
        expectedRecoveryAmount,
        riskLevel: "MEDIUM",
        recoveryStrategy,
        recoveryPriority,
        reason: "RayFlow could not safely classify the failure, so automated recovery was blocked and the case should be reviewed.",
        signals,
        automated: false,
    };
}
/**
 * Convenience helper for callers that only need to know
 * whether automated retry execution is allowed.
 */
export function canAutomateRecovery(decision) {
    return (decision.action === "RETRY" &&
        decision.automated);
}
/**
 * Expose configured retry limit.
 */
export function getMaxAutomatedRetries() {
    return MAX_AUTOMATED_RETRIES;
}
//# sourceMappingURL=recoveryDecisionEngine.js.map