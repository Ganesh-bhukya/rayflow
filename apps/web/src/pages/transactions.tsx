import { useEffect, useMemo, useState } from "react";

type Transaction = {
  id: string;
  orderId: string | null;
  attemptId: string | null;

  amount: number;
  currency: string;
  type: string;
  status: string;
  createdAt: string;

  paymentOrderId: string | null;
  orderStatus: string | null;
  idempotencyKey: string | null;

  merchantId: string | null;
  merchantName: string | null;
  merchantCode: string | null;

  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;

  paymentMethod: string | null;
  attemptStatus: string | null;
  providerReference: string | null;
  failureCode: string | null;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type ApiResponse = {
  status: string;
  transactions: Transaction[];
  pagination: Pagination;
  filters: {
    status: string | null;
    type: string | null;
    search: string | null;
  };
};

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const [page, setPage] = useState(1);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);

  /*
   * ----------------------------------------------------
   * FETCH TRANSACTIONS
   * ----------------------------------------------------
   */

  async function loadTransactions(
    requestedPage = page,
    showRefresh = false
  ) {
    try {
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      const params = new URLSearchParams();

      params.set("page", String(requestedPage));
      params.set("limit", "10");

      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }

      if (typeFilter !== "all") {
        params.set("type", typeFilter);
      }

      if (search.trim()) {
        params.set("search", search.trim());
      }

      const response = await fetch(
        `http://localhost:4000/transactions?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }

      const data: ApiResponse = await response.json();

      setTransactions(data.transactions ?? []);

      setPagination(
        data.pagination ?? {
          page: requestedPage,
          limit: 10,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: requestedPage > 1,
        }
      );

      setPage(requestedPage);
    } catch (err) {
      console.error("Transaction loading error:", err);

      setError("Unable to load transactions.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  /*
   * ----------------------------------------------------
   * INITIAL LOAD
   * ----------------------------------------------------
   */

  useEffect(() => {
    loadTransactions(1);
  }, []);

  /*
   * ----------------------------------------------------
   * RELOAD WHEN FILTERS CHANGE
   * ----------------------------------------------------
   */

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTransactions(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [search, statusFilter, typeFilter]);

  /*
   * ----------------------------------------------------
   * STATISTICS
   * ----------------------------------------------------
   */

  const successfulTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const status = transaction.status.toLowerCase();

      return (
        status === "success" ||
        status === "successful" ||
        status === "succeeded"
      );
    }).length;
  }, [transactions]);

  const failedTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const status = transaction.status.toLowerCase();

      return (
        status === "failed" ||
        status === "failure"
      );
    }).length;
  }, [transactions]);

  const processingTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const status = transaction.status.toLowerCase();

      return (
        status === "processing" ||
        status === "pending" ||
        status === "created"
      );
    }).length;
  }, [transactions]);

  const totalVolume = useMemo(() => {
    return transactions.reduce(
      (total, transaction) =>
        total + Number(transaction.amount || 0),
      0
    );
  }, [transactions]);

  /*
   * ----------------------------------------------------
   * HELPERS
   * ----------------------------------------------------
   */

  const formatAmount = (
    amount: number,
    currency: string
  ) => {
    return `${currency} ${(
      amount / 100
    ).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatDate = (date: string) => {
    if (!date) return "—";

    return new Date(date).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const shortId = (id: string | null) => {
    if (!id) return "—";

    return `${id.slice(0, 8)}...`;
  };

  const getStatusClass = (status: string) => {
    const normalized = status.toLowerCase();

    if (
      normalized === "success" ||
      normalized === "successful" ||
      normalized === "succeeded"
    ) {
      return "status-success";
    }

    if (
      normalized === "failed" ||
      normalized === "failure"
    ) {
      return "status-failed";
    }

    if (
      normalized === "pending" ||
      normalized === "created" ||
      normalized === "processing"
    ) {
      return "status-pending";
    }

    return "status-default";
  };

  const getStatusLabel = (status: string) => {
    if (!status) return "Unknown";

    return (
      status.charAt(0).toUpperCase() +
      status.slice(1)
    );
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
    setPage(1);
  };

  /*
   * ----------------------------------------------------
   * LOADING
   * ----------------------------------------------------
   */

  if (loading) {
    return (
      <div className="page-placeholder">
        <h2>Loading transactions...</h2>

        <p>
          Fetching transaction activity from
          RayFlow API.
        </p>
      </div>
    );
  }

  /*
   * ----------------------------------------------------
   * ERROR
   * ----------------------------------------------------
   */

  if (error) {
    return (
      <div className="page-placeholder">
        <h2>Unable to load transactions</h2>

        <p>{error}</p>

        <button
          className="primary-button"
          onClick={() => loadTransactions(1)}
        >
          Try Again
        </button>
      </div>
    );
  }

  /*
   * ----------------------------------------------------
   * PAGE
   * ----------------------------------------------------
   */

  return (
    <div className="transactions-page">

      {/* HEADER */}

      <div className="page-header">
        <div>
          <div className="eyebrow">
            OPERATIONS
          </div>

          <h1>Transactions</h1>

          <p>
            Monitor and investigate payment
            transaction activity.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={() =>
            loadTransactions(page, true)
          }
          disabled={refreshing}
        >
          {refreshing
            ? "Refreshing..."
            : "↻ Refresh"}
        </button>
      </div>

      {/* KPI CARDS */}

      <div className="transaction-stats">

        <div className="transaction-stat-card">
          <span>Total Transactions</span>

          <strong>
            {pagination.total}
          </strong>

          <small>
            All recorded transactions
          </small>
        </div>

        <div className="transaction-stat-card success-card">
          <span>Successful</span>

          <strong>
            {successfulTransactions}
          </strong>

          <small>
            On current page
          </small>
        </div>

        <div className="transaction-stat-card processing-card">
          <span>Processing</span>

          <strong>
            {processingTransactions}
          </strong>

          <small>
            Awaiting completion
          </small>
        </div>

        <div className="transaction-stat-card failed-card">
          <span>Failed</span>

          <strong>
            {failedTransactions}
          </strong>

          <small>
            Requires attention
          </small>
        </div>

        <div className="transaction-stat-card volume-card">
          <span>Page Volume</span>

          <strong>
            ₹{(
              totalVolume / 100
            ).toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </strong>

          <small>
            Current page
          </small>
        </div>

      </div>

      {/* TOOLBAR */}

      <div className="transaction-toolbar">

        <div className="transaction-search">
          <span>⌕</span>

          <input
            type="text"
            placeholder="Search transaction, payment, customer or merchant..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value)
          }
        >
          <option value="all">
            All statuses
          </option>

          <option value="success">
            Success
          </option>

          <option value="processing">
            Processing
          </option>

          <option value="pending">
            Pending
          </option>

          <option value="created">
            Created
          </option>

          <option value="failed">
            Failed
          </option>
        </select>

        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value)
          }
        >
          <option value="all">
            All types
          </option>

          <option value="payment">
            Payment
          </option>

          <option value="refund">
            Refund
          </option>
        </select>

        {(search ||
          statusFilter !== "all" ||
          typeFilter !== "all") && (
          <button
            className="clear-filter-button"
            onClick={clearFilters}
          >
            Clear
          </button>
        )}

      </div>

      {/* SECTION HEADER */}

      <div className="transaction-section-header">

        <div>
          <h2>
            Transaction Activity
          </h2>

          <p>
            Showing{" "}
            <strong>
              {transactions.length}
            </strong>{" "}
            of{" "}
            <strong>
              {pagination.total}
            </strong>{" "}
            transactions
          </p>
        </div>

      </div>

      {/* TABLE */}

      <div className="payments-table-container">

        {transactions.length === 0 ? (

          <div className="empty-state">

            <div className="empty-icon">
              ⌕
            </div>

            <h3>
              No transactions found
            </h3>

            <p>
              Try changing your search or
              filter settings.
            </p>

            <button
              className="secondary-button"
              onClick={clearFilters}
            >
              Clear filters
            </button>

          </div>

        ) : (

          <table className="payments-table">

            <thead>
              <tr>
                <th>TRANSACTION</th>
                <th>PAYMENT</th>
                <th>CUSTOMER</th>
                <th>MERCHANT</th>
                <th>AMOUNT</th>
                <th>METHOD</th>
                <th>STATUS</th>
                <th>DATE</th>
                <th></th>
              </tr>
            </thead>

            <tbody>

              {transactions.map(
                (transaction) => (

                  <tr
                    key={transaction.id}
                    className="transaction-row"
                    onClick={() =>
                      setSelectedTransaction(
                        transaction
                      )
                    }
                  >

                    <td>
                      <div className="transaction-id-cell">

                        <strong>
                          {shortId(
                            transaction.id
                          )}
                        </strong>

                        <small>
                          Transaction ID
                        </small>

                      </div>
                    </td>

                    <td>
                      <div className="transaction-id-cell">

                        <strong>
                          {shortId(
                            transaction.paymentOrderId
                          )}
                        </strong>

                        <small>
                          Payment order
                        </small>

                      </div>
                    </td>

                    <td>
                      <div className="table-person">

                        <strong>
                          {transaction.customerName ||
                            "Unknown customer"}
                        </strong>

                        {transaction.customerEmail && (
                          <small>
                            {
                              transaction.customerEmail
                            }
                          </small>
                        )}

                      </div>
                    </td>

                    <td>
                      <strong className="merchant-name">
                        {transaction.merchantName ||
                          "Unknown merchant"}
                      </strong>
                    </td>

                    <td>
                      <strong className="amount-cell">
                        {formatAmount(
                          transaction.amount,
                          transaction.currency
                        )}
                      </strong>
                    </td>

                    <td>
                      <span className="method-badge">
                        {transaction.paymentMethod ||
                          "—"}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`status ${getStatusClass(
                          transaction.status
                        )}`}
                      >
                        <span className="status-dot">
                          •
                        </span>

                        {getStatusLabel(
                          transaction.status
                        )}
                      </span>
                    </td>

                    <td>
                      <span className="date-cell">
                        {formatDate(
                          transaction.createdAt
                        )}
                      </span>
                    </td>

                    <td>
                      <button
                        className="table-view-button"
                        onClick={(event) => {
                          event.stopPropagation();

                          setSelectedTransaction(
                            transaction
                          );
                        }}
                      >
                        View
                      </button>
                    </td>

                  </tr>

                )
              )}

            </tbody>

          </table>

        )}

      </div>

      {/* PAGINATION */}

      {pagination.totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "20px",
            padding: "16px 0",
          }}
        >

          <span>
            Page{" "}
            <strong>
              {pagination.page}
            </strong>{" "}
            of{" "}
            <strong>
              {pagination.totalPages}
            </strong>
          </span>

          <div
            style={{
              display: "flex",
              gap: "8px",
            }}
          >

            <button
              className="secondary-button"
              disabled={
                !pagination.hasPreviousPage
              }
              onClick={() =>
                loadTransactions(page - 1)
              }
            >
              ← Previous
            </button>

            <button
              className="secondary-button"
              disabled={
                !pagination.hasNextPage
              }
              onClick={() =>
                loadTransactions(page + 1)
              }
            >
              Next →
            </button>

          </div>

        </div>
      )}

      {/* TRANSACTION DETAILS */}

      {selectedTransaction && (

        <div
          className="modal-overlay"
          onClick={() =>
            setSelectedTransaction(null)
          }
        >

          <div
            className="transaction-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            {/* MODAL HEADER */}

            <div className="modal-header">

              <div>

                <div className="eyebrow">
                  TRANSACTION DETAILS
                </div>

                <h2>
                  Payment Transaction
                </h2>

                <div className="modal-id">
                  {selectedTransaction.id}
                </div>

              </div>

              <button
                className="modal-close"
                onClick={() =>
                  setSelectedTransaction(null)
                }
              >
                ×
              </button>

            </div>

            {/* STATUS */}

            <div className="transaction-status-banner">

              <div>

                <span className="detail-label">
                  Transaction status
                </span>

                <div>

                  <span
                    className={`status ${getStatusClass(
                      selectedTransaction.status
                    )}`}
                  >

                    <span className="status-dot">
                      •
                    </span>

                    {getStatusLabel(
                      selectedTransaction.status
                    )}

                  </span>

                </div>

              </div>

              <div className="detail-amount">

                <span className="detail-label">
                  Amount
                </span>

                <strong>
                  {formatAmount(
                    selectedTransaction.amount,
                    selectedTransaction.currency
                  )}
                </strong>

              </div>

            </div>

            {/* TRANSACTION */}

            <div className="detail-section">

              <div className="detail-section-title">
                Transaction
              </div>

              <div className="transaction-detail-grid">

                <div className="detail-item">
                  <span>
                    Transaction ID
                  </span>

                  <strong>
                    {selectedTransaction.id}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>
                    Payment Order
                  </span>

                  <strong>
                    {selectedTransaction.paymentOrderId ||
                      "—"}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>
                    Transaction Type
                  </span>

                  <strong>
                    {selectedTransaction.type}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>
                    Currency
                  </span>

                  <strong>
                    {selectedTransaction.currency}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>
                    Payment Method
                  </span>

                  <strong>
                    {selectedTransaction.paymentMethod ||
                      "—"}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>
                    Created At
                  </span>

                  <strong>
                    {formatDate(
                      selectedTransaction.createdAt
                    )}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>
                    Attempt Status
                  </span>

                  <strong>
                    {selectedTransaction.attemptStatus ||
                      "—"}
                  </strong>
                </div>

                <div className="detail-item">
                  <span>
                    Order Status
                  </span>

                  <strong>
                    {selectedTransaction.orderStatus ||
                      "—"}
                  </strong>
                </div>

              </div>

            </div>

            {/* CUSTOMER */}

            <div className="detail-section">

              <div className="detail-section-title">
                Customer
              </div>

              <div className="customer-detail-card">

                <div className="customer-avatar">

                  {(
                    selectedTransaction.customerName ||
                    "C"
                  )
                    .charAt(0)
                    .toUpperCase()}

                </div>

                <div>

                  <strong>
                    {selectedTransaction.customerName ||
                      "Unknown customer"}
                  </strong>

                  <span>
                    {selectedTransaction.customerEmail ||
                      "No email available"}
                  </span>

                  {selectedTransaction.customerPhone && (
                    <span>
                      {selectedTransaction.customerPhone}
                    </span>
                  )}

                </div>

              </div>

            </div>

            {/* MERCHANT */}

            <div className="detail-section">

              <div className="detail-section-title">
                Merchant
              </div>

              <div className="merchant-detail-card">

                <div className="merchant-icon">
                  M
                </div>

                <div>

                  <strong>
                    {selectedTransaction.merchantName ||
                      "Unknown merchant"}
                  </strong>

                  <span>
                    {selectedTransaction.merchantCode ||
                      "Merchant account"}
                  </span>

                </div>

              </div>

            </div>

            {/* PROVIDER */}

            {selectedTransaction.providerReference && (
              <div className="detail-section">

                <div className="detail-section-title">
                  Provider
                </div>

                <div className="detail-item">

                  <span>
                    Provider Reference
                  </span>

                  <strong>
                    {
                      selectedTransaction.providerReference
                    }
                  </strong>

                </div>

              </div>
            )}

            {/* FAILURE */}

            {(selectedTransaction.failureCode ||
              selectedTransaction.status.toLowerCase() ===
                "failed") && (

              <div className="detail-section failure-section">

                <div className="detail-section-title">
                  Failure Information
                </div>

                <div className="failure-detail">

                  <span>
                    Failure code
                  </span>

                  <strong>
                    {selectedTransaction.failureCode ||
                      "Not provided"}
                  </strong>

                </div>

              </div>
            )}

            {/* TIMELINE */}

            <div className="detail-section">

              <div className="detail-section-title">
                Processing Timeline
              </div>

              <div className="transaction-timeline">

                <div className="timeline-item">

                  <div className="timeline-marker">
                    ✓
                  </div>

                  <div>

                    <strong>
                      Transaction created
                    </strong>

                    <span>
                      {formatDate(
                        selectedTransaction.createdAt
                      )}
                    </span>

                  </div>

                </div>

                <div className="timeline-item">

                  <div className="timeline-marker">
                    ✓
                  </div>

                  <div>

                    <strong>
                      Payment attempt recorded
                    </strong>

                    <span>
                      Method:{" "}
                      {selectedTransaction.paymentMethod ||
                        "Unknown"}
                    </span>

                  </div>

                </div>

                <div className="timeline-item">

                  <div className="timeline-marker">
                    {selectedTransaction.status.toLowerCase() ===
                    "failed"
                      ? "!"
                      : "✓"}
                  </div>

                  <div>

                    <strong>
                      Transaction{" "}
                      {getStatusLabel(
                        selectedTransaction.status
                      ).toLowerCase()}
                    </strong>

                    <span>
                      Current transaction state
                    </span>

                  </div>

                </div>

              </div>

            </div>

            {/* FOOTER */}

            <div className="modal-footer">

              <button
                className="secondary-button"
                onClick={() =>
                  setSelectedTransaction(null)
                }
              >
                Close
              </button>

            </div>

          </div>

        </div>
      )}

    </div>
  );
}