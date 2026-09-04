import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";

const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();

if (!secret) {
  throw new Error("RAZORPAY_WEBHOOK_SECRET is missing");
}

const rayflowRefundId =
  "ef07f000-b765-4773-879b-256e508ab8d2";

const bodyObject = {
  event: "refund.created",

  payload: {
    refund: {
      entity: {
        id: "rfp_test_rayflow_created_001",
        amount: 10000,
        currency: "INR",
        status: "created",
        payment_id: "pay_test_rayflow_created_001",

        notes: {
          rayflowRefundId: rayflowRefundId,
        },

        speed_processed: "normal",
        speed_requested: "normal",
      },
    },
  },
};

const body = JSON.stringify(bodyObject);

fs.writeFileSync(
  "test-webhook-body.json",
  body,
  "utf8",
);

const signature = crypto
  .createHmac("sha256", secret)
  .update(body, "utf8")
  .digest("hex");

console.log("Webhook body:");
console.log(body);

console.log("");
console.log("Signature generated from .env:");
console.log(signature);

console.log("");
console.log("RayFlow refund ID:");
console.log(rayflowRefundId);

console.log("");
console.log("Expected result: pending status remains pending");

const response = await fetch(
  "http://localhost:4000/webhooks/razorpay",
  {
    method: "POST",

    headers: {
      "Content-Type": "application/json",

      "x-razorpay-event-id":
        "local-node-refund-created-test-003",

      "x-razorpay-signature": signature,
    },

    body,
  },
);

console.log("");
console.log("HTTP:", response.status);
console.log("Response:", await response.text());