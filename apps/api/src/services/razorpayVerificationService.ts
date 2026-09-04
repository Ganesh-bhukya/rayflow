import crypto from "crypto";

import { getPgPool } from "../infrastructure/database/client.js";
import { razorpayConfig } from "../config/razorpay.js";
import { assertTransition } from "./paymentStateMachine.js";

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

function safeEqualHex(
  expectedSignature: string,
  receivedSignature: string,
): boolean {
  const expected = Buffer.from(
    expectedSignature,
    "hex",
  );

  const received = Buffer.from(
    receivedSignature,
    "hex",
  );

  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expected,
    received,
  );
}

function generatePaymentSignature(
  orderId: string,
  paymentId: string,
): string {
  return crypto
    .createHmac(
      "sha256",
      razorpayConfig.keySecret,
    )
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

export async function verifyRazorpayPayment(
  input: VerifyRazorpayPaymentInput,
): Promise<VerifyRazorpayPaymentResult> {
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * ------------------------------------------------------------
     * STEP 1
     * Validate request fields.
     * ------------------------------------------------------------
     */

    if (
      !input.rayflowPaymentId ||
      !input.razorpayPaymentId ||
      !input.razorpayOrderId ||
      !input.razorpaySignature
    ) {
      throw new Error(
        "All Razorpay verification fields are required.",
      );
    }

    /*
     * ------------------------------------------------------------
     * STEP 2
     * Lock the RayFlow payment order.
     *
     * This prevents concurrent verification requests from
     * creating duplicate transactions.
     * ------------------------------------------------------------
     */

    const orderResult = await client.query(
      `
      SELECT
        id,
        merchant_id,
        customer_id,
        amount,
        currency,
        status,
        razorpay_order_id
      FROM public.payment_orders
      WHERE id = $1
      FOR UPDATE
      `,
      [input.rayflowPaymentId],
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");

      throw new Error(
        "RayFlow payment order not found.",
      );
    }

    const order = orderResult.rows[0];

    /*
     * ------------------------------------------------------------
     * STEP 3
     * Make sure the Razorpay order belongs to this
     * RayFlow payment.
     *
     * IMPORTANT:
     * We use the Razorpay order ID stored on our server.
     * We do not trust the browser's order ID for signature
     * generation.
     * ------------------------------------------------------------
     */

    if (!order.razorpay_order_id) {
      await client.query("ROLLBACK");

      throw new Error(
        "Razorpay order ID is missing for this payment.",
      );
    }

    if (
      order.razorpay_order_id !==
      input.razorpayOrderId
    ) {
      await client.query("ROLLBACK");

      throw new Error(
        "Razorpay order ID does not match the RayFlow payment.",
      );
    }

    /*
     * ------------------------------------------------------------
     * STEP 4
     * If already paid, return the existing transaction.
     *
     * This makes verification idempotent.
     * ------------------------------------------------------------
     */

    if (order.status === "paid") {
      const existingResult =
        await client.query(
          `
          SELECT
            pa.id AS "attemptId",
            t.id AS "transactionId"
          FROM public.payment_attempts pa
          LEFT JOIN public.transactions t
            ON t.attempt_id = pa.id
          WHERE pa.order_id = $1
          ORDER BY pa.created_at DESC
          LIMIT 1
          `,
          [order.id],
        );

      await client.query("COMMIT");

      return {
        verified: true,
        idempotent: true,
        paymentId: order.id,
        orderId: order.razorpay_order_id,
        attemptId:
          existingResult.rows[0]?.attemptId ?? "",
        transactionId:
          existingResult.rows[0]?.transactionId ??
          null,
        status: order.status,
      };
    }

    /*
     * ------------------------------------------------------------
     * STEP 5
     * Verify the Razorpay signature.
     *
     * Razorpay requires:
     *
     * HMAC-SHA256(
     *   server_order_id + "|" + razorpay_payment_id,
     *   key_secret
     * )
     * ------------------------------------------------------------
     */

    const generatedSignature =
      generatePaymentSignature(
        order.razorpay_order_id,
        input.razorpayPaymentId,
      );

    const signatureValid =
      safeEqualHex(
        generatedSignature,
        input.razorpaySignature,
      );

    if (!signatureValid) {
      /*
       * Do not mark the payment successful.
       *
       * A failed signature verification must not fulfil
       * the order.
       */

      await client.query(
        `
        INSERT INTO public.audit_logs
        (
          action,
          entity_type,
          entity_id,
          metadata
        )
        VALUES
        (
          'razorpay_payment_signature_invalid',
          'payment_order',
          $1,
          $2
        )
        `,
        [
          order.id,
          JSON.stringify({
            razorpayOrderId:
              input.razorpayOrderId,
            razorpayPaymentId:
              input.razorpayPaymentId,
          }),
        ],
      );

      await client.query("COMMIT");

      throw new Error(
        "Invalid Razorpay payment signature.",
      );
    }

    /*
     * ------------------------------------------------------------
     * STEP 6
     * Lock the latest payment attempt.
     * ------------------------------------------------------------
     */

    const attemptResult =
      await client.query(
        `
        SELECT
          id,
          order_id,
          payment_method,
          status,
          provider_reference,
          failure_code
        FROM public.payment_attempts
        WHERE order_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
        `,
        [order.id],
      );

    if (attemptResult.rows.length === 0) {
      await client.query("ROLLBACK");

      throw new Error(
        "Payment attempt not found.",
      );
    }

    const attempt = attemptResult.rows[0];

    /*
     * ------------------------------------------------------------
     * STEP 7
     * Enforce the RayFlow payment state machine.
     *
     * Normal path:
     *
     * processing -> success
     * ------------------------------------------------------------
     */

    if (
      attempt.status !== "success"
    ) {
      assertTransition(
        attempt.status,
        "success",
      );

      await client.query(
        `
        UPDATE public.payment_attempts
        SET
          status = 'success',
          provider_reference = $1,
          failure_code = NULL,
          updated_at = now()
        WHERE id = $2
        `,
        [
          input.razorpayPaymentId,
          attempt.id,
        ],
      );
    }

    /*
     * ------------------------------------------------------------
     * STEP 8
     * Mark RayFlow payment as paid.
     * ------------------------------------------------------------
     */

    await client.query(
      `
      UPDATE public.payment_orders
      SET
        status = 'paid',
        updated_at = now()
      WHERE id = $1
      `,
      [order.id],
    );

    /*
     * ------------------------------------------------------------
     * STEP 9
     * Create exactly one transaction for this attempt.
     * ------------------------------------------------------------
     */

    const existingTransaction =
      await client.query(
        `
        SELECT
          id
        FROM public.transactions
        WHERE attempt_id = $1
        LIMIT 1
        `,
        [attempt.id],
      );

    let transactionId: string | null =
      null;

    if (
      existingTransaction.rows.length > 0
    ) {
      transactionId =
        existingTransaction.rows[0].id;
    } else {
      const transactionResult =
        await client.query(
          `
          INSERT INTO public.transactions
          (
            id,
            order_id,
            attempt_id,
            amount,
            currency,
            type,
            status
          )
          VALUES
          (
            gen_random_uuid(),
            $1,
            $2,
            $3,
            $4,
            'payment',
            'success'
          )
          RETURNING id
          `,
          [
            order.id,
            attempt.id,
            order.amount,
            order.currency,
          ],
        );

      transactionId =
        transactionResult.rows[0].id;
    }

    /*
     * ------------------------------------------------------------
     * STEP 10
     * Audit successful verification.
     * ------------------------------------------------------------
     */

    await client.query(
      `
      INSERT INTO public.audit_logs
      (
        action,
        entity_type,
        entity_id,
        metadata
      )
      VALUES
      (
        'razorpay_payment_verified',
        'payment_order',
        $1,
        $2
      )
      `,
      [
        order.id,
        JSON.stringify({
          razorpayOrderId:
            input.razorpayOrderId,
          razorpayPaymentId:
            input.razorpayPaymentId,
          attemptId: attempt.id,
          transactionId,
        }),
      ],
    );

    await client.query("COMMIT");

    return {
      verified: true,
      idempotent: false,
      paymentId: order.id,
      orderId: order.razorpay_order_id,
      attemptId: attempt.id,
      transactionId,
      status: "paid",
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Razorpay verification rollback error:",
        rollbackError,
      );
    }

    throw error;
  } finally {
    client.release();
  }
}