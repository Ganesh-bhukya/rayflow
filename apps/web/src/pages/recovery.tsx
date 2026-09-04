import { useEffect, useMemo, useState } from "react";

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

type AuditLog = {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: string | null;
  created_at: string;
};

type AuditResponse = {
  status: string;
  auditLogs: AuditLog[];
};

type RecoveryDecision = {
  orderId: string;
  attemptId: string;
  transactionId?: string;
  action: "RETRY" | "STOP" | "ESCALATE";
  confidence: number;
  automated: boolean;
  reason: string;
  signals: string[];
  failureCode?: string | null;
  previousFailedAttempts?: number;
  previousStatus?: string;
  currentStatus?: string;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  createdAt: string;
};

type RecoveryExecutionResult = {
  orderId: string;
  attemptId: string;
  transactionId?: string;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  previousStatus?: string;
  status?: string;
};

type BannerType =
  | "success"
  | "protected"
  | "review";

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
  if (!id) return "—";

  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function parseAuditDecision(
  audit: AuditLog,
): RecoveryDecision | null {
  if (
    audit.action !== "recovery.decision" &&
    audit.action !== "recovery.completed"
  ) {
    return null;
  }

  if (!audit.metadata) {
    return null;
  }

  try {
    const metadata = JSON.parse(
      audit.metadata,
    ) as Record<string, unknown>;

    const action = String(
      metadata.action ?? "",
    ).toUpperCase();

    if (
      action !== "RETRY" &&
      action !== "STOP" &&
      action !== "ESCALATE"
    ) {
      return null;
    }

    const signals = Array.isArray(
      metadata.signals,
    )
      ? metadata.signals.map(String)
      : [];

    return {
      orderId: String(
        metadata.orderId ??
          audit.entity_id ??
          "",
      ),
      attemptId: String(
        metadata.attemptId ?? "",
      ),
      transactionId:
        metadata.transactionId != null
          ? String(metadata.transactionId)
          : undefined,
      action,
      confidence:
        typeof metadata.confidence ===
        "number"
          ? metadata.confidence
          : 0,
      automated:
        typeof metadata.automated ===
        "boolean"
          ? metadata.automated
          : action === "RETRY",
      reason: String(
        metadata.reason ??
          "No decision reason recorded.",
      ),
      signals,
      failureCode:
        metadata.failureCode != null
          ? String(metadata.failureCode)
          : null,
      previousFailedAttempts:
        typeof metadata.previousFailedAttempts ===
        "number"
          ? metadata.previousFailedAttempts
          : undefined,
      previousStatus:
        metadata.previousStatus != null
          ? String(metadata.previousStatus)
          : undefined,
      currentStatus:
        metadata.currentStatus != null
          ? String(metadata.currentStatus)
          : undefined,
      amount:
        typeof metadata.amount === "number"
          ? metadata.amount
          : undefined,
      currency:
        metadata.currency != null
          ? String(metadata.currency)
          : undefined,
      paymentMethod:
        metadata.paymentMethod != null
          ? String(metadata.paymentMethod)
          : undefined,
      createdAt: audit.created_at,
    };
  } catch (error) {
    console.error(
      "Unable to parse recovery audit log:",
      error,
    );

    return null;
  }
}

function mergeRecoveryDecisions(
  parsedDecisions: RecoveryDecision[],
) {
  const groups = new Map<
    string,
    RecoveryDecision[]
  >();

  for (const decision of parsedDecisions) {
    const key = `${decision.orderId}:${decision.attemptId}`;

    const existing =
      groups.get(key) ?? [];

    existing.push(decision);

    groups.set(key, existing);
  }

  const merged: RecoveryDecision[] = [];

  for (const group of groups.values()) {
    const completed = group.find(
      (decision) =>
        decision.currentStatus ===
        "success",
    );

    const latest = group[0];

    if (completed) {
      merged.push({
        ...latest,
        amount:
          completed.amount ??
          latest.amount,
        currency:
          completed.currency ??
          latest.currency,
        paymentMethod:
          completed.paymentMethod ??
          latest.paymentMethod,
        currentStatus:
          completed.currentStatus,
        previousStatus:
          completed.previousStatus ??
          latest.previousStatus,
        transactionId:
          completed.transactionId ??
          latest.transactionId,
      });
    } else {
      merged.push(latest);
    }
  }

  return merged.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime(),
  );
}

