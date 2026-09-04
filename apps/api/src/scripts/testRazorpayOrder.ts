import "dotenv/config";

import { createRazorpayOrder } from "../infrastructure/razorpay/razorpayClient.js";

async function main(): Promise<void> {
  console.log("Creating Razorpay Test Mode order...");

  const order = await createRazorpayOrder({
    amount: 10000,
    currency: "INR",
    receipt: `rayflow_test_${Date.now()}`,
    notes: {
      project: "RayFlow",
      environment: "test",
    },
  });

  console.log("");
  console.log("Razorpay order created successfully.");
  console.log("");
  console.log(`Order ID: ${order.id}`);
  console.log(`Amount: ${order.amount}`);
  console.log(`Currency: ${order.currency}`);
  console.log(`Status: ${order.status}`);
  console.log(`Attempts: ${order.attempts}`);
  console.log(`Receipt: ${order.receipt}`);
  console.log("");
}

main().catch((error: unknown) => {
  console.error("");
  console.error("Failed to create Razorpay order.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});