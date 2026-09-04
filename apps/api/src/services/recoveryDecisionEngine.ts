/**
 * RayFlow Recovery Decision Engine
 *
 * Responsibility:
 * - Analyze a failed payment
 * - Calculate an explainable recovery score
 * - Estimate recovery probability
 * - Estimate expected recoverable revenue
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
 * It only produces a bounded, explainable recovery decision.
 *
 * The payment state machine and recovery executor remain
 * responsible for validating and executing the decision.
 *
 * The scoring model is intentionally deterministic and
 * explainable. It provides decision intelligence without
 * allowing an AI model to directly control money movement.
 */

export type RecoveryAction =
  | "RETRY"
  | "STOP"
  | "ESCALATE";

export type RecoveryRiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH";

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
   * Confidence represents how strongly RayFlow
   * supports the selected action.
   *
   * Range: 0 to 1.
   */
  confidence: number;

  /**
   * Explainable recovery score.
   *
   * Range: 0 to 100.
   *
   * Higher score means a stronger recovery opportunity.
   */
  recoveryScore: number;

  /**
   * Estimated probability that the payment can
   * be recovered through the recommended recovery path.
   *
   * Range: 0 to 1.
   */
  recoveryProbability: number;

  /**
   * Expected recoverable amount in the same
   * smallest-currency-unit representation as input.amount.
   *
   * Example:
   * amount = 500 and probability = 0.80
   * expectedRecoveryAmount = 400
   */
  expectedRecoveryAmount: number;

  /**
   * Risk classification for the recommended action.
   */
  riskLevel: RecoveryRiskLevel;

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
 * Base recovery scores.
 *
 * These are explainable policy weights rather than
 * opaque model outputs.
 */
const RETRYABLE_BASE_SCORE = 82;
const STOP_BASE_SCORE = 8;
const UNKNOWN_BASE_SCORE = 45;

/**
 * Normalize failure codes so the decision engine
 * behaves consistently with provider-specific casing.
 */
function normalizeFailureCode(
  failureCode?: string | null,
): string {
  return String(failureCode ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Clamp a number to the supplied range.
 */
function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    Math.max(value, minimum),
    maximum,
  );
}

/**
 * Clamp confidence to the valid range [0, 1].
 */
function clampConfidence(
  value: number,
): number {
  return clamp(value, 0, 1);
}

/**
 * Convert a recovery score into a probability.
 *
 * The conversion is intentionally transparent rather than
 * pretending that this is a statistically trained probability
 * model. The score represents RayFlow's explainable recovery
 * opportunity estimate.
 */
function scoreToProbability(
  score: number,
): number {
  return Number(
    (clamp(score, 0, 100) / 100).toFixed(2),
  );
}

/**
 * Calculate expected recovery using the same amount unit
 * supplied by the caller.
 */
function calculateExpectedRecovery(
  amount: number,
  recoveryProbability: number,
): number {
  return Number(
    (amount * recoveryProbability).toFixed(2),
  );
}

/**
 * Determine the risk level associated with the
 * recovery recommendation.
 */
