import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
type Refund = {
  id: string;
  transactionId: string;
  amount: number;
  status: string;
  reason: string | null;
  createdAt: string;
  updatedAt?: string;

  orderId?: string | null;
  transactionAmount?: number | null;
  currency?: string | null;
  transactionStatus?: string | null;
  transactionType?: string | null;

  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;

  merchantId?: string | null;
  merchantName?: string | null;
};

type Transaction = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt?: string;
  orderId?: string | null;

  customerName?: string | null;
  merchantName?: string | null;
};

const API_BASE_URL = "http://localhost:4000";

function formatINR(paise: number | null | undefined) {
  const value = Number(paise ?? 0) / 100;

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: string | undefined) {
  if (!date) return "-";

  return new Date(date).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortId(id: string | undefined | null) {
  if (!id) return "-";

  return `${id.slice(0, 8)}...`;
}

function normalizeTransactions(data: any): Transaction[] {
  const rows =
    data?.rows ??
    data?.transactions ??
    data?.data ??
    [];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row: any) => ({
    id: row.id,
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? "INR",
    status: String(row.status ?? "").toLowerCase(),
    createdAt: row.createdAt ?? row.created_at,
    orderId: row.orderId ?? row.order_id ?? null,

    customerName:
      row.customerName ??
      row.customer_name ??
      null,

    merchantName:
      row.merchantName ??
      row.merchant_name ??
      null,
  }));
}

