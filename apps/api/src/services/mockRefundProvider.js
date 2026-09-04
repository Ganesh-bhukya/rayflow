/**
 * Deterministic mock refund provider.
 *
 * SUCCESS:
 *   rayflow_refund_success_*
 *
 * FAILED:
 *   rayflow_refund_failed_*
 *
 * PENDING:
 *   anything else
 */
export async function processRefund(providerReference) {
    const normalizedReference = providerReference.trim().toLowerCase();
    if (normalizedReference.startsWith("rayflow_refund_success_")) {
        return {
            status: "success",
            providerReference,
        };
    }
    if (normalizedReference.startsWith("rayflow_refund_failed_")) {
        return {
            status: "failed",
            providerReference,
            failureCode: "PROVIDER_REFUND_FAILED",
        };
    }
    return {
        status: "pending",
        providerReference,
    };
}
//# sourceMappingURL=mockRefundProvider.js.map