function actionDescription(
  action: RecoveryDecision["action"],
) {
  if (action === "RETRY") {
    return "A bounded automated retry is permitted.";
  }

  if (action === "STOP") {
    return "Automated recovery is blocked for this failure.";
  }

  return "Automated recovery is blocked and requires review.";
}

function outcomeLabel(
  decision: RecoveryDecision,
) {
  if (
    decision.currentStatus === "success"
  ) {
    return "Recovered";
  }

  if (decision.action === "STOP") {
    return "Protected";
  }

  if (decision.action === "ESCALATE") {
    return "Review";
  }

  return "Review";
}

function outcomeClass(
  decision: RecoveryDecision,
) {
  if (
    decision.currentStatus === "success"
  ) {
    return {
      background: "#ecfdf3",
      color: "#087443",
    };
  }

  if (decision.action === "STOP") {
    return {
      background: "#fff7ed",
      color: "#b54708",
    };
  }

  return {
    background: "#eff6ff",
    color: "#175cd3",
  };
}

function getBannerContent(
  bannerType: BannerType,
) {
  if (bannerType === "success") {
    return {
      title: "Payment recovered successfully",
      icon: "✓",
      className: "success-alert",
    };
  }

  if (bannerType === "protected") {
    return {
      title: "Recovery policy applied",
      icon: "🛡",
      className: "protected-alert",
    };
  }

  return {
    title: "Manual review required",
    icon: "!",
    className: "review-alert",
  };
}

