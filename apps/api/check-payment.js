import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const transactionId = "a0d56b06-c096-4bd2-8a1b-9a47c6bff665";

const result = await pool.query(
  `
  SELECT
    t.id AS transaction_id,
    t.amount,
    t.currency,
    t.status AS transaction_status,

    po.id AS payment_order_id,
    po.status AS payment_order_status,
    po.razorpay_order_id,

    pa.id AS attempt_id,
    pa.status AS attempt_status,
    pa.provider_reference

  FROM transactions t

  JOIN payment_orders po
    ON po.id = t.order_id

  JOIN payment_attempts pa
    ON pa.id = t.attempt_id

  WHERE t.id = $1
  `,
  [transactionId],
);

console.log("\nRayFlow Razorpay Payment Verification");
console.log("=====================================\n");

if (result.rows.length === 0) {
  console.log("❌ Transaction not found.");
} else {
  console.table(result.rows);

  const payment = result.rows[0];

  console.log("\nImportant fields:");

  console.log(
    "Transaction ID:",
    payment.transaction_id,
  );

  console.log(
    "Amount:",
    payment.amount,
    "paise",
  );

  console.log(
    "Amount:",
    Number(payment.amount) / 100,
    payment.currency,
  );

  console.log(
    "Transaction Status:",
    payment.transaction_status,
  );

  console.log(
    "Payment Order ID:",
    payment.payment_order_id,
  );

  console.log(
    "Razorpay Order ID:",
    payment.razorpay_order_id,
  );

  console.log(
    "Attempt ID:",
    payment.attempt_id,
  );

  console.log(
    "Attempt Status:",
    payment.attempt_status,
  );

  console.log(
    "Razorpay Payment ID:",
    payment.provider_reference,
  );

  if (
    typeof payment.provider_reference === "string" &&
    payment.provider_reference.startsWith("pay_")
  ) {
    console.log(
      "\n✅ REAL RAZORPAY PAYMENT ID FOUND",
    );
  } else {
    console.log(
      "\n❌ provider_reference does not contain a Razorpay Payment ID",
    );
  }
}

await pool.end();