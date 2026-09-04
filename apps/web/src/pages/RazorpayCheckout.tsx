import { useState } from "react";

type RazorpayResponse = {
  status: string;
  idempotent?: boolean;
  message?: string;
  payment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    merchantId: string;
    customerId: string;
    razorpayOrderId: string;
    attemptId: string;
    paymentMethod: string;
  };
};

type VerifyResponse = {
  status: string;
  verified: boolean;
  idempotent: boolean;
  paymentId: string;
  orderId: string;
  attemptId: string;
  transactionId: string | null;
 
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: {
    color?: string;
  };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: {
    ondismiss?: () => void;
  };
};

type RazorpayInstance = {
  open: () => void;
};

declare global {
  interface Window {
    Razorpay?: new (
      options: RazorpayOptions
    ) => RazorpayInstance;
  }
}

const API_URL = "http://localhost:4000";

const DEFAULT_MERCHANT_ID =
  "b4e960c2-bf66-41cd-ace6-15a85cfb8ea0";

const DEFAULT_CUSTOMER_ID =
  "be4fd093-50bf-4f05-823e-1e02e51931d1";

const RAZORPAY_KEY_ID =
  import.meta.env.VITE_RAZORPAY_KEY_ID as string;

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const existingScript = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", () =>
        resolve(true)
      );

      existingScript.addEventListener("error", () =>
        resolve(false)
      );

      return;
    }

    const script = document.createElement("script");

    script.src =
      "https://checkout.razorpay.com/v1/checkout.js";

    script.async = true;

    script.onload = () => resolve(true);

    script.onerror = () => resolve(false);

    document.body.appendChild(script);
  });
}

