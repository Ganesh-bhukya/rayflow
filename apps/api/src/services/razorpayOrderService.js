import { createRazorpayOrder, } from "../infrastructure/razorpay/razorpayClient.js";
export async function createRayFlowRazorpayOrder(input) {
    if (!input.orderId) {
        throw new Error("RayFlow order ID is required.");
    }
    if (!input.merchantId) {
        throw new Error("Merchant ID is required.");
    }
    if (!input.customerId) {
        throw new Error("Customer ID is required.");
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
        throw new Error("RayFlow payment amount must be a positive integer.");
    }
    if (!input.currency || input.currency.length !== 3) {
        throw new Error("RayFlow payment currency must be a 3-letter ISO code.");
    }
    /*
     * Razorpay receipt:
     *
     * - Must be <= 40 characters.
     * - Keep it deterministic from the RayFlow order ID.
     * - This makes troubleshooting easier.
     */
    const receipt = `rf_${input.orderId.replace(/-/g, "").slice(0, 32)}`;
    return createRazorpayOrder({
        amount: input.amount,
        currency: input.currency,
        receipt,
        notes: {
            rayflowOrderId: input.orderId,
            merchantId: input.merchantId,
            customerId: input.customerId,
            source: "rayflow",
            environment: "test",
        },
    });
}
//# sourceMappingURL=razorpayOrderService.js.map