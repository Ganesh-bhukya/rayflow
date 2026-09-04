import { useEffect, useState } from "react";

const API_URL = "http://localhost:4000";

type RecoveryPayment = {
  orderId: string;
  attemptId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  status: string;
  failureCode: string | null;
  createdAt: string;
};

type RecoveryResponse = {
  status: string;

  summary: {
    failedPayments: number;
    successfulPayments: number;
    totalRecoverable: number;
    successfulAmount: number;
    recoveryRate: number;
    totalPayments: number;
  };

  failureReasons: Record<string, number>;

  payments: RecoveryPayment[];
};

function formatMoney(
  amount: number,
  currency = "INR",
) {
  const value = amount / 100;

  if (currency === "INR") {
    return `₹${value.toLocaleString("en-IN")}`;
  }

  return `${currency} ${value.toLocaleString()}`;
}

function formatDate(date: string) {
  return new Date(date).toLocaleString(
    "en-IN",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  );
}

function shortId(id: string) {
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

export default function Recovery() {
  const [data, setData] =
    useState<RecoveryResponse | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [recovering, setRecovering] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const loadRecovery = async (
    showRefresh = false,
  ) => {
    try {
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      const response = await fetch(
        `${API_URL}/recovery`,
      );

      if (!response.ok) {
        throw new Error(
          `API returned ${response.status}`,
        );
      }

      const result =
        (await response.json()) as RecoveryResponse;

      setData(result);
    } catch (err) {
      console.error(err);

      setError(
        "Unable to load recovery data. Make sure the API server is running on port 4000.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadRecovery();
  }, []);

  const recoverPayment = async (
    orderId: string,
  ) => {
    try {
      setRecovering(orderId);
      setMessage("");
      setError("");

      const response = await fetch(
        `${API_URL}/recovery/${orderId}/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.message ||
            "Payment recovery failed.",
        );
      }

      setMessage(
        result.message ||
          "Payment recovery completed successfully.",
      );

      await loadRecovery();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Payment recovery failed.",
      );
    } finally {
      setRecovering(null);
    }
  };

  if (loading) {
    return (
      <div className="recovery-page">
        <div className="recovery-header">
          <div>
            <div className="page-eyebrow">
              PAYMENT RECOVERY
            </div>

            <h1>Recovery</h1>

            <p>
              Identify failed payments and recover
              lost revenue.
            </p>
          </div>
        </div>

        <div className="recovery-loading">
          Loading recovery data...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="recovery-page">
        <div className="recovery-header">
          <div>
            <div className="page-eyebrow">
              PAYMENT RECOVERY
            </div>

            <h1>Recovery</h1>

            <p>
              Identify failed payments and recover
              lost revenue.
            </p>
          </div>
        </div>

        <div className="recovery-alert error-alert">
          <span className="alert-icon">
            !
          </span>

          <div>
            <strong>
              Unable to load recovery
            </strong>

            <p>
              {error ||
                "No recovery data available."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const {
    failedPayments,
    successfulPayments,
    totalRecoverable,
    successfulAmount,
    recoveryRate,
    totalPayments,
  } = data.summary;

  return (
    <div className="recovery-page">
      {/* HEADER */}

      <div className="recovery-header">
        <div>
          <div className="page-eyebrow">
            PAYMENT RECOVERY
          </div>

          <h1>Recovery</h1>

          <p>
            Identify failed payments and recover
            lost revenue.
          </p>
        </div>

        <button
          className="recovery-refresh"
          onClick={() =>
            loadRecovery(true)
          }
          disabled={refreshing}
        >
          {refreshing
            ? "Refreshing..."
            : "↻ Refresh"}
        </button>
      </div>

      {/* SUCCESS */}

      {message && (
        <div className="recovery-alert success-alert">
          <span className="alert-icon">
            ✓
          </span>

          <div>
            <strong>
              Recovery successful
            </strong>

            <p>{message}</p>
          </div>
        </div>
      )}

      {/* ERROR */}

      {error && (
        <div className="recovery-alert error-alert">
          <span className="alert-icon">
            !
          </span>

          <div>
            <strong>
              Something went wrong
            </strong>

            <p>{error}</p>
          </div>
        </div>
      )}

      {/* METRICS */}

      <div className="recovery-metrics">
        <div className="metric-card recovery-metric">
          <div className="metric-label">
            FAILED PAYMENTS
          </div>

          <div className="metric-value">
            {failedPayments}
          </div>

          <div className="metric-description">
            Payments requiring recovery
          </div>
        </div>

        <div className="metric-card recovery-metric">
          <div className="metric-label">
            RECOVERABLE
          </div>

          <div className="metric-value">
            {formatMoney(totalRecoverable)}
          </div>

          <div className="metric-description">
            Revenue currently at risk
          </div>
        </div>

        <div className="metric-card recovery-metric">
          <div className="metric-label">
            RECOVERED
          </div>

          <div className="metric-value">
            {formatMoney(successfulAmount)}
          </div>

          <div className="metric-description">
            Successfully recovered
          </div>
        </div>

        <div className="metric-card recovery-metric">
          <div className="metric-label">
            RECOVERY RATE
          </div>

          <div className="metric-value">
            {recoveryRate}%
          </div>

          <div className="metric-description">
            Successful recovery rate
          </div>
        </div>
      </div>

      {/* OVERVIEW */}

      <div className="recovery-overview">
        <div className="recovery-overview-card">
          <div className="section-title">
            Recovery overview
          </div>

          <div className="overview-grid">
            <div>
              <span>Total payments</span>

              <strong>
                {totalPayments}
              </strong>
            </div>

            <div>
              <span>Failed</span>

              <strong className="text-danger">
                {failedPayments}
              </strong>
            </div>

            <div>
              <span>Successful</span>

              <strong className="text-success">
                {successfulPayments}
              </strong>
            </div>

            <div>
              <span>
                Recoverable amount
              </span>

              <strong>
                {formatMoney(
                  totalRecoverable,
                )}
              </strong>
            </div>
          </div>
        </div>

        {/* FAILURE REASONS */}

        <div className="recovery-overview-card">
          <div className="section-title">
            Failure reasons
          </div>

          {Object.keys(
            data.failureReasons,
          ).length === 0 ? (
            <div className="empty-small">
              No active payment failures.
            </div>
          ) : (
            <div className="failure-reasons">
              {Object.entries(
                data.failureReasons,
              ).map(
                ([reason, count]) => (
                  <div
                    className="failure-reason-row"
                    key={reason}
                  >
                    <div className="failure-reason-name">
                      <span className="failure-dot" />

                      <strong>
                        {reason}
                      </strong>
                    </div>

                    <span className="failure-count">
                      {count}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {/* FAILED PAYMENTS */}

      <div className="recovery-section">
        <div className="section-heading">
          <div>
            <h2>
              Failed payments
            </h2>

            <p>
              Payments that can currently
              be recovered.
            </p>
          </div>

          <span className="payment-count">
            {data.payments.length} payment
            {data.payments.length === 1
              ? ""
              : "s"}
          </span>
        </div>

        {data.payments.length === 0 ? (
          <div className="recovery-empty">
            <div className="empty-icon">
              ✓
            </div>

            <h3>
              No failed payments
            </h3>

            <p>
              All payments are currently
              successful or processing.
            </p>
          </div>
        ) : (
          <div className="recovery-table-wrapper">
            <table className="recovery-table">
              <thead>
                <tr>
                  <th>
                    PAYMENT
                  </th>

                  <th>
                    AMOUNT
                  </th>

                  <th>
                    METHOD
                  </th>

                  <th>
                    FAILURE REASON
                  </th>

                  <th>
                    CREATED
                  </th>

                  <th>
                    ACTION
                  </th>
                </tr>
              </thead>

              <tbody>
                {data.payments.map(
                  (payment) => (
                    <tr
                      key={
                        payment.attemptId
                      }
                    >
                      <td>
                        <div className="payment-id">
                          {shortId(
                            payment.attemptId,
                          )}
                        </div>

                        <div className="order-id">
                          Order{" "}
                          {shortId(
                            payment.orderId,
                          )}
                        </div>
                      </td>

                      <td>
                        <strong>
                          {formatMoney(
                            payment.amount,
                            payment.currency,
                          )}
                        </strong>
                      </td>

                      <td>
                        <span className="method-badge">
                          {payment.paymentMethod}
                        </span>
                      </td>

                      <td>
                        <span className="failure-badge">
                          {payment.failureCode ||
                            "Unknown failure"}
                        </span>
                      </td>

                      <td>
                        <span className="date-text">
                          {formatDate(
                            payment.createdAt,
                          )}
                        </span>
                      </td>

                      <td>
                        <button
                          className="recover-button"
                          onClick={() =>
                            recoverPayment(
                              payment.orderId,
                            )
                          }
                          disabled={
                            recovering ===
                            payment.orderId
                          }
                        >
                          {recovering ===
                          payment.orderId
                            ? "Recovering..."
                            : "Recover Payment"}
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}