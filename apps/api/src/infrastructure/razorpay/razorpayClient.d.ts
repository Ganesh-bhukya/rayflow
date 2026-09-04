import Razorpay from "razorpay";
export type CreateRazorpayOrderInput = {
    amount: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
};
export type RazorpayOrderResult = {
    id: string;
    entity: string;
    amount: number;
    amountPaid: number;
    amountDue: number;
    currency: string;
    receipt: string;
    status: string;
    attempts: number;
    createdAt: number;
};
export type CreateRazorpayRefundInput = {
    paymentId: string;
    amount: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
};
export type RazorpayRefundResult = {
    id: string;
    entity: string;
    amount: number;
    currency: string;
    paymentId: string;
    status: string;
    speedProcessed: string | null;
    speedRequested: string | null;
    createdAt: number;
    receipt: string | null;
};
declare const razorpay: Razorpay;
export declare function createRazorpayOrder(input: CreateRazorpayOrderInput): Promise<RazorpayOrderResult>;
/**
 * Creates a real Razorpay refund.
 *
 * The paymentId must be the Razorpay payment ID
 * returned after successful Checkout verification.
 */
export declare function createRazorpayRefund(input: CreateRazorpayRefundInput): Promise<RazorpayRefundResult>;
export default razorpay;
//# sourceMappingURL=razorpayClient.d.ts.map