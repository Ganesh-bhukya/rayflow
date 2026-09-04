import Razorpay from "razorpay";

import { razorpayConfig } from "../../config/razorpay.js";

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

const razorpay = new Razorpay({
  key_id: razorpayConfig.keyId,
  key_secret: razorpayConfig.keySecret,
});

export async function createRazorpayOrder(
  input: CreateRazorpayOrderInput,
): Promise<RazorpayOrderResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error(
      "Razorpay order amount must be a positive integer.",
    );
  }

  if (!input.currency || input.currency.length !== 3) {
    throw new Error(
      "Razorpay order currency must be a 3-letter ISO code.",
    );
  }

  if (
    !input.receipt ||
    input.receipt.length > 40
  ) {
    throw new Error(
      "Razorpay order receipt is required and must be at most 40 characters.",
    );
  }

  const orderPayload = {
    amount: input.amount,
    currency: input.currency.toUpperCase(),
    receipt: input.receipt,
    ...(input.notes ? { notes: input.notes } : {}),
  };

  const order = await razorpay.orders.create(
    orderPayload as any,
  );

  const razorpayOrder = order as any;

  return {
    id: razorpayOrder.id,
    entity: razorpayOrder.entity,
    amount: razorpayOrder.amount,
    amountPaid: razorpayOrder.amount_paid,
    amountDue: razorpayOrder.amount_due,
    currency: razorpayOrder.currency,
    receipt: razorpayOrder.receipt,
    status: razorpayOrder.status,
    attempts: razorpayOrder.attempts,
    createdAt: razorpayOrder.created_at,
  };
}

/**
 * Creates a real Razorpay refund.
 *
 * The paymentId must be the Razorpay payment ID
 * returned after successful Checkout verification.
 */
export async function createRazorpayRefund(
  input: CreateRazorpayRefundInput,
): Promise<RazorpayRefundResult> {
  if (!input.paymentId?.trim()) {
    throw new Error(
      "Razorpay payment ID is required for refund.",
    );
  }

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error(
      "Razorpay refund amount must be a positive integer.",
    );
  }

  if (!input.currency || input.currency.length !== 3) {
    throw new Error(
      "Razorpay refund currency must be a 3-letter ISO code.",
    );
  }

  if (
    !input.receipt ||
    input.receipt.length > 40
  ) {
    throw new Error(
      "Razorpay refund receipt is required and must be at most 40 characters.",
    );
  }

  /*
   * We call Razorpay's REST API directly here instead of
   * relying on SDK-specific refund typing.
   *
   * This also allows us to send X-Refund-Idempotency.
   */
  const url =
    `https://api.razorpay.com/v1/payments/` +
    `${encodeURIComponent(input.paymentId)}/refund`;

  const basicAuth = Buffer.from(
    `${razorpayConfig.keyId}:${razorpayConfig.keySecret}`,
  ).toString("base64");

  const refundPayload = {
    amount: input.amount,
    speed: "normal",
    receipt: input.receipt,
    notes: {
      currency: input.currency.toUpperCase(),
      source: "rayflow",
      ...(input.notes ?? {}),
    },
  };

  /*
   * The receipt is deterministic for a RayFlow refund.
   * It gives us a stable idempotency key if the same
   * refund operation is retried.
   */
  const idempotencyKey =
    `rayflow-refund-${input.receipt}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
      "X-Refund-Idempotency": idempotencyKey,
    },
    body: JSON.stringify(refundPayload),
  });

  const responseBody =
    await response.text();

  let data: any = null;

  try {
    data = responseBody
      ? JSON.parse(responseBody)
      : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const razorpayMessage =
      data?.error?.description ||
      data?.error?.reason ||
      data?.message ||
      `Razorpay refund failed with HTTP ${response.status}.`;

    const error = new Error(
      razorpayMessage,
    ) as Error & {
      statusCode?: number;
      razorpayError?: unknown;
    };

    error.statusCode = response.status;
    error.razorpayError = data;

    throw error;
  }

  return {
    id: data.id,
    entity: data.entity,
    amount: data.amount,
    currency: data.currency,
    paymentId:
      data.payment_id ??
      input.paymentId,
    status: data.status,
    speedProcessed:
      data.speed_processed ??
      null,
    speedRequested:
      data.speed_requested ??
      null,
    createdAt:
      data.created_at ??
      Math.floor(Date.now() / 1000),
    receipt:
      data.receipt ??
      input.receipt,
  };
}

export default razorpay;