import { useEffect, useState } from "react";

type DashboardMetrics = {
  users: number;
  merchants: number;
  customers: number;
  transactions: number;
  volumeLast30Days: number;
};

type RecentTransaction = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  customer_name: string | null;
  merchant_name: string | null;
};

type MetricsResponse = {
  status: string;
  metrics: DashboardMetrics;
};

type RecentTransactionsResponse = {
  status: string;
  rows: RecentTransaction[];
};

const API_URL = "http://localhost:4000";

export default function Dashboard() {
  const [metrics, setMetrics] =
    useState<DashboardMetrics | null>(null);

  const [transactions, setTransactions] =
    useState<RecentTransaction[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError("");

      const [
        metricsResponse,
        transactionsResponse,
      ] = await Promise.all([
        fetch(`${API_URL}/dashboard/metrics`),
        fetch(
          `${API_URL}/dashboard/recent-transactions?limit=8`
        ),
      ]);

      if (
        !metricsResponse.ok ||
        !transactionsResponse.ok
      ) {
        throw new Error(
          "Failed to load dashboard data"
        );
      }

      const metricsData: MetricsResponse =
        await metricsResponse.json();

      const transactionsData: RecentTransactionsResponse =
        await transactionsResponse.json();

      setMetrics(metricsData.metrics);

      setTransactions(
        transactionsData.rows ?? []
      );
    } catch (err) {
      console.error(
        "Dashboard API error:",
        err
      );

      setError(
        "Unable to load dashboard data. Make sure the API server is running on port 4000."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const formatAmount = (
    amount: number,
    currency = "INR"
  ) => {
    return `${currency} ${(
      Number(amount) / 100
    ).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatDate = (
    date: string
  ) => {
    return new Date(date).toLocaleString(
      "en-IN",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  };

  const getStatusClass = (
    status: string
  ) => {
    const normalized =
      status.toLowerCase();

    if (
      normalized === "success" ||
      normalized === "succeeded" ||
      normalized === "completed"
    ) {
      return "dashboard-status success";
    }

    if (
      normalized === "failed" ||
      normalized === "failure"
    ) {
      return "dashboard-status failed";
    }

    if (
      normalized === "pending" ||
      normalized === "processing"
    ) {
      return "dashboard-status pending";
    }

    return "dashboard-status created";
  };

  if (loading) {
    return (
      <div className="page-placeholder">
        <div className="loading-spinner"></div>

        <span>
          Loading dashboard...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-placeholder">
        <h2>Dashboard</h2>

        <p>{error}</p>

        <button
          className="primary-button"
          onClick={loadDashboard}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard-page">

      <div className="dashboard-header">

        <div>
          <div className="page-eyebrow">
            RAYFLOW
          </div>

          <h1>
            Payment Operations
          </h1>

          <p>
            Monitor your payment
            infrastructure and transaction
            activity.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadDashboard}
        >
          ? Refresh
        </button>

      </div>

      <div className="dashboard-metrics">

        <div className="dashboard-card">
          <span>
            CUSTOMERS
          </span>

          <strong>
            {metrics?.customers ?? 0}
          </strong>

          <small>
            Registered customers
          </small>
        </div>

        <div className="dashboard-card">
          <span>
            MERCHANTS
          </span>

          <strong>
            {metrics?.merchants ?? 0}
          </strong>

          <small>
            Active merchant accounts
          </small>
        </div>

        <div className="dashboard-card">
          <span>
            TRANSACTIONS
          </span>

          <strong>
            {metrics?.transactions ?? 0}
          </strong>

          <small>
            Total transactions
          </small>
        </div>

        <div className="dashboard-card">
          <span>
            VOLUME · 30 DAYS
          </span>

          <strong>
            {formatAmount(
              metrics?.volumeLast30Days ?? 0
            )}
          </strong>

          <small>
            Processed transaction volume
          </small>
        </div>

      </div>

      <div className="dashboard-grid">

        <section className="dashboard-panel">

          <div className="dashboard-panel-header">

            <div>
              <h2>
                Recent Transactions
              </h2>

              <p>
                Latest payment activity
              </p>
            </div>

            <span className="panel-count">
              {transactions.length}
            </span>

          </div>

          {transactions.length === 0 ? (
            <div className="dashboard-empty">
              No recent transactions.
            </div>
          ) : (
            <div className="dashboard-transactions">

              {transactions.map(
                (transaction) => (
                  <div
                    className="dashboard-transaction"
                    key={transaction.id}
                  >

                    <div className="transaction-main">

                      <strong>
                        {transaction.customer_name ||
                          "Unknown customer"}
                      </strong>

                      <small>
                        {transaction.merchant_name ||
                          "Unknown merchant"}
                      </small>

                    </div>

                    <div className="transaction-amount">

                      <strong>
                        {formatAmount(
                          transaction.amount,
                          transaction.currency
                        )}
                      </strong>

                      <small>
                        {formatDate(
                          transaction.createdAt
                        )}
                      </small>

                    </div>

                    <span
                      className={getStatusClass(
                        transaction.status
                      )}
                    >

                      <span className="dashboard-status-dot"></span>

                      {transaction.status}

                    </span>

                  </div>
                )
              )}

            </div>
          )}

        </section>

        <section className="dashboard-panel">

          <div className="dashboard-panel-header">

            <div>
              <h2>
                System Overview
              </h2>

              <p>
                Current platform footprint
              </p>
            </div>

          </div>

          <div className="dashboard-overview">

            <div className="overview-row">
              <span>
                Platform Users
              </span>

              <strong>
                {metrics?.users ?? 0}
              </strong>
            </div>

            <div className="overview-row">
              <span>
                Customers
              </span>

              <strong>
                {metrics?.customers ?? 0}
              </strong>
            </div>

            <div className="overview-row">
              <span>
                Merchants
              </span>

              <strong>
                {metrics?.merchants ?? 0}
              </strong>
            </div>

            <div className="overview-row">
              <span>
                Transactions
              </span>

              <strong>
                {metrics?.transactions ?? 0}
              </strong>
            </div>

          </div>

          <div className="dashboard-api-status">

            <span className="dashboard-live-dot"></span>

            <div>
              <strong>
                API Operational
              </strong>

              <small>
                Connected to RayFlow backend
              </small>
            </div>

          </div>

        </section>

      </div>

    </div>
  );
}