export default function RazorpayCheckout() {
  const [amount, setAmount] = useState("500");

  const [customerName, setCustomerName] =
    useState("Seed Customer");

  const [customerEmail, setCustomerEmail] =
    useState("customer@rayflow.test");

  const [customerPhone, setCustomerPhone] =
    useState("9999999999");

  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState("");

  const [error, setError] = useState("");

  const [paymentResult, setPaymentResult] =
    useState<VerifyResponse | null>(null);

  async function createPayment() {
    setLoading(true);
    setError("");
    setMessage("");
    setPaymentResult(null);

    try {
      /*
       * Razorpay expects the smallest currency unit.
       *
       * ₹500 = 50000 paise
       */
      const rupees = Number(amount);

      if (
        !Number.isFinite(rupees) ||
        rupees <= 0
      ) {
        throw new Error(
          "Enter a valid payment amount."
        );
      }

      const amountInPaise = Math.round(
        rupees * 100
      );

      if (!RAZORPAY_KEY_ID) {
        throw new Error(
          "VITE_RAZORPAY_KEY_ID is missing from apps/web/.env"
        );
      }

      setMessage(
        "Creating secure payment order..."
      );

      const idempotencyKey =
        `rayflow-checkout-${Date.now()}-${crypto.randomUUID()}`;

      const response = await fetch(
        `${API_URL}/payments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            amount: amountInPaise,
            currency: "INR",
            merchantId: DEFAULT_MERCHANT_ID,
            customerId: DEFAULT_CUSTOMER_ID,
            paymentMethod: "card",
          }),
        }
      );

      const data: RazorpayResponse =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.message ||
            "Failed to create RayFlow payment."
        );
      }

      if (
        !data.payment?.razorpayOrderId
      ) {
        throw new Error(
          "Razorpay Order ID was not returned by RayFlow."
        );
      }

      setMessage(
        "Payment order created. Opening Razorpay Checkout..."
      );

      const loaded =
        await loadRazorpayScript();

      if (!loaded || !window.Razorpay) {
        throw new Error(
          "Unable to load Razorpay Checkout."
        );
      }

      const rayflowPaymentId =
        data.payment.id;

      const razorpayOrderId =
        data.payment.razorpayOrderId;

      const checkoutOptions: RazorpayOptions =
        {
          key: RAZORPAY_KEY_ID,

          amount: data.payment.amount,

          currency: data.payment.currency,

          name: "RayFlow",

          description:
            "RayFlow Payment Infrastructure Demo",

          order_id: razorpayOrderId,

          prefill: {
            name: customerName,
            email: customerEmail,
            contact: customerPhone,
          },

          theme: {
            color: "#111827",
          },

          handler: async (razorpayResponse) => {
            await verifyPayment(
              rayflowPaymentId,
              razorpayResponse
            );
          },

          modal: {
            ondismiss: () => {
              setLoading(false);

              setMessage(
                "Checkout closed. Payment remains processing until confirmed."
              );
            },
          },
        };

      const razorpay =
        new window.Razorpay(
          checkoutOptions
        );

      razorpay.open();
    } catch (err) {
      console.error(
        "RayFlow checkout error:",
        err
      );

      setLoading(false);

      setMessage("");

      setError(
        err instanceof Error
          ? err.message
          : "Unable to start payment."
      );
    }
  }

  async function verifyPayment(
    rayflowPaymentId: string,
    razorpayResponse: {
      razorpay_payment_id: string;
      razorpay_order_id: string;
      razorpay_signature: string;
    }
  ) {
    try {
      setMessage(
        "Payment received. Verifying signature securely..."
      );

      setError("");

      const response = await fetch(
        `${API_URL}/payments/razorpay/verify`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            rayflowPaymentId,

            razorpayPaymentId:
              razorpayResponse.razorpay_payment_id,

            razorpayOrderId:
              razorpayResponse.razorpay_order_id,

            razorpaySignature:
              razorpayResponse.razorpay_signature,
          }),
        }
      );

      const data: VerifyResponse =
        await response.json();

      if (!response.ok) {
        throw new Error(
          (data as any)?.error ||
            "Razorpay payment verification failed."
        );
      }

      setPaymentResult(data);

      setLoading(false);

      setMessage(
        data.idempotent
          ? "Payment was already verified."
          : "Payment verified successfully."
      );
    } catch (err) {
      console.error(
        "Razorpay verification error:",
        err
      );

      setLoading(false);

      setMessage("");

      setError(
        err instanceof Error
          ? err.message
          : "Payment verification failed."
      );
    }
  }

  function resetCheckout() {
    setMessage("");
    setError("");
    setPaymentResult(null);
    setLoading(false);
  }

  return (
    <div
      style={{
        maxWidth: "900px",
        margin: "0 auto",
      }}
    >
      {/* HEADER */}

      <div
        style={{
          marginBottom: "28px",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.6,
            marginBottom: "8px",
          }}
        >
          Razorpay Integration
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "30px",
          }}
        >
          Test Payment Checkout
        </h1>

        <p
          style={{
            marginTop: "8px",
            opacity: 0.65,
          }}
        >
          Create a RayFlow payment and complete it
          through Razorpay Test Mode.
        </p>
      </div>

      {/* MAIN GRID */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1fr) minmax(280px, 0.7fr)",
          gap: "20px",
        }}
      >
        {/* PAYMENT FORM */}

        <div
          style={{
            background: "white",
            borderRadius: "16px",
            padding: "28px",
            border: "1px solid #e5e7eb",
            boxShadow:
              "0 8px 30px rgba(0,0,0,0.05)",
          }}
        >
          <h2
            style={{
              marginTop: 0,
              marginBottom: "22px",
            }}
          >
            Payment Details
          </h2>

          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "8px",
            }}
          >
            Amount (INR)
          </label>

          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(event) =>
              setAmount(event.target.value)
            }
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "13px 14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              marginBottom: "18px",
              fontSize: "15px",
            }}
          />

          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "8px",
            }}
          >
            Customer Name
          </label>

          <input
            value={customerName}
            onChange={(event) =>
              setCustomerName(event.target.value)
            }
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "13px 14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              marginBottom: "18px",
              fontSize: "15px",
            }}
          />

          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "8px",
            }}
          >
            Email
          </label>

          <input
            type="email"
            value={customerEmail}
            onChange={(event) =>
              setCustomerEmail(event.target.value)
            }
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "13px 14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              marginBottom: "18px",
              fontSize: "15px",
            }}
          />

          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              marginBottom: "8px",
            }}
          >
            Phone
          </label>

          <input
            value={customerPhone}
            onChange={(event) =>
              setCustomerPhone(event.target.value)
            }
            disabled={loading}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "13px 14px",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              marginBottom: "24px",
              fontSize: "15px",
            }}
          />

          <button
            onClick={createPayment}
            disabled={loading}
            style={{
              width: "100%",
              padding: "15px",
              border: 0,
              borderRadius: "10px",
              background: "#111827",
              color: "white",
              fontSize: "15px",
              fontWeight: 700,
              cursor: loading
                ? "not-allowed"
                : "pointer",
              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading
              ? "Processing..."
              : `Pay ₹${Number(amount || 0).toLocaleString(
                  "en-IN"
                )}`}
          </button>

          {message && (
            <div
              style={{
                marginTop: "18px",
                padding: "13px 14px",
                borderRadius: "10px",
                background: "#f3f4f6",
                fontSize: "13px",
              }}
            >
              {message}
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: "18px",
                padding: "13px 14px",
                borderRadius: "10px",
                background: "#fef2f2",
                color: "#b91c1c",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* FLOW CARD */}

        <div
          style={{
            background: "#111827",
            color: "white",
            borderRadius: "16px",
            padding: "28px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              opacity: 0.65,
            }}
          >
            Secure Payment Flow
          </div>

          <h2
            style={{
              marginTop: "10px",
            }}
          >
            RayFlow → Razorpay
          </h2>

          <div
            style={{
              marginTop: "28px",
              display: "grid",
              gap: "16px",
            }}
          >
            {[
              "Create RayFlow payment",
              "Create Razorpay Test Order",
              "Open Razorpay Checkout",
              "Receive payment response",
              "Verify HMAC signature",
              "Mark payment as paid",
              "Create successful transaction",
            ].map((step, index) => (
              <div
                key={step}
                style={{
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    minWidth: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    background:
                      "rgba(255,255,255,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </div>

                <span
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.5,
                    opacity: 0.9,
                  }}
                >
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SUCCESS */}

      {paymentResult && (
        <div
          style={{
            marginTop: "20px",
            background: "white",
            border: "1px solid #bbf7d0",
            borderRadius: "16px",
            padding: "24px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#15803d",
            }}
          >
            Payment Verified
          </div>

          <h2
            style={{
              marginTop: "8px",
            }}
          >
            ₹{Number(amount).toLocaleString("en-IN")}{" "}
            payment successful
          </h2>

          <div
            style={{
              display: "grid",
              gap: "10px",
              fontSize: "13px",
            }}
          >
            <div>
              <strong>RayFlow Payment ID:</strong>{" "}
              {paymentResult.paymentId}
            </div>

            <div>
              <strong>Razorpay Order ID:</strong>{" "}
              {paymentResult.orderId}
            </div>

            <div>
              <strong>Attempt ID:</strong>{" "}
              {paymentResult.attemptId}
            </div>

            <div>
              <strong>Transaction ID:</strong>{" "}
              {paymentResult.transactionId ||
                "Created during verification"}
            </div>
          </div>

          <button
            onClick={resetCheckout}
            style={{
              marginTop: "20px",
              padding: "11px 18px",
              borderRadius: "9px",
              border: "1px solid #d1d5db",
              background: "white",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Create Another Payment
          </button>
        </div>
      )}
    </div>
  );
}