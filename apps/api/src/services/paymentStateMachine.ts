export type PaymentAttemptStatus =
  | "created"
  | "processing"
  | "success"
  | "failed";

const allowedTransitions: Record<
  PaymentAttemptStatus,
  PaymentAttemptStatus[]
> = {
  created: ["processing", "failed"],

  processing: ["success", "failed"],

  failed: ["processing"],

  success: [],
};

/**
 * Check whether a payment attempt can move
 * from one state to another.
 */
export function canTransition(
  from: string,
  to: string,
): boolean {
  const allowed =
    allowedTransitions[
      from as PaymentAttemptStatus
    ];

  if (!allowed) {
    return false;
  }

  return allowed.includes(
    to as PaymentAttemptStatus,
  );
}

/**
 * Validate a state transition.
 *
 * Throws when the transition is invalid.
 */
export function assertTransition(
  from: string,
  to: string,
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid payment state transition: ${from} -> ${to}`,
    );
  }
}

/**
 * Get all states that are valid from
 * the current state.
 */
export function getAllowedTransitions(
  currentStatus: string,
): PaymentAttemptStatus[] {
  return (
    allowedTransitions[
      currentStatus as PaymentAttemptStatus
    ] ?? []
  );
}