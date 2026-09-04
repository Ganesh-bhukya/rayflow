export type PaymentAttemptStatus = "created" | "processing" | "success" | "failed";
/**
 * Check whether a payment attempt can move
 * from one state to another.
 */
export declare function canTransition(from: string, to: string): boolean;
/**
 * Validate a state transition.
 *
 * Throws when the transition is invalid.
 */
export declare function assertTransition(from: string, to: string): void;
/**
 * Get all states that are valid from
 * the current state.
 */
export declare function getAllowedTransitions(currentStatus: string): PaymentAttemptStatus[];
//# sourceMappingURL=paymentStateMachine.d.ts.map