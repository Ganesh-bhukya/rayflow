export type ProviderPaymentStatus = "success" | "failed" | "pending";
export type ProviderPaymentResult = {
    status: ProviderPaymentStatus;
    providerReference: string;
    failureCode?: string;
};
export type CreatePaymentInput = {
    orderId: string;
    amount: number;
    currency: string;
    paymentMethod: string;
};
export type CreatePaymentResult = {
    status: "success" | "failed";
    providerReference: string;
    failureCode?: string;
};
/**
 * Payment provider abstraction.
 *
 * In production this interface can be implemented by
 * Razorpay, Stripe, or another payment provider.
 */
export interface PaymentProvider {
    createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
    getPaymentStatus(providerReference: string): Promise<ProviderPaymentResult>;
}
/**
 * Mock provider used by RayFlow during development/testing.
 *
 * The mock is deterministic so payment flows can be tested
 * without calling a real payment gateway.
 */
export declare class MockPaymentProvider implements PaymentProvider {
    createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
    getPaymentStatus(providerReference: string): Promise<ProviderPaymentResult>;
}
/**
 * Current provider used by RayFlow.
 *
 * Later this can be replaced with a real provider
 * implementation without changing paymentService.
 */
export declare const paymentProvider: MockPaymentProvider;
/**
 * Convenience function retained for reconciliationService.
 */
export declare function getPaymentStatus(providerReference: string): Promise<ProviderPaymentResult>;
//# sourceMappingURL=paymentProvider.d.ts.map