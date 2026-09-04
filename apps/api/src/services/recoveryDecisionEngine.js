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
/**
 * Failure codes that generally indicate the payment
 * should not be blindly retried.
 *
 * These represent conditions where another immediate
 * attempt is unlikely to solve the underlying problem.
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
 * Failure codes where another attempt may reasonably
 * succeed because the failure can be temporary.
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
 * This is a deliberate safety boundary.
 *
 * RayFlow must never retry indefinitely.
 */
const MAX_AUTOMATED_RETRIES = 1;
/**
 * Normalize failure codes so the decision engine
 * behaves consistently with provider-specific casing.
 */
function normalizeFailureCode(failureCode) {
    return String(failureCode ?? "")
        .trim()
        .toUpperCase();
}
/**
 * Clamp confidence to the valid range [0, 1].
 */
function clampConfidence(value) {
    return Math.min(Math.max(value, 0), 1);
}
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
export function decideRecoveryAction(input) {
    const { orderId, amount, currency, paymentMethod, previousFailedAttempts = 0, } = input;
    const failureCode = normalizeFailureCode(input.failureCode);
    const signals = [];
    /*
     * --------------------------------------------------------
     * SAFETY CHECK 1
     * Validate essential input.
     * --------------------------------------------------------
     */
    if (!orderId ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !currency ||
        !paymentMethod) {
        return {
            action: "ESCALATE",
            confidence: 0.99,
            reason: "Recovery cannot be automated because required payment data is incomplete or invalid.",
            signals: [
                "Invalid or incomplete recovery input",
            ],
            automated: false,
        };
    }
    /*
     * --------------------------------------------------------
     * SAFETY CHECK 2
     * Enforce bounded retry policy.
     * --------------------------------------------------------
     */
    if (previousFailedAttempts >=
        MAX_AUTOMATED_RETRIES) {
        signals.push(`Automated retry limit reached (${MAX_AUTOMATED_RETRIES})`);
        return {
            action: "STOP",
            confidence: 0.99,
            reason: "RayFlow stopped automated recovery because the retry limit has been reached.",
            signals,
            automated: false,
        };
    }
    /*
     * --------------------------------------------------------
     * SIGNALS
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * DECISION 1
     * Known non-retryable failure.
     * --------------------------------------------------------
     */
    if (STOP_FAILURE_CODES.has(failureCode)) {
        signals.push("Failure classified as non-retryable");
        return {
            action: "STOP",
            confidence: 0.97,
            reason: "RayFlow stopped recovery because the failure indicates a condition that is unlikely to be resolved by an immediate retry.",
            signals,
            automated: false,
        };
    }
    /*
     * --------------------------------------------------------
     * DECISION 2
     * Known temporary/retryable failure.
     * --------------------------------------------------------
     */
    if (RETRYABLE_FAILURE_CODES.has(failureCode)) {
        signals.push("Failure classified as temporary/retryable");
        signals.push("Retry remains within the automated recovery limit");
        return {
            action: "RETRY",
            confidence: 0.94,
            reason: "RayFlow identified a temporary provider or network failure and recommends one bounded retry.",
            signals,
            automated: true,
        };
    }
    /*
     * --------------------------------------------------------
     * DECISION 3
     * Unknown failure.
     * --------------------------------------------------------
     *
     * We deliberately do NOT retry unknown failures.
     * This is important for safe automation.
     */
    signals.push("Failure type is unknown or not classified");
    return {
        action: "ESCALATE",
        confidence: clampConfidence(0.90),
        reason: "RayFlow could not safely classify the failure, so automated recovery was blocked and the case should be reviewed.",
        signals,
        automated: false,
    };
}
/**
 * Convenience helper for callers that only need
 * to know whether an automated retry is allowed.
 */
export function canAutomateRecovery(decision) {
    return (decision.action === "RETRY" &&
        decision.automated);
}
/**
 * Expose the configured retry limit for:
 * - tests
 * - dashboards
 * - documentation
 */
export function getMaxAutomatedRetries() {
    return MAX_AUTOMATED_RETRIES;
}
//# sourceMappingURL=recoveryDecisionEngine.js.map