export default function Refunds() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingTransactions, setLoadingTransactions] =
    useState(false);

  const [showCreateForm, setShowCreateForm] =
    useState(false);

  const [selectedTransaction, setSelectedTransaction] =
    useState("");

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState(
    "Customer requested refund",
  );

  const [submitting, setSubmitting] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("all");

  /*
   * Load refunds.
   */
  async function loadRefunds() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `${API_BASE_URL}/refunds`,
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error || "Failed to load refunds",
        );
      }

      setRefunds(data?.refunds ?? []);
    } catch (err: any) {
      console.error("Failed to load refunds:", err);

      setError(
        err?.message ||
          "Unable to load refunds. Make sure the API server is running on port 4000.",
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * Load successful transactions for refund creation.
   */
  async function loadTransactions() {
    try {
      setLoadingTransactions(true);

      const response = await fetch(
        `${API_BASE_URL}/transactions`,
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Failed to load transactions",
        );
      }

      const normalized =
        normalizeTransactions(data);

      const successful = normalized.filter(
        (transaction) =>
          transaction.status === "success",
      );

      setTransactions(successful);
    } catch (err: any) {
      console.error(
        "Failed to load transactions:",
        err,
      );

      setError(
        err?.message ||
          "Unable to load successful transactions.",
      );
    } finally {
      setLoadingTransactions(false);
    }
  }

  /*
   * Initial page load.
   */
  useEffect(() => {
    loadRefunds();
  }, []);

  /*
   * Load transactions when create form opens.
   */
  useEffect(() => {
    if (showCreateForm) {
      loadTransactions();
    }
  }, [showCreateForm]);

  /*
   * Currently selected transaction.
   */
  const selected = useMemo(
    () =>
      transactions.find(
        (transaction) =>
          transaction.id ===
          selectedTransaction,
      ),
    [transactions, selectedTransaction],
  );

  /*
   * Calculate maximum amount user can enter.
   *
   * Transaction amount is stored in paise.
   */
  const selectedTransactionAmount =
    selected?.amount ?? 0;

  /*
   * Already refunded amount for selected transaction.
   */
  const alreadyRefunded = useMemo(() => {
    if (!selectedTransaction) {
      return 0;
    }

    return refunds
      .filter(
        (refund) =>
          refund.transactionId ===
          selectedTransaction &&
          !["failed", "cancelled"].includes(
            String(refund.status).toLowerCase(),
          ),
      )
      .reduce(
        (total, refund) =>
          total + Number(refund.amount ?? 0),
        0,
      );
  }, [refunds, selectedTransaction]);

  const remainingRefundable =
    selectedTransactionAmount -
    alreadyRefunded;

  /*
   * Create refund.
   */
  async function handleCreateRefund(
    event: FormEvent,
  ) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!selectedTransaction) {
      setError("Please select a transaction.");
      return;
    }

    const rupees = Number(amount);

    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError(
        "Please enter a valid refund amount.",
      );
      return;
    }

    /*
     * Convert INR to paise.
     *
     * Example:
     * ₹50.00 -> 5000
     */
    const paise = Math.round(rupees * 100);

    if (paise > remainingRefundable) {
      setError(
        `Refund cannot exceed ${formatINR(
          remainingRefundable,
        )}.`,
      );
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(
        `${API_BASE_URL}/refunds`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            transactionId:
              selectedTransaction,

            amount: paise,

            reason:
              reason.trim() ||
              "Customer requested refund",
          }),
        },
      );

      /*
       * Always try to read JSON.
       */
      let data: any = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      /*
       * Backend returns 201 for success.
       */
      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Failed to create refund",
        );
      }

      /*
       * SUCCESS
       */
      setMessage(
        data?.message ||
          "Refund created successfully.",
      );

      /*
       * Reset form.
       */
      setSelectedTransaction("");
      setAmount("");
      setReason(
        "Customer requested refund",
      );

      /*
       * Close form after successful creation.
       */
      setShowCreateForm(false);

      /*
       * Refresh refund list.
       */
      await loadRefunds();
    } catch (err: any) {
      console.error(
        "Create refund failed:",
        err,
      );

      setError(
        err?.message ||
          "Failed to create refund.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * Filter refunds.
   */
  const filteredRefunds = refunds.filter((refund) => {
  const text =
    `${refund.id} ${refund.transactionId} ${
      refund.reason ?? ""
    } ${refund.customerName ?? ""} ${
      refund.merchantName ?? ""
    }`.toLowerCase();

  const matchesSearch = text.includes(search.toLowerCase());

  const refundStatus = String(refund.status).toLowerCase();

  const matchesStatus =
    statusFilter === "all" ||
    (statusFilter === "pending" && refundStatus === "pending") ||
    (statusFilter === "completed" &&
      (refundStatus === "completed" || refundStatus === "success")) ||
    (statusFilter === "failed" && refundStatus === "failed") ||
    (statusFilter === "cancelled" && refundStatus === "cancelled");

  return matchesSearch && matchesStatus;
});

  /*
   * Summary statistics.
   */
  const totalRefunds = refunds.length;

  const refundVolume = refunds.reduce(
    (sum, refund) =>
      sum + Number(refund.amount ?? 0),
    0,
  );

  const pendingRefunds = refunds.filter(
    (refund) =>
      String(refund.status).toLowerCase() ===
      "pending",
  ).length;

  const completedRefunds = refunds.filter(
    (refund) =>
      ["completed", "success", "succeeded"].includes(
        String(refund.status).toLowerCase(),
      ),
  ).length;

  return (
    <div
      style={{
        padding: "32px",
        maxWidth: "1400px",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "20px",
          marginBottom: "24px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "1.5px",
              color: "#2563eb",
              marginBottom: "8px",
            }}
          >
            REFUNDS
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "32px",
            }}
          >
            Refunds
          </h1>

          <p
            style={{
              marginTop: "8px",
              color: "#64748b",
            }}
          >
            Manage and monitor customer
            refunds.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setError("");
              loadRefunds();
            }}
            style={buttonSecondary}
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={() => {
              setMessage("");
              setError("");
              setShowCreateForm(true);
            }}
            style={buttonPrimary}
          >
            + Create Refund
          </button>
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div style={successBox}>
          <strong>✓ Success</strong>
          <div>{message}</div>
        </div>
      )}

      {error && (
        <div style={errorBox}>
          <strong>✕ Error</strong>
          <div>{error}</div>
        </div>
      )}

      {/* Statistics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(4, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <StatCard
          title="Total Refunds"
          value={String(totalRefunds)}
        />

        <StatCard
          title="Refund Volume"
          value={formatINR(refundVolume)}
        />

        <StatCard
          title="Pending"
          value={String(pendingRefunds)}
        />

        <StatCard
          title="Completed"
          value={String(completedRefunds)}
        />
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <input
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Search refund, transaction..."
          style={inputStyle}
        />

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value)
          }
          style={selectStyle}
        >
          <option value="all">
            All statuses
          </option>
          <option value="pending">
            Pending
          </option>
          <option value="completed">
            Completed
          </option>
          <option value="failed">
            Failed
          </option>
          <option value="cancelled">
            Cancelled
          </option>
        </select>
      </div>

      {/* Refund Table */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div
            style={{
              padding: "50px",
              textAlign: "center",
              color: "#64748b",
            }}
          >
            Loading refunds...
          </div>
        ) : filteredRefunds.length === 0 ? (
          <div
            style={{
              padding: "50px",
              textAlign: "center",
              color: "#64748b",
            }}
          >
            No refunds found.
          </div>
        ) : (
          <div
            style={{
              overflowX: "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse:
                  "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>
                    REFUND ID
                  </th>

                  <th style={thStyle}>
                    TRANSACTION
                  </th>

                  <th style={thStyle}>
                    AMOUNT
                  </th>

                  <th style={thStyle}>
                    STATUS
                  </th>

                  <th style={thStyle}>
                    REASON
                  </th>

                  <th style={thStyle}>
                    CREATED
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredRefunds.map(
                  (refund) => (
                    <tr key={refund.id}>
                      <td style={tdStyle}>
                        <code>
                          {shortId(
                            refund.id,
                          )}
                        </code>
                      </td>

                      <td style={tdStyle}>
                        <code>
                          {shortId(
                            refund.transactionId,
                          )}
                        </code>
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: 600,
                        }}
                      >
                        {formatINR(
                          refund.amount,
                        )}
                      </td>

                      <td style={tdStyle}>
                        <StatusBadge
                          status={
                            refund.status
                          }
                        />
                      </td>

                      <td style={tdStyle}>
                        {refund.reason ||
                          "-"}
                      </td>

                      <td style={tdStyle}>
                        {formatDate(
                          refund.createdAt,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Refund Modal */}
      {showCreateForm && (
        <div style={modalBackdrop}>
          <div style={modal}>
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
                marginBottom: "24px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing:
                      "1.5px",
                    color: "#2563eb",
                    marginBottom: "6px",
                  }}
                >
                  REFUND
                </div>

                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  Create Refund
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowCreateForm(false)
                }
                style={closeButton}
              >
                ×
              </button>
            </div>

            <form
              onSubmit={
                handleCreateRefund
              }
            >
              {/* Transaction */}
              <label style={labelStyle}>
                Successful transaction
              </label>

              <select
                value={
                  selectedTransaction
                }
                onChange={(event) => {
                  setSelectedTransaction(
                    event.target.value,
                  );
                  setAmount("");
                  setError("");
                }}
                style={{
                  ...selectStyle,
                  width: "100%",
                  marginBottom: "20px",
                }}
                disabled={
                  loadingTransactions ||
                  submitting
                }
              >
                <option value="">
                  {loadingTransactions
                    ? "Loading transactions..."
                    : "Select transaction"}
                </option>

                {transactions.map(
                  (transaction) => (
                    <option
                      key={
                        transaction.id
                      }
                      value={
                        transaction.id
                      }
                    >
                      {shortId(
                        transaction.id,
                      )}{" "}
                      —{" "}
                      {formatINR(
                        transaction.amount,
                      )}
                    </option>
                  ),
                )}
              </select>

              {/* Selected transaction info */}
              {selected && (
                <div
                  style={{
                    background:
                      "#f8fafc",
                    border:
                      "1px solid #e2e8f0",
                    borderRadius:
                      "8px",
                    padding: "12px",
                    marginBottom:
                      "20px",
                    fontSize: "13px",
                  }}
                >
                  <div>
                    <strong>
                      Transaction:
                    </strong>{" "}
                    {shortId(
                      selected.id,
                    )}
                  </div>

                  <div>
                    <strong>
                      Transaction amount:
                    </strong>{" "}
                    {formatINR(
                      selected.amount,
                    )}
                  </div>

                  <div>
                    <strong>
                      Already refunded:
                    </strong>{" "}
                    {formatINR(
                      alreadyRefunded,
                    )}
                  </div>

                  <div>
                    <strong>
                      Remaining refundable:
                    </strong>{" "}
                    {formatINR(
                      remainingRefundable,
                    )}
                  </div>
                </div>
              )}

              {/* Amount */}
              <label style={labelStyle}>
                Refund amount
              </label>

              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) =>
                  setAmount(
                    event.target.value,
                  )
                }
                placeholder="0.00"
                style={{
                  ...inputStyle,
                  width: "100%",
                  marginBottom: "6px",
                }}
                disabled={
                  !selected ||
                  submitting
                }
              />

              <div
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  marginBottom: "20px",
                }}
              >
                Enter amount in INR. The
                backend stores the value
                in paise.
              </div>

              {/* Reason */}
              <label style={labelStyle}>
                Reason
              </label>

              <textarea
                value={reason}
                onChange={(event) =>
                  setReason(
                    event.target.value,
                  )
                }
                placeholder="Customer requested refund"
                rows={4}
                style={{
                  ...textareaStyle,
                  width: "100%",
                  marginBottom: "24px",
                }}
                disabled={submitting}
              />

              {/* Buttons */}
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "flex-end",
                  gap: "10px",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setShowCreateForm(
                      false,
                    )
                  }
                  style={
                    buttonSecondary
                  }
                  disabled={submitting}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  style={{
                    ...buttonPrimary,
                    opacity:
                      submitting ||
                      !selected
                        ? 0.6
                        : 1,
                    cursor:
                      submitting ||
                      !selected
                        ? "not-allowed"
                        : "pointer",
                  }}
                  disabled={
                    submitting ||
                    !selected
                  }
                >
                  {submitting
                    ? "Creating..."
                    : "Create Refund"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- */
/* Small Components */
/* ----------------------------- */

function StatCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: "12px",
        padding: "20px",
      }}
    >
      <div
        style={{
          fontSize: "13px",
          color: "#64748b",
          marginBottom: "8px",
        }}
      >
        {title}
      </div>

      <div
        style={{
          fontSize: "24px",
          fontWeight: 700,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: string;
}) {
  const normalized =
    String(status).toLowerCase();

  let background = "#fef3c7";
  let color = "#92400e";

  if (
    ["completed", "success", "succeeded"].includes(
      normalized,
    )
  ) {
    background = "#dcfce7";
    color = "#166534";
  }

  if (
    ["failed", "cancelled"].includes(
      normalized,
    )
  ) {
    background = "#fee2e2";
    color = "#991b1b";
  }

  return (
    <span
      style={{
        display: "inline-flex",
        padding: "4px 9px",
        borderRadius: "999px",
        background,
        color,
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

/* ----------------------------- */
/* Styles */
/* ----------------------------- */

const buttonPrimary: React.CSSProperties = {
  border: "none",
  borderRadius: "8px",
  background: "#2563eb",
  color: "#fff",
  padding: "10px 16px",
  fontWeight: 600,
  cursor: "pointer",
};

const buttonSecondary: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  background: "#fff",
  color: "#334155",
  padding: "10px 16px",
  fontWeight: 600,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "14px",
  background: "#fff",
  boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "14px",
  resize: "vertical",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "#334155",
  marginBottom: "7px",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  fontSize: "11px",
  color: "#64748b",
  letterSpacing: "0.8px",
  borderBottom: "1px solid #e2e8f0",
  background: "#f8fafc",
};

const tdStyle: React.CSSProperties = {
  padding: "15px 16px",
  fontSize: "13px",
  borderBottom: "1px solid #f1f5f9",
  color: "#334155",
};

const successBox: React.CSSProperties = {
  background: "#dcfce7",
  border: "1px solid #86efac",
  color: "#166534",
  borderRadius: "8px",
  padding: "12px 16px",
  marginBottom: "20px",
};

const errorBox: React.CSSProperties = {
  background: "#fee2e2",
  border: "1px solid #fca5a5",
  color: "#991b1b",
  borderRadius: "8px",
  padding: "12px 16px",
  marginBottom: "20px",
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  justifyContent: "flex-end",
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  width: "min(520px, 100vw)",
  height: "100%",
  background: "#fff",
  padding: "32px",
  boxSizing: "border-box",
  overflowY: "auto",
  boxShadow:
    "-10px 0 30px rgba(0, 0, 0, 0.15)",
};

const closeButton: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: "28px",
  cursor: "pointer",
  color: "#64748b",
};