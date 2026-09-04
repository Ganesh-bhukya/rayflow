const allowedTransitions = {
    created: ["processing", "failed"],
    processing: ["success", "failed"],
    failed: ["processing"],
    success: [],
};
/**
 * Check whether a payment attempt can move
 * from one state to another.
 */
export function canTransition(from, to) {
    const allowed = allowedTransitions[from];
    if (!allowed) {
        return false;
    }
    return allowed.includes(to);
}
/**
 * Validate a state transition.
 *
 * Throws when the transition is invalid.
 */
export function assertTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new Error(`Invalid payment state transition: ${from} -> ${to}`);
    }
}
/**
 * Get all states that are valid from
 * the current state.
 */
export function getAllowedTransitions(currentStatus) {
    return (allowedTransitions[currentStatus] ?? []);
}
//# sourceMappingURL=paymentStateMachine.js.map