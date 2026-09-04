import "dotenv/config";

const paymentId = "pay_TXDGrH7uspGetE";
const amount = 50000;

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

if (!keyId || !keySecret) {
  throw new Error(
    "RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is missing from .env",
  );
}

const url =
  `https://api.razorpay.com/v1/payments/` +
  `${encodeURIComponent(paymentId)}/refund`;

const basicAuth = Buffer.from(
  `${keyId}:${keySecret}`,
).toString("base64");

console.log("\nMinimal Razorpay Refund Test");
console.log("============================\n");

console.log("Payment ID:", paymentId);
console.log("Amount:", amount, "paise");
console.log("Amount:", amount / 100, "INR");

try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
    }),
  });

  const responseText = await response.text();

  let data;

  try {
    data = responseText
      ? JSON.parse(responseText)
      : null;
  } catch {
    data = responseText;
  }

  console.log("\nHTTP Status:", response.status);
  console.log("Response:");

  console.dir(data, { depth: null });

  if (response.ok) {
    console.log(
      "\n✅ RAZORPAY REFUND SUCCEEDED",
    );
  } else {
    console.log(
      "\n❌ RAZORPAY REFUND FAILED",
    );
  }
} catch (error) {
  console.error(
    "\n❌ Request failed:",
  );

  console.error(error);
}