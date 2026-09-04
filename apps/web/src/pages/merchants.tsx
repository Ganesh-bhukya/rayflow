import { useEffect, useState } from "react";

type Merchant = {
  id: string;
  business_name: string;
  merchant_code: string;
  is_active: boolean;
  created_at: string;

  payment_count: number;
  successful_payments: number;
  failed_payments: number;
  total_volume: number;
};

type MerchantsResponse = {
  status: string;
  merchants: Merchant[];
};

export default function Merchants() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadMerchants = async () => {
    try {
      setLoading(true);
      setError("");

      const query = search.trim()
        ? `?search=${encodeURIComponent(search.trim())}`
        : "";

      const response = await fetch(
        `http://localhost:4000/merchants${query}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch merchants");
      }

      const data: MerchantsResponse =
        await response.json();

      setMerchants(data.merchants ?? []);
    } catch (err) {
      console.error("Merchants API error:", err);
      setError("Unable to load merchants.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMerchants();
  }, []);

  const formatAmount = (
    amount: number,
    currency = "INR"
  ) => {
    return `${currency} ${(Number(amount) / 100).toLocaleString(
      "en-IN",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    )}`;
  };

  const handleSearch = (
    event: React.FormEvent
  ) => {
    event.preventDefault();
    loadMerchants();
  };

  if (loading) {
    return (
      <div className="page-placeholder">
        Loading merchants...
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-placeholder">
        <h2>Merchants</h2>

        <p>{error}</p>

        <button onClick={loadMerchants}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="merchants-page">

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-eyebrow">
            Merchants
          </div>

          <h1>Merchant Management</h1>

          <p>
            Monitor merchants and their payment activity.
          </p>
        </div>

        <button
          className="refresh-button"
          onClick={loadMerchants}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Search */}
      <div className="merchants-toolbar">
        <form
          className="search-form"
          onSubmit={handleSearch}
        >
          <input
            type="text"
            placeholder="Search by business name or merchant code..."
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
          {merchants.length} merchants
        </span>
      </div>

      {/* Table */}
      <div className="payments-table-container">

        {merchants.length === 0 ? (
          <div className="empty-state">

            <h3>
              No merchants found
            </h3>

            <p>
              There are currently no merchants
              matching your search.
            </p>

          </div>
        ) : (
          <table className="payments-table">

            <thead>
              <tr>
                <th>Merchant</th>
                <th>Merchant Code</th>
                <th>Status</th>
                <th>Payments</th>
                <th>Successful</th>
                <th>Failed</th>
                <th>Total Volume</th>
                <th>Created</th>
              </tr>
            </thead>

            <tbody>

              {merchants.map((merchant) => (
                <tr key={merchant.id}>

                  {/* Merchant */}
                  <td>
                    <div>
                      <strong>
                        {merchant.business_name}
                      </strong>

                      <small>
                        {merchant.id.slice(0, 8)}...
                      </small>
                    </div>
                  </td>

                  {/* Merchant code */}
                  <td>
                    <code>
                      {merchant.merchant_code}
                    </code>
                  </td>

                  {/* Status */}
                  <td>
                    <span
                      className={
                        merchant.is_active
                          ? "status status-success"
                          : "status status-failed"
                      }
                    >
                      {merchant.is_active
                        ? "Active"
                        : "Inactive"}
                    </span>
                  </td>

                  {/* Payment count */}
                  <td>
                    {merchant.payment_count}
                  </td>

                  {/* Successful */}
                  <td>
                    {merchant.successful_payments}
                  </td>

                  {/* Failed */}
                  <td>
                    {merchant.failed_payments}
                  </td>

                  {/* Volume */}
                  <td>
                    {formatAmount(
                      merchant.total_volume
                    )}
                  </td>

                  {/* Created */}
                  <td>
                    {new Date(
                      merchant.created_at
                    ).toLocaleDateString("en-IN")}
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