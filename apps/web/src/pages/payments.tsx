import { useEffect, useMemo, useState } from "react";
import "./payments.css";

type Payment = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  idempotencyKey: string;
  createdAt: string;

  merchantId?: string | null;
  merchantName: string | null;
  merchantCode?: string | null;

  customerId?: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone?: string | null;

  attemptId?: string | null;
  paymentMethod: string | null;
  attemptStatus: string | null;
  providerReference?: string | null;
  failureCode: string | null;
  attemptCreatedAt?: string | null;

  transactionId: string | null;
  transactionAmount?: number | null;
  transactionCurrency?: string | null;
  transactionType?: string | null;
  transactionStatus: string | null;
  transactionCreatedAt?: string | null;
};

type PaymentAttempt = {
  id: string;
  paymentMethod: string;
  status: string;
  providerReference: string | null;
  failureCode: string | null;
  createdAt: string;
};

type PaymentTransaction = {
  id: string;
  amount: number;
  currency: string;
  type: string;
  status: string;
  createdAt: string;
};

type PaymentRefund = {
  id: string;
  transactionId: string;
  amount: number;
  status: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

type PaymentDetailsResponse = {
  status: string;
  payment: Payment;
  attempts: PaymentAttempt[];
  transactions: PaymentTransaction[];
  refunds: PaymentRefund[];
};

function formatAmount(amount: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function formatDate(date: string) {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string) {
  return `${id.slice(0, 8)}...`;
}

function normalizeStatus(status: string) {
  return status?.toLowerCase().replace(/\s+/g, "_");
}

function StatusBadge({ status }: { status: string }) {
  const normalized = normalizeStatus(status);

  return (
    <span className={`status-badge status-${normalized}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}

function MethodBadge({ method }: { method: string | null }) {
  if (!method) {
    return <span className="muted">—</span>;
  }

  const value = method.toLowerCase();

  return (
    <span className="method-badge">
      {value === "card" ? "▣" : value === "netbanking" ? "⌁" : "◈"}
      <span>{method}</span>
    </span>
  );
}

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");

  const [selectedPayment, setSelectedPayment] =
    useState<PaymentDetailsResponse | null>(null);

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  async function loadPayments() {
    try {
      setError("");
      setRefreshing(true);

      const response = await fetch("http://localhost:4000/payments");

      if (!response.ok) {
        throw new Error("Failed to fetch payments");
      }

      const data = await response.json();

      setPayments(data.payments ?? []);
    } catch (err) {
      console.error(err);
      setError("Unable to load payments.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function openPayment(id: string) {
    try {
      setDetailsLoading(true);
      setDetailsError("");

      const response = await fetch(
        `http://localhost:4000/payments/${id}`
      );

      if (!response.ok) {
        throw new Error("Failed to load payment");
      }

      const data = await response.json();

      setSelectedPayment(data);
    } catch (err) {
      console.error(err);
      setDetailsError("Unable to load payment details.");
    } finally {
      setDetailsLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
  }, []);

  const stats = useMemo(() => {
  const successful = payments.filter((p) => {
    const value = p.status.toLowerCase();

    return (
      value === "success" ||
      value === "succeeded" ||
      value === "paid"
    );
  });

  const failed = payments.filter(
    (p) => p.status.toLowerCase() === "failed"
  );

  const processing = payments.filter((p) => {
    const value = p.status.toLowerCase();

    return value === "processing" || value === "created";
  });

  const totalValue = payments.reduce(
    (sum, payment) => sum + payment.amount,
    0
  );

  return {
    total: payments.length,
    successful: successful.length,
    failed: failed.length,
    processing: processing.length,
    totalValue,
  };
}, [payments]);

const filteredPayments = useMemo(() => {
  const query = search.trim().toLowerCase();

  return payments.filter((payment) => {
    const status = payment.status.toLowerCase();

    const p = payment as any;

    const matchesSearch =
      !query ||
      String(p.id ?? "").toLowerCase().includes(query) ||
      String(p.orderId ?? "").toLowerCase().includes(query) ||
      String(p.customer?.name ?? "").toLowerCase().includes(query) ||
      String(p.customer?.email ?? "").toLowerCase().includes(query) ||
      String(p.method ?? "").toLowerCase().includes(query);

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "success" &&
        (status === "success" ||
          status === "succeeded" ||
          status === "paid")) ||
      (statusFilter === "processing" &&
        (status === "processing" || status === "created")) ||
      (statusFilter === "failed" && status === "failed");

    const matchesMethod =
      methodFilter === "all" ||
      String(p.method ?? "").toLowerCase() ===
        methodFilter.toLowerCase();

    return matchesSearch && matchesStatus && matchesMethod;
  });
}, [payments, search, statusFilter, methodFilter]);
  const methods = useMemo(() => {
    const unique = new Set(
      payments
        .map((payment) => payment.paymentMethod)
        .filter(Boolean)
        .map((method) => method!.toLowerCase())
    );

    return Array.from(unique);
  }, [payments]);

  return (
    <div className="payments-page">
      <div className="payments-header">
        <div>
          <div className="eyebrow">PAYMENTS</div>
          <h1>Payment Management</h1>
          <p>
            Monitor payment orders, attempts and transaction activity.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadPayments}
          disabled={refreshing}
        >
          <span className={refreshing ? "spin" : ""}>↻</span>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">TOTAL PAYMENTS</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-description">All payment orders</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">SUCCESSFUL</div>
          <div className="stat-value success-text">
            {stats.successful}
          </div>
          <div className="stat-description">
            Successfully completed
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">PROCESSING</div>
          <div className="stat-value warning-text">
            {stats.processing}
          </div>
          <div className="stat-description">
            Awaiting completion
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">FAILED</div>
          <div className="stat-value danger-text">
            {stats.failed}
          </div>
          <div className="stat-description">
            Requires attention
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">TOTAL VALUE</div>
          <div className="stat-value">
            {formatAmount(stats.totalValue)}
          </div>
          <div className="stat-description">
            Payment volume
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-wrapper">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payment, customer or merchant..."
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="created">Created</option>
          <option value="processing">Processing</option>
          <option value="success">Success</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
        </select>

        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
        >
          <option value="all">All methods</option>

          {methods.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </div>

      <div className="results-bar">
        <div>
          <strong>{filteredPayments.length}</strong> payments
        </div>

        {(search ||
          statusFilter !== "all" ||
          methodFilter !== "all") && (
          <button
            className="clear-filter"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
              setMethodFilter("all");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="table-card">
        <div className="table-header">
          <div>
            <h2>Payment Orders</h2>
            <span>Latest payment activity</span>
          </div>
        </div>

        {loading ? (
          <div className="loading-state">
            <div className="loader" />
            Loading payments...
          </div>
        ) : filteredPayments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⌕</div>
            <h3>No payments found</h3>
            <p>
              Try changing your search or filter criteria.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PAYMENT</th>
                  <th>CUSTOMER</th>
                  <th>MERCHANT</th>
                  <th>AMOUNT</th>
                  <th>METHOD</th>
                  <th>STATUS</th>
                  <th>DATE</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filteredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <div className="payment-cell">
                        <div className="payment-icon">$</div>
                        <div>
                          <strong>{shortId(payment.id)}</strong>
                          <span>
                            {payment.idempotencyKey}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div className="customer-cell">
                        <strong>
                          {payment.customerName || "Unknown customer"}
                        </strong>

                        <span>
                          {payment.customerEmail || "No email"}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div className="customer-cell">
                        <strong>
                          {payment.merchantName || "Unknown merchant"}
                        </strong>

                        <span>
                          {payment.merchantCode || "Merchant account"}
                        </span>
                      </div>
                    </td>

                    <td>
                      <strong className="amount">
                        {formatAmount(
                          payment.amount,
                          payment.currency
                        )}
                      </strong>
                    </td>

                    <td>
                      <MethodBadge
                        method={payment.paymentMethod}
                      />
                    </td>

                    <td>
                      <StatusBadge status={payment.status} />
                    </td>

                    <td>
                      <span className="date">
                        {formatDate(payment.createdAt)}
                      </span>
                    </td>

                    <td>
                      <button
                        className="view-button"
                        onClick={() =>
                          openPayment(payment.id)
                        }
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedPayment && (
        <div
          className="modal-backdrop"
          onClick={() => setSelectedPayment(null)}
        >
          <div
            className="details-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="details-header">
              <div>
                <div className="eyebrow">
                  PAYMENT DETAILS
                </div>

                <h2>
                  {shortId(selectedPayment.payment.id)}
                </h2>
              </div>

              <button
                className="close-button"
                onClick={() =>
                  setSelectedPayment(null)
                }
              >
                ×
              </button>
            </div>

            {detailsLoading ? (
              <div className="loading-state">
                <div className="loader" />
                Loading details...
              </div>
            ) : detailsError ? (
              <div className="error-banner">
                {detailsError}
              </div>
            ) : (
              <>
                <div className="detail-hero">
                  <div>
                    <span>Payment amount</span>
                    <strong>
                      {formatAmount(
                        selectedPayment.payment.amount,
                        selectedPayment.payment.currency
                      )}
                    </strong>
                  </div>

                  <StatusBadge
                    status={selectedPayment.payment.status}
                  />
                </div>

                <div className="detail-grid">
                  <div>
                    <span>Payment ID</span>
                    <strong>
                      {selectedPayment.payment.id}
                    </strong>
                  </div>

                  <div>
                    <span>Idempotency Key</span>
                    <strong>
                      {selectedPayment.payment.idempotencyKey}
                    </strong>
                  </div>

                  <div>
                    <span>Customer</span>
                    <strong>
                      {selectedPayment.payment.customerName ||
                        "—"}
                    </strong>
                  </div>

                  <div>
                    <span>Email</span>
                    <strong>
                      {selectedPayment.payment.customerEmail ||
                        "—"}
                    </strong>
                  </div>

                  <div>
                    <span>Merchant</span>
                    <strong>
                      {selectedPayment.payment.merchantName ||
                        "—"}
                    </strong>
                  </div>

                  <div>
                    <span>Payment Method</span>
                    <strong>
                      {selectedPayment.payment.paymentMethod ||
                        "—"}
                    </strong>
                  </div>

                  <div>
                    <span>Created</span>
                    <strong>
                      {formatDate(
                        selectedPayment.payment.createdAt
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Provider Reference</span>
                    <strong>
                      {selectedPayment.payment
                        .providerReference || "—"}
                    </strong>
                  </div>
                </div>

                <div className="detail-section">
                  <div className="section-title">
                    Payment Attempts
                  </div>

                  {selectedPayment.attempts.length === 0 ? (
                    <div className="mini-empty">
                      No attempts recorded.
                    </div>
                  ) : (
                    selectedPayment.attempts.map(
                      (attempt) => (
                        <div
                          className="attempt-row"
                          key={attempt.id}
                        >
                          <div>
                            <strong>
                              {attempt.paymentMethod}
                            </strong>
                            <span>
                              {formatDate(
                                attempt.createdAt
                              )}
                            </span>
                          </div>

                          <StatusBadge
                            status={attempt.status}
                          />
                        </div>
                      )
                    )
                  )}
                </div>

                <div className="detail-section">
                  <div className="section-title">
                    Transactions
                  </div>

                  {selectedPayment.transactions.length ===
                  0 ? (
                    <div className="mini-empty">
                      No transactions recorded.
                    </div>
                  ) : (
                    selectedPayment.transactions.map(
                      (transaction) => (
                        <div
                          className="attempt-row"
                          key={transaction.id}
                        >
                          <div>
                            <strong>
                              {transaction.type}
                            </strong>

                            <span>
                              {shortId(transaction.id)} ·{" "}
                              {formatDate(
                                transaction.createdAt
                              )}
                            </span>
                          </div>

                          <div className="transaction-right">
                            <strong>
                              {formatAmount(
                                transaction.amount,
                                transaction.currency
                              )}
                            </strong>

                            <StatusBadge
                              status={transaction.status}
                            />
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>

                <div className="detail-section">
                  <div className="section-title">
                    Refunds
                  </div>

                  {selectedPayment.refunds.length === 0 ? (
                    <div className="mini-empty">
                      No refunds for this payment.
                    </div>
                  ) : (
                    selectedPayment.refunds.map(
                      (refund) => (
                        <div
                          className="attempt-row"
                          key={refund.id}
                        >
                          <div>
                            <strong>Refund</strong>
                            <span>
                              {refund.reason ||
                                "No reason provided"}
                            </span>
                          </div>

                          <div className="transaction-right">
                            <strong>
                              {formatAmount(
                                refund.amount
                              )}
                            </strong>

                            <StatusBadge
                              status={refund.status}
                            />
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}