function getRiskLevel(
  action: RecoveryAction,
  recoveryScore: number,
): RecoveryRiskLevel {
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
 * Apply attempt-history adjustments.
 *
 * A first failure is generally a stronger recovery opportunity.
 * Previous failed attempts reduce confidence because repeatedly
 * retrying the same payment provides diminishing recovery value.
 */
function applyAttemptHistoryAdjustment(
  score: number,
  previousFailedAttempts: number,
  signals: string[],
): number {
  const normalizedAttempts = Math.max(
    0,
    Math.floor(previousFailedAttempts),
  );

  if (normalizedAttempts === 0) {
    signals.push(
      "First failed attempt increases recovery opportunity",
    );

    return score + 5;
  }

  if (normalizedAttempts === 1) {
    signals.push(
      "One previous failed attempt reduces recovery opportunity",
    );

    return score - 10;
  }

  const penalty = Math.min(
    normalizedAttempts * 12,
    36,
  );

  signals.push(
    `${normalizedAttempts} previous failed attempts reduce recovery opportunity`,
  );

  return score - penalty;
}

/**
 * Apply payment-method context.
 *
 * This is deliberately a modest signal. Payment method alone
 * must never override a safety-critical failure classification.
 */
function applyPaymentMethodAdjustment(
  score: number,
  paymentMethod: string,
  signals: string[],
): number {
  const normalizedMethod =
    paymentMethod.trim().toLowerCase();

  if (
    normalizedMethod.includes("card") ||
    normalizedMethod.includes("upi")
  ) {
    signals.push(
      `Payment method ${paymentMethod} is supported for automated recovery analysis`,
    );

    return score + 3;
  }

  signals.push(
    `Payment method ${paymentMethod} has limited recovery history in the current policy`,
  );

  return score - 3;
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
export function decideRecoveryAction(
  input: RecoveryDecisionInput,
): RecoveryDecision {
  const {
    orderId,
    amount,
    currency,
    paymentMethod,
    previousFailedAttempts = 0,
  } = input;

  const failureCode =
    normalizeFailureCode(
      input.failureCode,
    );

  const signals: string[] = [];

  /*
   * --------------------------------------------------------
   * SAFETY CHECK 1
   * Validate essential input.
   * --------------------------------------------------------
   */

  if (
    !orderId ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !currency ||
    !paymentMethod
  ) {
    return {
      action: "ESCALATE",
      confidence: 0.99,
      recoveryScore: 0,
      recoveryProbability: 0,
      expectedRecoveryAmount: 0,
      riskLevel: "HIGH",
      reason:
        "Recovery cannot be automated because required payment data is incomplete or invalid.",
      signals: [
        "Invalid or incomplete recovery input",
        "Recovery score unavailable because payment context is invalid",
        "Automated recovery blocked by safety policy",
      ],
      automated: false,
    };
  }

  /*
   * --------------------------------------------------------
   * SIGNALS
   * --------------------------------------------------------
   */

  signals.push(
    `Payment method: ${paymentMethod}`,
  );

  signals.push(
    `Amount: ${amount} ${currency}`,
  );

  if (failureCode) {
    signals.push(
      `Failure code: ${failureCode}`,
    );
  } else {
    signals.push(
      "Failure code unavailable",
    );
  }

  signals.push(
    `Previous failed attempts: ${previousFailedAttempts}`,
  );

  /*
   * --------------------------------------------------------
   * SAFETY CHECK 2
   * Enforce bounded retry policy.
   * --------------------------------------------------------
   */

  if (
    previousFailedAttempts >=
    MAX_AUTOMATED_RETRIES
  ) {
    signals.push(
      `Automated retry limit reached (${MAX_AUTOMATED_RETRIES})`,
    );

    signals.push(
      "Further automated execution is blocked to prevent repeated payment attempts",
    );

    const recoveryScore = 5;
    const recoveryProbability =
      scoreToProbability(
        recoveryScore,
      );

    return {
      action: "STOP",
      confidence: 0.99,
      recoveryScore,
      recoveryProbability,
      expectedRecoveryAmount:
        calculateExpectedRecovery(
          amount,
          recoveryProbability,
        ),
      riskLevel: "HIGH",
      reason:
        "RayFlow stopped automated recovery because the retry limit has been reached.",
      signals,
      automated: false,
    };
  }

  /*
   * --------------------------------------------------------
   * DECISION 1
   * Known non-retryable failure.
   * --------------------------------------------------------
   */

  if (
    STOP_FAILURE_CODES.has(
      failureCode,
    )
  ) {
    let recoveryScore =
      STOP_BASE_SCORE;

    signals.push(
      "Failure classified as non-retryable",
    );

    signals.push(
      "Immediate retry has low expected recovery value",
    );

    /*
     * Attempt history makes an already non-retryable
     * failure even less attractive for recovery.
     */
    recoveryScore =
      applyAttemptHistoryAdjustment(
        recoveryScore,
        previousFailedAttempts,
        signals,
      );

    recoveryScore = clamp(
      recoveryScore,
      0,
      25,
    );

    const recoveryProbability =
      scoreToProbability(
        recoveryScore,
      );

    return {
      action: "STOP",
      confidence: 0.97,
      recoveryScore,
      recoveryProbability,
      expectedRecoveryAmount:
        calculateExpectedRecovery(
          amount,
          recoveryProbability,
        ),
      riskLevel: "HIGH",
      reason:
        "RayFlow stopped recovery because the failure indicates a condition that is unlikely to be resolved by an immediate retry.",
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

  if (
    RETRYABLE_FAILURE_CODES.has(
      failureCode,
    )
  ) {
    let recoveryScore =
      RETRYABLE_BASE_SCORE;

    signals.push(
      "Failure classified as temporary/retryable",
    );

    /*
     * First/previous failure history.
     */
    recoveryScore =
      applyAttemptHistoryAdjustment(
        recoveryScore,
        previousFailedAttempts,
        signals,
      );

    /*
     * Payment method provides a modest
     * contextual signal.
     */
    recoveryScore =
      applyPaymentMethodAdjustment(
        recoveryScore,
        paymentMethod,
        signals,
      );

    /*
     * A retryable failure with the automated
     * retry limit still available receives a
     * strong recovery opportunity score.
     */
    recoveryScore = clamp(
      recoveryScore,
      50,
      95,
    );

    const recoveryProbability =
      scoreToProbability(
        recoveryScore,
      );

    signals.push(
      "Retry remains within the automated recovery limit",
    );

    signals.push(
      `Recovery opportunity score: ${recoveryScore}/100`,
    );

    signals.push(
      `Estimated recovery probability: ${Math.round(
        recoveryProbability * 100,
      )}%`,
    );

    return {
      action: "RETRY",
      confidence: 0.94,
      recoveryScore,
      recoveryProbability,
      expectedRecoveryAmount:
        calculateExpectedRecovery(
          amount,
          recoveryProbability,
        ),
      riskLevel:
        getRiskLevel(
          "RETRY",
          recoveryScore,
        ),
      reason:
        "RayFlow identified a temporary provider or network failure and recommends one bounded retry because the recovery opportunity remains strong.",
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

  signals.push(
    "Failure type is unknown or not classified",
  );

  signals.push(
    "Recovery probability cannot be established with sufficient confidence",
  );

  signals.push(
    "Automated recovery blocked until the failure is reviewed",
  );

  const recoveryScore =
    UNKNOWN_BASE_SCORE;

  const recoveryProbability =
    scoreToProbability(
      recoveryScore,
    );

  return {
    action: "ESCALATE",
    confidence: clampConfidence(
      0.90,
    ),
    recoveryScore,
    recoveryProbability,
    expectedRecoveryAmount:
      calculateExpectedRecovery(
        amount,
        recoveryProbability,
      ),
    riskLevel: "MEDIUM",
    reason:
      "RayFlow could not safely classify the failure, so automated recovery was blocked and the case should be reviewed.",
    signals,
    automated: false,
  };
}

/**
 * Convenience helper for callers that only need
 * to know whether an automated retry is allowed.
 */
export function canAutomateRecovery(
  decision: RecoveryDecision,
): boolean {
  return (
    decision.action === "RETRY" &&
    decision.automated
  );
}

/**
 * Expose the configured retry limit for:
 * - tests
 * - dashboards
 * - documentation
 */
export function getMaxAutomatedRetries(): number {
  return MAX_AUTOMATED_RETRIES;
}