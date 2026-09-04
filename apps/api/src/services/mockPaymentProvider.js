/**
 * Mock payment provider.
 *
 * This simulates the API we would normally call at
 * Razorpay/Stripe/etc. during reconciliation.
 *
 * In a real system this would make an HTTP request
 * to the payment provider.
 */
export async function getPaymentStatus(providerReference) {
    /*
     * ------------------------------------------------------
     * DEMO RULES
     * ------------------------------------------------------
     *
     * These deterministic rules allow us to test all
     * reconciliation scenarios without a real provider.
     *
     * SUCCESS
     *   providerReference contains "success"
     *
     * FAILED
     *   providerReference contains "failed"
     *
     * PENDING
     *   everything else
     */
    const normalizedReference = providerReference.trim().toLowerCase();
    if (normalizedReference.includes("success")) {
        return {
            status: "success",
            providerReference,
        };
    }
    if (normalizedReference.includes("failed")) {
        return {
            status: "failed",
            providerReference,
            failureCode: "PROVIDER_PAYMENT_FAILED",
        };
    }
    return {
        status: "pending",
        providerReference,
    };
}
//# sourceMappingURL=mockPaymentProvider.js.map