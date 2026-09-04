export type RefundStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed";

const allowedTransitions: Record<
  RefundStatus,
  RefundStatus[]
> = {
  pending: ["processing", "failed"],

  processing: ["success", "failed"],

  success: [],

  failed: ["processing"],
};

export function canRefundTransition(
  from: string,
  to: string,
): boolean {
  const allowed =
    allowedTransitions[from as RefundStatus];

  if (!allowed) {
    return false;
  }

  return allowed.includes(
    to as RefundStatus,
  );
}

export function assertRefundTransition(
  from: string,
  to: string,
): void {
  if (!canRefundTransition(from, to)) {
    throw new Error(
      `Invalid refund state transition: ${from} -> ${to}`,
    );
  }
}

export function getAllowedRefundTransitions(
  currentStatus: string,
): RefundStatus[] {
  return (
    allowedTransitions[
      currentStatus as RefundStatus
    ] ?? []
  );
}
