import dotenv from "dotenv";

dotenv.config({
  path: ".env",
  override: true,
});

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

export const razorpayConfig = {
  keyId: requireEnv("RAZORPAY_KEY_ID"),
  keySecret: requireEnv("RAZORPAY_KEY_SECRET"),
  webhookSecret: requireEnv("RAZORPAY_WEBHOOK_SECRET"),
} as const;
console.log(
  "🔐 Razorpay webhook secret loaded:",
  razorpayConfig.webhookSecret.length,
  "characters",
);