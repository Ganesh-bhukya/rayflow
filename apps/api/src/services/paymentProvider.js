/**
 * Mock provider used by RayFlow during development/testing.
 *
 * The mock is deterministic so payment flows can be tested
 * without calling a real payment gateway.
 */
export class MockPaymentProvider {
    async createPayment(input) {
        const providerReference = `rayflow_success_${Date.now()}`;
        return {
            status: "success",
            providerReference,
        };
    }
    async getPaymentStatus(providerReference) {
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
}
/**
 * Current provider used by RayFlow.
 *
 * Later this can be replaced with a real provider
 * implementation without changing paymentService.
 */
export const paymentProvider = new MockPaymentProvider();
/**
 * Convenience function retained for reconciliationService.
 */
export function getPaymentStatus(providerReference) {
    return paymentProvider.getPaymentStatus(providerReference);
}
//# sourceMappingURL=paymentProvider.js.map