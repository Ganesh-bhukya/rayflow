import "dotenv/config";
import { createRayFlowRazorpayOrder, } from "../services/razorpayOrderService.js";
async function main() {
    console.log("Creating Razorpay order through RayFlow Order Service...");
    const order = await createRayFlowRazorpayOrder({
        orderId: "0b818fdf-3df5-4817-b654-b3f3774e2c74",
        amount: 15000,
        currency: "INR",
        merchantId: "b4e960c2-bf66-41cd-ace6-15a85cfb8ea0",
        customerId: "be4fd093-50bf-4f05-823e-1e02e51931d1",
    });
    console.log("");
    console.log("RayFlow Razorpay Order Service test passed.");
    console.log("");
    console.log(`Razorpay Order ID: ${order.id}`);
    console.log(`Amount: ${order.amount}`);
    console.log(`Currency: ${order.currency}`);
    console.log(`Status: ${order.status}`);
    console.log(`Receipt: ${order.receipt}`);
    console.log("");
}
main().catch((error) => {
    console.error("");
    console.error("RayFlow Razorpay Order Service test failed.");
    if (error instanceof Error) {
        console.error(error.message);
    }
    else {
        console.error(error);
    }
    process.exit(1);
});
//# sourceMappingURL=testRazorpayOrderService.js.map