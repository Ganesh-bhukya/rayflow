import { useEffect, useState } from "react";

type Customer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  paymentCount: number;
  successfulPayments: number;
  failedPayments: number;
  totalVolume: number;
};

type CustomerPayment = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  paymentMethod: string | null;
  attemptStatus: string | null;
  failureCode: string | null;
  attemptCreatedAt: string | null;
};

type CustomersResponse = {
  status: string;
  customers: Customer[];
};

type CustomerDetailsResponse = {
  status: string;
  customer: Customer;
  payments: CustomerPayment[];
};

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerDetailsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadCustomers = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `http://localhost:4000/customers?search=${encodeURIComponent(
          search,
        )}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch customers");
      }

      const data: CustomersResponse =
        await response.json();

      setCustomers(data.customers ?? []);
    } catch (err) {
      console.error("Customers API error:", err);
      setError("Unable to load customers.");
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerDetails = async (
    customerId: string,
  ) => {
    try {
      setDetailsLoading(true);
      setError("");

      const response = await fetch(
        `http://localhost:4000/customers/${customerId}`,
      );

      if (!response.ok) {
        throw new Error(
          "Failed to fetch customer details",
        );
      }

      const data: CustomerDetailsResponse =
        await response.json();

      setSelectedCustomer(data);
    } catch (err) {
      console.error(
        "Customer details API error:",
        err,
      );

      setError(
        "Unable to load customer details.",
      );
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const formatAmount = (
    amount: number,
    currency = "INR",
  ) => {
    return `${currency} ${(
      amount / 100
    ).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const handleSearch = (
    event: React.FormEvent,
  ) => {
    event.preventDefault();
    loadCustomers();
  };

  if (selectedCustomer) {
    return (
      <CustomerDetails
        data={selectedCustomer}
        loading={detailsLoading}
        onBack={() => setSelectedCustomer(null)}
        formatAmount={formatAmount}
      />
    );
  }

  if (loading) {
    return (
      <div className="page-placeholder">
        Loading customers...
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-placeholder">
        <h2>Customers</h2>

        <p>{error}</p>

        <button onClick={loadCustomers}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="customers-page">

      {/* Header */}
      <div className="page-header">

        <div>
          <div className="page-eyebrow">
            Customers
          </div>

          <h1>Customers</h1>

          <p>
            Manage customers and monitor their
            payment activity.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadCustomers}
        >
          ↻ Refresh
        </button>

      </div>

      {/* Search */}
      <div className="customers-toolbar">

        <form
          onSubmit={handleSearch}
          className="customer-search"
        >
          <input
            type="text"
            placeholder="Search by name, email or phone..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />

          <button type="submit">
            Search
          </button>
        </form>

        <span className="page-count">
          {customers.length} customers
        </span>

      </div>

      {/* Customers */}
      <div className="payments-table-container">

        {customers.length === 0 ? (
          <div className="empty-state">

            <h3>
              No customers found
            </h3>

            <p>
              There are no customers matching
              your search.
            </p>

          </div>
        ) : (
          <table className="payments-table">

            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Payments</th>
                <th>Successful</th>
                <th>Failed</th>
                <th>Total Volume</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>

            <tbody>

              {customers.map((customer) => (
                <tr key={customer.id}>

                  <td>
                    <div>
                      <strong>
                        {customer.name ||
                          "Unknown Customer"}
                      </strong>

                      <small>
                        {customer.id.slice(0, 8)}
                        ...
                      </small>
                    </div>
                  </td>

                  <td>
                    <div>
                      {customer.email && (
                        <small>
                          {customer.email}
                        </small>
                      )}

                      {customer.phone && (
                        <small>
                          {customer.phone}
                        </small>
                      )}
                    </div>
                  </td>

                  <td>
                    {customer.paymentCount}
                  </td>

                  <td>
                    <span className="status status-success">
                      {customer.successfulPayments}
                    </span>
                  </td>

                  <td>
                    <span
                      className={
                        customer.failedPayments > 0
                          ? "status status-failed"
                          : "status"
                      }
                    >
                      {customer.failedPayments}
                    </span>
                  </td>

                  <td>
                    {formatAmount(
                      customer.totalVolume,
                    )}
                  </td>

                  <td>
                    {new Date(
                      customer.createdAt,
                    ).toLocaleDateString(
                      "en-IN",
                    )}
                  </td>

                  <td>
                    <button
                      className="customer-view-button"
                      onClick={() =>
                        loadCustomerDetails(
                          customer.id,
                        )
                      }
                    >
                      View
                    </button>
                  </td>

                </tr>
              ))}

            </tbody>

          </table>
        )}

      </div>

    </div>
  );
}


/* =====================================================
   CUSTOMER DETAILS
===================================================== */

function CustomerDetails({
  data,
  onBack,
  formatAmount,
}: {
  data: CustomerDetailsResponse;
  loading: boolean;
  onBack: () => void;
  formatAmount: (
    amount: number,
    currency?: string,
  ) => string;
}) {
  const { customer, payments } = data;

  /*
   * The customer API can return multiple rows for the
   * same payment when that payment has multiple attempts.
   *
   * For the customer profile, we want one row per
   * payment order.
   */
  const uniquePayments = Array.from(
    new Map(
      payments.map((payment) => [
        payment.id,
        payment,
      ]),
    ).values(),
  );

  /*
   * Calculate customer payment count from unique
   * payment orders rather than raw activity rows.
   */
  const totalPayments = uniquePayments.length;

  /*
   * Calculate total payment volume safely.
   *
   * Amounts are stored in paise in the backend,
   * while formatAmount() converts them to the
   * displayed currency amount.
   */
  const totalVolume = uniquePayments.reduce(
    (sum, payment) => {
      const amount = Number(payment.amount);

      if (!Number.isFinite(amount)) {
        return sum;
      }

      return sum + amount;
    },
    0,
  );

  return (
    <div className="customers-page">

      {/* Header */}
      <div className="page-header">

        <div>

          <button
            className="back-button"
            onClick={onBack}
          >
            ← Back to Customers
          </button>

          <div className="page-eyebrow">
            Customer Profile
          </div>

          <h1>
            {customer.name ||
              "Unknown Customer"}
          </h1>

          <p>
            Customer payment history and
            activity.
          </p>

        </div>

      </div>

      {/* Customer information */}
      <div className="dashboard-grid">

        <div className="metric-card">

          <span className="metric-label">
            Email
          </span>

          <strong className="metric-value">
            {customer.email || "—"}
          </strong>

        </div>

        <div className="metric-card">

          <span className="metric-label">
            Phone
          </span>

          <strong className="metric-value">
            {customer.phone || "—"}
          </strong>

        </div>

        <div className="metric-card">

          <span className="metric-label">
            Total Payments
          </span>

          <strong className="metric-value">
            {totalPayments}
          </strong>

        </div>

        <div className="metric-card">

          <span className="metric-label">
            Total Volume
          </span>

          <strong className="metric-value">
            {formatAmount(
              totalVolume,
              uniquePayments[0]?.currency ||
                "INR",
            )}
          </strong>

        </div>

      </div>

      {/* Payment history */}
      <div className="recovery-section">

        <div className="section-header">

          <div>

            <h2>
              Payment History
            </h2>

            <p>
              All payment activity for this
              customer.
            </p>

          </div>

          <span className="page-count">
            {totalPayments} payments
          </span>

        </div>

        <div className="payments-table-container">

          {uniquePayments.length === 0 ? (
            <div className="empty-state">

              <h3>
                No payment history
              </h3>

              <p>
                This customer has no recorded
                payments.
              </p>

            </div>
          ) : (
            <table className="payments-table">

              <thead>

                <tr>
                  <th>Payment ID</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Attempt</th>
                  <th>Failure</th>
                  <th>Date</th>
                </tr>

              </thead>

              <tbody>

                {uniquePayments.map(
                  (payment) => (

                    <tr
                      key={payment.id}
                    >

                      <td>
                        <code>
                          {payment.id.slice(
                            0,
                            8,
                          )}
                          ...
                        </code>
                      </td>

                      <td>
                        {formatAmount(
                          Number(
                            payment.amount,
                          ),
                          payment.currency,
                        )}
                      </td>

                      <td>
                        <span
                          className={`status status-${String(
                            payment.status,
                          ).toLowerCase()}`}
                        >
                          {payment.status}
                        </span>
                      </td>

                      <td>
                        {payment.paymentMethod ||
                          "—"}
                      </td>

                      <td>
                        {payment.attemptStatus ||
                          "—"}
                      </td>

                      <td>
                        {payment.failureCode ||
                          "—"}
                      </td>

                      <td>
                        {new Date(
                          payment.createdAt,
                        ).toLocaleString(
                          "en-IN",
                        )}
                      </td>

                    </tr>

                  ),
                )}

              </tbody>

            </table>
          )}

        </div>

      </div>

    </div>
  );
}