import "dotenv/config";

const paymentId = "pay_TXDGrH7uspGetE";

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

if (!keyId || !keySecret) {
  throw new Error(
    "RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing from .env",
  );
}

const basicAuth = Buffer.from(
  `${keyId}:${keySecret}`,
).toString("base64");

const headers = {
  Authorization: `Basic ${basicAuth}`,
  "Content-Type": "application/json",
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
  };
}

console.log("\n");
console.log("==========================================");
console.log("Razorpay Refund Diagnostic");
console.log("==========================================");
console.log();

console.log("Payment ID:", paymentId);

try {
  // --------------------------------------------------
  // 1. FETCH PAYMENT
  // --------------------------------------------------

  console.log("\n1. Fetching payment...");
  console.log("------------------------------------------");

  const paymentResult = await request(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(
      paymentId,
    )}`,
  );

  console.log("HTTP Status:", paymentResult.status);

  console.dir(paymentResult.data, {
    depth: null,
  });

  if (!paymentResult.ok) {
    throw new Error(
      "Unable to fetch Razorpay payment.",
    );
  }

  const payment = paymentResult.data;

  console.log("\nPayment Summary");
  console.log("------------------------------------------");

  console.log("ID:", payment.id);
  console.log("Order ID:", payment.order_id);
  console.log("Amount:", payment.amount);
  console.log(
    "Amount INR:",
    payment.amount / 100,
  );
  console.log(
    "Amount Refunded:",
    payment.amount_refunded,
  );
  console.log(
    "Refunded INR:",
    (payment.amount_refunded ?? 0) / 100,
  );
  console.log("Status:", payment.status);
  console.log("Captured:", payment.captured);
  console.log("Refund Status:", payment.refund_status);
  console.log("Method:", payment.method);
  console.log("Created At:", payment.created_at);

  console.log("\nPayment Error Information");
  console.log("------------------------------------------");

  console.log(
    "Error Code:",
    payment.error_code ?? null,
  );

  console.log(
    "Error Description:",
    payment.error_description ?? null,
  );

  console.log(
    "Error Source:",
    payment.error_source ?? null,
  );

  console.log(
    "Error Step:",
    payment.error_step ?? null,
  );

  console.log(
    "Error Reason:",
    payment.error_reason ?? null,
  );

  // --------------------------------------------------
  // 2. FETCH EXISTING REFUNDS
  // --------------------------------------------------

  console.log("\n2. Fetching existing refunds...");
  console.log("------------------------------------------");

  const refundsResult = await request(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(
      paymentId,
    )}/refunds`,
  );

  console.log("HTTP Status:", refundsResult.status);

  console.dir(refundsResult.data, {
    depth: null,
  });

  // --------------------------------------------------
  // 3. FINAL DIAGNOSTIC
  // --------------------------------------------------

  console.log("\n3. Diagnostic Conclusion");
  console.log("------------------------------------------");

  if (payment.status !== "captured") {
    console.log(
      "❌ Payment is NOT captured.",
    );
    console.log(
      "Refunds can only be initiated for captured payments.",
    );
  } else if (payment.amount_refunded >= payment.amount) {
    console.log(
      "❌ Payment is already fully refunded.",
    );
  } else if (payment.refund_status === "full") {
    console.log(
      "❌ Razorpay reports the payment as fully refunded.",
    );
  } else {
    console.log(
      "✅ Payment appears refundable from the payment state.",
    );
  }

  console.log("\n");
  console.log("Diagnostic complete.");
  console.log();
} catch (error) {
  console.error("\n❌ Diagnostic failed:");
  console.error(error);
}