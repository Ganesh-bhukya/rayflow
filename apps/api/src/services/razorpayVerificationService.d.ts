export type VerifyRazorpayPaymentInput = {
    rayflowPaymentId: string;
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature: string;
};
export type VerifyRazorpayPaymentResult = {
    verified: boolean;
    idempotent: boolean;
    paymentId: string;
    orderId: string;
    attemptId: string;
    transactionId: string | null;
    status: string;
};
export declare function verifyRazorpayPayment(input: VerifyRazorpayPaymentInput): Promise<VerifyRazorpayPaymentResult>;
//# sourceMappingURL=razorpayVerificationService.d.ts.map