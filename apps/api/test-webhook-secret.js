import "dotenv/config";
import crypto from "crypto";
const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
console.log("Webhook secret loaded:", secret ? "YES" : "NO");
console.log("Webhook secret length:", secret.length);
console.log("Webhook secret SHA256:", crypto.createHash("sha256").update(secret).digest("hex"));
//# sourceMappingURL=test-webhook-secret.js.map