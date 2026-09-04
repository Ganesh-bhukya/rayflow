import "dotenv/config";
function requireEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
const keyId = requireEnv("RAZORPAY_KEY_ID");
const keySecret = requireEnv("RAZORPAY_KEY_SECRET");
const webhookSecret = requireEnv("RAZORPAY_WEBHOOK_SECRET");
console.log("Razorpay configuration loaded successfully.");
console.log(`Key ID: ${keyId.substring(0, 12)}...`);
console.log(`Key Secret: configured (${keySecret.length} characters)`);
console.log(`Webhook Secret: configured (${webhookSecret.length} characters)`);
//# sourceMappingURL=testRazorpayConfig.js.map