export default function Recovery() {
  const [data, setData] =
    useState<RecoveryResponse | null>(
      null,
    );

  const [decisions, setDecisions] =
    useState<RecoveryDecision[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [recovering, setRecovering] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState("");

  const [bannerType, setBannerType] =
    useState<BannerType>("success");

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

      const [
        recoveryResponse,
        auditResponse,
      ] = await Promise.all([
        fetch(`${API_URL}/recovery`),
        fetch(`${API_URL}/audit-logs`),
      ]);

      if (!recoveryResponse.ok) {
        throw new Error(
          `Recovery API returned ${recoveryResponse.status}`,
        );
      }

      if (!auditResponse.ok) {
        throw new Error(
          `Audit API returned ${auditResponse.status}`,
        );
      }

      const result =
        (await recoveryResponse.json()) as RecoveryResponse;

      const auditResult =
        (await auditResponse.json()) as AuditResponse;

      setData(result);

      const parsedDecisions =
        auditResult.auditLogs
          .map(parseAuditDecision)
          .filter(
            (
              decision,
            ): decision is RecoveryDecision =>
              decision !== null,
          );

      const mergedDecisions =
        mergeRecoveryDecisions(
          parsedDecisions,
        );

      setDecisions(
        mergedDecisions.slice(0, 8),
      );
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
        (await response.json()) as {
          message?: string;
          recovered?: boolean;
          decision?: RecoveryDecision;
          recovery?: RecoveryExecutionResult;
        };

      if (!response.ok) {
        throw new Error(
          result.message ||
            "Payment recovery failed.",
        );
      }

      if (result.recovered) {
        setBannerType("success");

        setMessage(
          "Payment recovery completed successfully.",
        );
      } else if (
        result.decision?.action ===
        "STOP"
      ) {
        setBannerType("protected");

        setMessage(
          "Automated recovery was blocked for this failure.",
        );
      } else {
        setBannerType("review");

        setMessage(
          result.message ||
            "Automated recovery was not executed and requires review.",
        );
      }

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

  const latestDecision =
    decisions.length > 0
      ? decisions[0]
      : null;

  const decisionStats = useMemo(() => {
    return {
      retry: decisions.filter(
        (decision) =>
          decision.action === "RETRY",
      ).length,

      stop: decisions.filter(
        (decision) =>
          decision.action === "STOP",
      ).length,

      escalate: decisions.filter(
        (decision) =>
          decision.action === "ESCALATE",
      ).length,
    };
  }, [decisions]);

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
              Identify failed payments and
              recover lost revenue.
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
              Identify failed payments and
              recover lost revenue.
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

  const banner =
    getBannerContent(bannerType);
  

  return (
    <div className="recovery-page">
      {/* HEADER */}
      <div className="recovery-header">
        <div>
          <div className="page-eyebrow">
            AI REVENUE RECOVERY
          </div>

          <h1>Recovery</h1>

          <p>
            Detect revenue at risk, determine
            the safest recovery action, and
            execute bounded recovery workflows.
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

      {/* SUCCESS / PROTECTED / REVIEW BANNER */}
      {message && (
        <div
          className={`recovery-alert ${banner.className}`}
        >
          <span className="alert-icon">
            {banner.icon}
          </span>

          <div>
            <strong>
              {banner.title}
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
            REVENUE AT RISK
          </div>

          <div className="metric-value">
            {formatMoney(
              totalRecoverable,
            )}
          </div>

          <div className="metric-description">
            Revenue currently recoverable
          </div>
        </div>

        <div className="metric-card recovery-metric">
          <div className="metric-label">
            RECOVERED REVENUE
          </div>

          <div className="metric-value">
            {formatMoney(
              successfulAmount,
            )}
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

      {/* AI DECISION ENGINE */}
      <div
        style={{
          marginBottom: "18px",
          border: "1px solid #d9d6ff",
          borderRadius: "14px",
          background:
            "linear-gradient(135deg, #faf9ff 0%, #f4f6ff 100%)",
          padding: "18px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems: "center",
            gap: "16px",
            marginBottom: "14px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing:
                  "0.08em",
                color: "#635bff",
              }}
            >
              AI DECISION ENGINE
            </div>

            <h2
              style={{
                margin:
                  "5px 0 3px",
                fontSize: "18px",
              }}
            >
              Recovery intelligence
            </h2>

            <p
              style={{
                margin: 0,
                fontSize: "12px",
                color: "#667085",
              }}
            >
              Decision engine → bounded
              policy → payment state machine
              → audit trail
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                padding:
                  "6px 9px",
                borderRadius: "999px",
                background: "#ecfdf3",
                color: "#087443",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {decisionStats.retry} RETRY
            </span>

            <span
              style={{
                padding:
                  "6px 9px",
                borderRadius: "999px",
                background: "#fff7ed",
                color: "#b54708",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {decisionStats.stop} STOP
            </span>

            <span
              style={{
                padding:
                  "6px 9px",
                borderRadius: "999px",
                background: "#eff6ff",
                color: "#175cd3",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {decisionStats.escalate} REVIEW
            </span>
          </div>
        </div>

        {!latestDecision ? (
          <div
            style={{
              padding: "18px",
              borderRadius: "10px",
              background:
                "rgba(255,255,255,0.75)",
              color: "#667085",
              fontSize: "13px",
            }}
          >
            No AI recovery decisions
            recorded yet.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0, 1.7fr) repeat(4, minmax(100px, 0.65fr))",
              gap: "10px",
            }}
          >
            <div
              style={{
                padding: "16px",
                borderRadius: "10px",
                background:
                  "rgba(255,255,255,0.72)",
                border:
                  "1px solid rgba(255,255,255,0.9)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius:
                      "8px",
                    display: "inline-flex",
                    alignItems:
                      "center",
                    justifyContent:
                      "center",
                    background:
                      latestDecision.action ===
                      "RETRY"
                        ? "#ecfdf3"
                        : latestDecision.action ===
                            "STOP"
                          ? "#fff7ed"
                          : "#eff6ff",
                    color:
                      latestDecision.action ===
                      "RETRY"
                        ? "#087443"
                        : latestDecision.action ===
                            "STOP"
                          ? "#b54708"
                          : "#175cd3",
                    fontWeight: 900,
                    fontSize: "13px",
                  }}
                >
                  {latestDecision.action ===
                  "RETRY"
                    ? "↻"
                    : latestDecision.action ===
                        "STOP"
                      ? "!"
                      : "→"}
                </span>

                <div>
                  <div
                    style={{
                      fontSize:
                        "15px",
                      fontWeight: 800,
                    }}
                  >
                    AI recommends{" "}
                    {
                      latestDecision.action
                    }
                  </div>

                  <div
                    style={{
                      fontSize:
                        "10px",
                      color: "#667085",
                      marginTop: "2px",
                    }}
                  >
                    {latestDecision.failureCode ||
                      "Unknown failure"}{" "}
                    •{" "}
                    {shortId(
                      latestDecision.orderId,
                    )}
                  </div>
                </div>
              </div>

              <p
                style={{
                  margin:
                    "0 0 10px",
                  fontSize: "12px",
                  lineHeight: 1.55,
                  color: "#667085",
                }}
              >
                {
                  latestDecision.reason
                }
              </p>

              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing:
                    "0.05em",
                  color: "#475467",
                  marginBottom:
                    "5px",
                }}
              >
                DECISION SIGNALS
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection:
                    "column",
                  gap: "3px",
                }}
              >
                {latestDecision.signals
                  .slice(0, 6)
                  .map(
                    (
                      signal,
                      index,
                    ) => (
                      <div
                        key={`${signal}-${index}`}
                        style={{
                          fontSize:
                            "10px",
                          color:
                            "#667085",
                        }}
                      >
                        • {signal}
                      </div>
                    ),
                  )}
              </div>
            </div>

            <div
              style={{
                padding: "14px",
                borderRadius: "10px",
                background:
                  "rgba(255,255,255,0.72)",
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  color: "#667085",
                  letterSpacing:
                    "0.05em",
                }}
              >
                CONFIDENCE
              </div>

              <div
                style={{
                  marginTop: "5px",
                  fontSize: "20px",
                  fontWeight: 800,
                }}
              >
                {Math.round(
                  latestDecision.confidence *
                    100,
                )}
                %
              </div>
            </div>

            <div
              style={{
                padding: "14px",
                borderRadius: "10px",
                background:
                  "rgba(255,255,255,0.72)",
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  color: "#667085",
                  letterSpacing:
                    "0.05em",
                }}
              >
                AUTOMATION
              </div>

              <div
                style={{
                  marginTop: "5px",
                  fontSize: "14px",
                  fontWeight: 800,
                }}
              >
                {latestDecision.automated
                  ? "Allowed"
                  : "Blocked"}
              </div>
            </div>

            <div
              style={{
                padding: "14px",
                borderRadius: "10px",
                background:
                  "rgba(255,255,255,0.72)",
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  color: "#667085",
                  letterSpacing:
                    "0.05em",
                }}
              >
                AMOUNT
              </div>

              <div
                style={{
                  marginTop: "5px",
                  fontSize: "18px",
                  fontWeight: 800,
                }}
              >
                {typeof latestDecision.amount ===
                "number"
                  ? formatMoney(
                      latestDecision.amount,
                      latestDecision.currency ||
                        "INR",
                    )
                  : "—"}
              </div>
            </div>

            <div
              style={{
                padding: "14px",
                borderRadius: "10px",
                background:
                  "rgba(255,255,255,0.72)",
              }}
            >
              <div
                style={{
                  fontSize: "9px",
                  fontWeight: 800,
                  color: "#667085",
                  letterSpacing:
                    "0.05em",
                }}
              >
                OUTCOME
              </div>

              <div
                style={{
                  marginTop: "5px",
                  fontSize: "14px",
                  fontWeight: 800,
                  ...outcomeClass(
                    latestDecision,
                  ),
                  display:
                    "inline-block",
                  padding:
                    "3px 7px",
                  borderRadius:
                    "5px",
                }}
              >
                {outcomeLabel(
                  latestDecision,
                )}
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: "12px",
            fontSize: "10px",
            color: "#667085",
          }}
        >
          {latestDecision
            ? actionDescription(
                latestDecision.action,
              )
            : "Bounded recovery decisions are recorded for every automated recovery attempt."}
        </div>
      </div>

      {/* RECENT AI DECISIONS */}
      {decisions.length > 0 && (
        <div
          style={{
            marginBottom: "18px",
            background: "#ffffff",
            border:
              "1px solid #e4e7ec",
            borderRadius: "14px",
            padding: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              marginBottom:
                "12px",
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "15px",
                }}
              >
                Recent AI decisions
              </h2>

              <p
                style={{
                  margin:
                    "4px 0 0",
                  fontSize: "10px",
                  color: "#98a2b3",
                }}
              >
                Auditable recovery decisions
                and execution outcomes.
              </p>
            </div>

            <span
              style={{
                padding:
                  "5px 8px",
                borderRadius: "999px",
                background: "#f2f4f7",
                color: "#475467",
                fontSize: "10px",
                fontWeight: 700,
              }}
            >
              {decisions.length} decisions
            </span>
          </div>

          <div
            style={{
              overflowX:
                "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse:
                  "collapse",
                fontSize: "11px",
              }}
            >
              <thead>
                <tr>
                  {[
                    "DECISION",
                    "PAYMENT",
                    "CONFIDENCE",
                    "AUTOMATION",
                    "OUTCOME",
                    "CREATED",
                  ].map(
                    (heading) => (
                      <th
                        key={heading}
                        style={{
                          textAlign:
                            "left",
                          padding:
                            "9px 10px",
                          borderBottom:
                            "1px solid #eaecf0",
                          color:
                            "#667085",
                          fontSize:
                            "9px",
                          fontWeight:
                            800,
                        }}
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>

              <tbody>
                {decisions.map(
                  (decision) => (
                    <tr
                      key={`${decision.orderId}:${decision.attemptId}`}
                    >
                      <td
                        style={{
                          padding:
                            "10px",
                          borderBottom:
                            "1px solid #f2f4f7",
                        }}
                      >
                        <div
                          style={{
                            fontWeight:
                              800,
                            color:
                              decision.action ===
                              "RETRY"
                                ? "#087443"
                                : decision.action ===
                                    "STOP"
                                  ? "#b54708"
                                  : "#175cd3",
                          }}
                        >
                          {
                            decision.action
                          }
                        </div>

                        <div
                          style={{
                            color:
                              "#98a2b3",
                            fontSize:
                              "9px",
                          }}
                        >
                          {decision.failureCode ||
                            "UNKNOWN"}
                        </div>
                      </td>

                      <td
                        style={{
                          padding:
                            "10px",
                          borderBottom:
                            "1px solid #f2f4f7",
                        }}
                      >
                        <div>
                          {shortId(
                            decision.attemptId,
                          )}
                        </div>

                        <div
                          style={{
                            color:
                              "#98a2b3",
                            fontSize:
                              "9px",
                          }}
                        >
                          {shortId(
                            decision.orderId,
                          )}
                        </div>
                      </td>

                      <td
                        style={{
                          padding:
                            "10px",
                          borderBottom:
                            "1px solid #f2f4f7",
                          fontWeight:
                            700,
                        }}
                      >
                        {Math.round(
                          decision.confidence *
                            100,
                        )}
                        %
                      </td>

                      <td
                        style={{
                          padding:
                            "10px",
                          borderBottom:
                            "1px solid #f2f4f7",
                        }}
                      >
                        <span
                          style={{
                            padding:
                              "4px 7px",
                            borderRadius:
                              "5px",
                            background:
                              decision.automated
                                ? "#eff6ff"
                                : "#f2f4f7",
                            color:
                              decision.automated
                                ? "#175cd3"
                                : "#475467",
                            fontSize:
                              "9px",
                            fontWeight:
                              700,
                          }}
                        >
                          {decision.automated
                            ? "Allowed"
                            : "Blocked"}
                        </span>
                      </td>

                      <td
                        style={{
                          padding:
                            "10px",
                          borderBottom:
                            "1px solid #f2f4f7",
                        }}
                      >
                        <span
                          style={{
                            padding:
                              "4px 7px",
                            borderRadius:
                              "5px",
                            fontSize:
                              "9px",
                            fontWeight:
                              700,
                            ...outcomeClass(
                              decision,
                            ),
                          }}
                        >
                          {outcomeLabel(
                            decision,
                          )}
                        </span>
                      </td>

                      <td
                        style={{
                          padding:
                            "10px",
                          borderBottom:
                            "1px solid #f2f4f7",
                          color:
                            "#667085",
                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        {formatDate(
                          decision.createdAt,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* RECOVERY OVERVIEW */}
      <div className="recovery-overview">
        <div className="recovery-overview-card">
          <div className="section-title">
            Recovery overview
          </div>

          <div className="overview-grid">
            <div>
              <span>
                Total payments
              </span>

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
              be evaluated for recovery.
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
                          {
                            payment.paymentMethod
                          }
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
                            ? "Analyzing..."
                            : "Analyze & Recover"}
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