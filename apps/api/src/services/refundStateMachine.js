const allowedTransitions = {
    pending: ["processing", "failed"],
    processing: ["success", "failed"],
    success: [],
    failed: ["processing"],
};
export function canRefundTransition(from, to) {
    const allowed = allowedTransitions[from];
    if (!allowed) {
        return false;
    }
    return allowed.includes(to);
}
export function assertRefundTransition(from, to) {
    if (!canRefundTransition(from, to)) {
        throw new Error(`Invalid refund state transition: ${from} -> ${to}`);
    }
}
export function getAllowedRefundTransitions(currentStatus) {
    return (allowedTransitions[currentStatus] ?? []);
}
//# sourceMappingURL=refundStateMachine.js.map