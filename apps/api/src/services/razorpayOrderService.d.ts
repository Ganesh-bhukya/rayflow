import { type RazorpayOrderResult } from "../infrastructure/razorpay/razorpayClient.js";
export type CreateRayFlowRazorpayOrderInput = {
    orderId: string;
    amount: number;
    currency: string;
    merchantId: string;
    customerId: string;
};
export declare function createRayFlowRazorpayOrder(input: CreateRayFlowRazorpayOrderInput): Promise<RazorpayOrderResult>;
//# sourceMappingURL=razorpayOrderService.d.ts.map