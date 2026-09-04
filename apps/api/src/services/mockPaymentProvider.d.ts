export type ProviderPaymentStatus = "success" | "failed" | "pending";
export type ProviderPaymentResult = {
    status: ProviderPaymentStatus;
    providerReference: string;
    failureCode?: string;
};
/**
 * Mock payment provider.
 *
 * This simulates the API we would normally call at
 * Razorpay/Stripe/etc. during reconciliation.
 *
 * In a real system this would make an HTTP request
 * to the payment provider.
 */
export declare function getPaymentStatus(providerReference: string): Promise<ProviderPaymentResult>;
//# sourceMappingURL=mockPaymentProvider.d.ts.map