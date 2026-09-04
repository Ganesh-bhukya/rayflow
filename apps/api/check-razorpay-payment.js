import "dotenv/config";
import Razorpay from "razorpay";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const paymentId = "pay_TXDGrH7uspGetE";

try {
  const payment = await razorpay.payments.fetch(paymentId);

  console.log("\nRazorpay Payment Details");
  console.log("========================\n");

  console.log("Payment ID:", payment.id);
  console.log("Order ID:", payment.order_id);
  console.log("Amount:", payment.amount, "paise");
  console.log("Amount:", Number(payment.amount) / 100, payment.currency);
  console.log("Status:", payment.status);
  console.log("Method:", payment.method);
  console.log("Captured:", payment.captured);
  console.log("Refund Status:", payment.refund_status);
  console.log("Refunded Amount:", payment.amount_refunded, "paise");
  console.log("Refunded Amount:", Number(payment.amount_refunded || 0) / 100, payment.currency);

  console.log("\nFull Razorpay response:");
  console.dir(payment, { depth: null });

  if (payment.status === "captured" || payment.captured === true) {
    console.log("\n✅ PAYMENT IS CAPTURED — REFUND SHOULD BE POSSIBLE");
  } else {
    console.log("\n⚠️ PAYMENT IS NOT CAPTURED — THIS MAY EXPLAIN THE REFUND FAILURE");
  }
} catch (error) {
  console.error("\n❌ Failed to fetch Razorpay payment");

  console.error(error);

  if (error?.error) {
    console.error("\nRazorpay error:");
    console.dir(error.error, { depth: null });
  }
}