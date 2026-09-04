export type RefundStatus = "pending" | "processing" | "success" | "failed";
export declare function canRefundTransition(from: string, to: string): boolean;
export declare function assertRefundTransition(from: string, to: string): void;
export declare function getAllowedRefundTransitions(currentStatus: string): RefundStatus[];
//# sourceMappingURL=refundStateMachine.d.ts.map