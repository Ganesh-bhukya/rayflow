export type ProviderPaymentStatus =
  | "success"
  | "failed"
  | "pending";

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
  createPayment(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult>;

  getPaymentStatus(
    providerReference: string,
  ): Promise<ProviderPaymentResult>;
}

/**
 * Mock provider used by RayFlow during development/testing.
 *
 * The mock is deterministic so payment flows can be tested
 * without calling a real payment gateway.
 */
export class MockPaymentProvider
  implements PaymentProvider
{
  async createPayment(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const providerReference =
      `rayflow_success_${Date.now()}`;

    return {
      status: "success",
      providerReference,
    };
  }

  async getPaymentStatus(
    providerReference: string,
  ): Promise<ProviderPaymentResult> {
    const normalizedReference =
      providerReference.trim().toLowerCase();

    if (
      normalizedReference.includes("success")
    ) {
      return {
        status: "success",
        providerReference,
      };
    }

    if (
      normalizedReference.includes("failed")
    ) {
      return {
        status: "failed",
        providerReference,
        failureCode:
          "PROVIDER_PAYMENT_FAILED",
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
export const paymentProvider =
  new MockPaymentProvider();

/**
 * Convenience function retained for reconciliationService.
 */
export function getPaymentStatus(
  providerReference: string,
): Promise<ProviderPaymentResult> {
  return paymentProvider.getPaymentStatus(
    providerReference,
  );
}
