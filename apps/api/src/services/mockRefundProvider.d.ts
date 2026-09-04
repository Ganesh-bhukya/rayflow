export type RefundProviderStatus = "success" | "failed" | "pending";
export type RefundProviderResult = {
    status: RefundProviderStatus;
    providerReference: string;
    failureCode?: string;
};
/**
 * Deterministic mock refund provider.
 *
 * SUCCESS:
 *   rayflow_refund_success_*
 *
 * FAILED:
 *   rayflow_refund_failed_*
 *
 * PENDING:
 *   anything else
 */
export declare function processRefund(providerReference: string): Promise<RefundProviderResult>;
//# sourceMappingURL=mockRefundProvider.d.ts.map