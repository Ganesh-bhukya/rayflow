type ProcessPaymentInput = {
    orderId: string;
    paymentMethod: string;
};
export declare function processPayment({ orderId, paymentMethod, }: ProcessPaymentInput): Promise<{
    idempotent: boolean;
    payment: {
        id: any;
        merchantId: any;
        customerId: any;
        amount: any;
        currency: any;
        status: any;
        attemptId: any;
        paymentMethod: any;
        providerReference?: never;
        transactionId?: never;
        failureCode?: never;
    };
} | {
    idempotent: boolean;
    payment: {
        id: any;
        merchantId: any;
        customerId: any;
        amount: any;
        currency: any;
        status: string;
        attemptId: any;
        paymentMethod: any;
        providerReference: any;
        transactionId: string | null;
        failureCode?: never;
    };
} | {
    idempotent: boolean;
    payment: {
        id: any;
        merchantId: any;
        customerId: any;
        amount: any;
        currency: any;
        status: string;
        attemptId: any;
        paymentMethod: any;
        providerReference: string;
        failureCode: string;
        transactionId?: never;
    };
} | {
    idempotent: boolean;
    payment: {
        id: any;
        merchantId: any;
        customerId: any;
        amount: any;
        currency: any;
        status: string;
        attemptId: any;
        paymentMethod: any;
        providerReference: string;
        transactionId?: never;
        failureCode?: never;
    };
}>;
export {};
//# sourceMappingURL=paymentService.d.ts.map