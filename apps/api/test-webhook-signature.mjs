import "dotenv/config";
import crypto from "node:crypto";

const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();

if (!secret) {
  throw new Error("RAZORPAY_WEBHOOK_SECRET is missing from .env");
}

const body = JSON.stringify({
  event: "refund.processed",
  payload: {
    refund: {
      entity: {
        id: "rf_test_signature_001",
        payment_id: "pay_test_signature_001",
        amount: 10000,
        currency: "INR",
        status: "processed",
        notes: {
          rayflowRefundId: "00000000-0000-0000-0000-000000000000"
        }
      }
    }
  }
});

const signature = crypto
  .createHmac("sha256", secret)
  .update(Buffer.from(body, "utf8"))
  .digest("hex");

console.log("");
console.log("========================================");
console.log(" RayFlow Webhook Signature Test");
console.log("========================================");
console.log("Secret loaded: YES");
console.log("Body bytes:", Buffer.byteLength(body, "utf8"));
console.log("Signature:", signature);
console.log("");

const response = await fetch(
  "http://localhost:4000/webhooks/razorpay",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-event-id": "local-signature-test-003",
      "x-razorpay-signature": signature,
    },
    body,
  },
);

const responseText = await response.text();

console.log("HTTP status:", response.status);
console.log("Response:", responseText);
console.log("");
