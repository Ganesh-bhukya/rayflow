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

type IntelligenceDecision = {
  orderId: string;
  attemptId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  failureCode: string | null;
  createdAt: string;
  previousFailedAttempts: number;
  action: "RETRY" | "STOP" | "ESCALATE";
  confidence: number;
  recoveryScore: number;
  recoveryProbability: number;
  expectedRecoveryAmount: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  recoveryStrategy:
    | "IMMEDIATE_RETRY"
    | "STOP_RECOVERY"
    | "MANUAL_REVIEW";
  recoveryPriority:
    | "HIGH"
    | "MEDIUM"
    | "LOW";
  automated: boolean;
  reason: string;
  signals: string[];
};

type IntelligenceResponse = {
  status: string;
  summary: {
    recoveryCases: number;
    revenueAtRisk: number;
    automatedRecoveryOpportunity: number;
    projectedRecoveryOpportunity: number;
    averageRecoveryProbability: number;
    escalationAmount: number;
    stoppedAmount: number;
    recoveredRevenue: number;
    completedRecoveryCases: number;
    recoverySuccessRate: number;
  };
  actionBreakdown: Record<
    "RETRY" | "STOP" | "ESCALATE",
    { cases: number; amount: number }
  >;
  failureReasons: Record<
    string,
    { cases: number; amount: number }
  >;
  currentDecisions: IntelligenceDecision[];
  recentRecoveries: Array<{
    auditId: string;
    orderId: string;
    amount: number;
    currency: string;
    action: "RETRY" | "STOP" | "ESCALATE";
    confidence: number;
    failureCode: string | null;
    createdAt: string;
  }>;
};


type SimulationDecision = {
  orderId: string;
  attemptId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  failureCode: string | null;
  createdAt: string;
  previousFailedAttempts: number;
  action: "RETRY" | "STOP" | "ESCALATE";
  confidence: number;
  automated: boolean;
  reason: string;
  signals: string[];
};

type SimulationResponse = {
  status: string;
  simulation: {
    simulatedAt: string;
    readOnly: boolean;
    executionPerformed: boolean;
  };
  summary: {
    recoveryCases: number;
    revenueAtRisk: number;
    automatedRecoveryOpportunity: number;
    stoppedAmount: number;
    escalationAmount: number;
    projectedRecoveryOpportunity: number;
  };
  actionBreakdown: Record<
    "RETRY" | "STOP" | "ESCALATE",
    { cases: number; amount: number }
  >;
  decisions: SimulationDecision[];
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

  const [intelligence, setIntelligence] =
    useState<IntelligenceResponse | null>(null);

  const [simulation, setSimulation] =
    useState<SimulationResponse | null>(null);

  const [simulating, setSimulating] =
    useState(false);

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
        intelligenceResponse,
      ] = await Promise.all([
        fetch(`${API_URL}/recovery`),
        fetch(`${API_URL}/audit-logs`),
        fetch(`${API_URL}/recovery/intelligence`),
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

      if (!intelligenceResponse.ok) {
        throw new Error(
          `Recovery intelligence API returned ${intelligenceResponse.status}`,
        );
      }

      const result =
        (await recoveryResponse.json()) as RecoveryResponse;

      const auditResult =
        (await auditResponse.json()) as AuditResponse;

      const intelligenceResult =
        (await intelligenceResponse.json()) as IntelligenceResponse;

      setData(result);
      setIntelligence(intelligenceResult);

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

  const simulateRecovery = async () => {
    try {
      setSimulating(true);
      setError("");

      const response = await fetch(
        `${API_URL}/recovery/simulate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      const result =
        (await response.json()) as SimulationResponse & {
          message?: string;
        };

      if (!response.ok) {
        throw new Error(
          result.message ||
            `Recovery simulation API returned ${response.status}`,
        );
      }

      setSimulation(result);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to run recovery simulation.",
      );
    } finally {
      setSimulating(false);
    }
  };

  const latestDecision =
    decisions.length > 0
      ? decisions[0]
      : null;

  const latestIntelligenceDecision =
    latestDecision && intelligence?.currentDecisions?.length
      ? intelligence.currentDecisions.find(
          (decision) =>
            decision.orderId === latestDecision.orderId,
        ) ?? null
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

      {/* RECOVERY INTELLIGENCE CENTER */}
      {intelligence && (
        <div
          style={{
            marginBottom: "18px",
            border: "1px solid #e4e7ec",
            borderRadius: "14px",
            background: "#ffffff",
            padding: "18px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "16px",
              marginBottom: "16px",
            }}
          >
            <div>
              <div style={{ fontSize: "10px", fontWeight: 800, letterSpacing: "0.08em", color: "#635bff" }}>
                RECOVERY INTELLIGENCE CENTER
              </div>
              <h2 style={{ margin: "5px 0 3px", fontSize: "18px" }}>
                Revenue recovery control plane
              </h2>
              <p style={{ margin: 0, fontSize: "12px", color: "#667085" }}>
                Current exposure, bounded AI actions, and measurable recovery outcomes.
              </p>
            </div>
            <span style={{ padding: "6px 9px", borderRadius: "999px", background: "#f2f4f7", color: "#475467", fontSize: "10px", fontWeight: 700, whiteSpace: "nowrap" }}>
              {intelligence.summary.recoveryCases} active case{intelligence.summary.recoveryCases === 1 ? "" : "s"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px", marginBottom: "14px" }}>
            {[
              { label: "REVENUE AT RISK", value: formatMoney(intelligence.summary.revenueAtRisk), description: "Current failed-payment exposure" },
              { label: "AUTO RECOVERY", value: formatMoney(intelligence.summary.automatedRecoveryOpportunity), description: "Eligible for bounded retry" },
              { label: "STOPPED", value: formatMoney(intelligence.summary.stoppedAmount), description: "Protected by recovery policy" },
              { label: "RECOVERY SUCCESS", value: `${intelligence.summary.recoverySuccessRate}%`, description: `${intelligence.summary.completedRecoveryCases} completed case${intelligence.summary.completedRecoveryCases === 1 ? "" : "s"}` },
            ].map((metric) => (
              <div key={metric.label} style={{ padding: "14px", borderRadius: "10px", background: "#f8fafc", border: "1px solid #eef2f6" }}>
                <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.05em", color: "#667085" }}>{metric.label}</div>
                <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 800 }}>{metric.value}</div>
                <div style={{ marginTop: "3px", fontSize: "10px", color: "#98a2b3" }}>{metric.description}</div>
              </div>
            ))}
          </div>

          {latestIntelligenceDecision && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "10px",
                marginBottom: "10px",
              }}
            >
              {[
                {
                  label: "RECOVERY SCORE",
                  value: `${latestIntelligenceDecision.recoveryScore}/100`,
                  description: "Explainable recovery opportunity score",
                },
                {
                  label: "RECOVERY PROBABILITY",
                  value: `${Math.round(latestIntelligenceDecision.recoveryProbability * 100)}%`,
                  description: "Estimated chance of successful recovery",
                },
                {
                  label: "EXPECTED RECOVERY",
                  value: formatMoney(
                    latestIntelligenceDecision.expectedRecoveryAmount,
                    latestIntelligenceDecision.currency,
                  ),
                  description: "Expected value from the recommended path",
                },
                {
                  label: "RISK LEVEL",
                  value: latestIntelligenceDecision.riskLevel,
                  description: `Latest action: ${latestIntelligenceDecision.action}`,
                },
              ].map((metric) => (
                <div
                  key={metric.label}
                  style={{
                    padding: "13px",
                    borderRadius: "10px",
                    background: "#f8fafc",
                    border: "1px solid #eef2f6",
                  }}
                >
                  <div
                    style={{
                      fontSize: "9px",
                      fontWeight: 800,
                      letterSpacing: "0.05em",
                      color: "#667085",
                    }}
                  >
                    {metric.label}
                  </div>
                  <div
                    style={{
                      marginTop: "5px",
                      fontSize: "18px",
                      fontWeight: 800,
                    }}
                  >
                    {metric.value}
                  </div>
                  <div
                    style={{
                      marginTop: "3px",
                      fontSize: "10px",
                      color: "#98a2b3",
                    }}
                  >
                    {metric.description}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "10px" }}>
            <div style={{ padding: "14px", borderRadius: "10px", background: "#fafafa", border: "1px solid #eef2f6" }}>
              <div style={{ fontSize: "10px", fontWeight: 800, color: "#475467", letterSpacing: "0.05em", marginBottom: "9px" }}>AI ACTION BREAKDOWN</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
                {(["RETRY", "STOP", "ESCALATE"] as const).map((action) => {
                  const item = intelligence.actionBreakdown[action];
                  return (
                    <div key={action} style={{ padding: "10px", borderRadius: "8px", background: "#ffffff", border: "1px solid #eef2f6" }}>
                      <div style={{ fontSize: "10px", fontWeight: 800, color: action === "RETRY" ? "#087443" : action === "STOP" ? "#b54708" : "#175cd3" }}>{action === "ESCALATE" ? "REVIEW" : action}</div>
                      <div style={{ marginTop: "4px", fontSize: "16px", fontWeight: 800 }}>{item.cases}</div>
                      <div style={{ marginTop: "2px", fontSize: "9px", color: "#98a2b3" }}>{formatMoney(item.amount)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ padding: "14px", borderRadius: "10px", background: "#fafafa", border: "1px solid #eef2f6" }}>
              <div style={{ fontSize: "10px", fontWeight: 800, color: "#475467", letterSpacing: "0.05em", marginBottom: "9px" }}>FAILURE PATTERNS</div>
              {Object.keys(intelligence.failureReasons).length === 0 ? (
                <div style={{ fontSize: "11px", color: "#98a2b3" }}>No active failure patterns.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                  {Object.entries(intelligence.failureReasons).slice(0, 4).map(([reason, item]) => (
                    <div key={reason} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                      <div>
                        <div style={{ fontSize: "11px", fontWeight: 700 }}>{reason}</div>
                        <div style={{ fontSize: "9px", color: "#98a2b3" }}>{item.cases} case{item.cases === 1 ? "" : "s"}</div>
                      </div>
                      <strong style={{ fontSize: "11px" }}>{formatMoney(item.amount)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "10px",
              marginTop: "10px",
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "10px",
                background: "#fafafa",
                border: "1px solid #eef2f6",
              }}
            >
              <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.05em", color: "#667085" }}>
                PROJECTED RECOVERY
              </div>
              <div style={{ marginTop: "4px", fontSize: "16px", fontWeight: 800 }}>
                {formatMoney(intelligence.summary.projectedRecoveryOpportunity)}
              </div>
              <div style={{ marginTop: "2px", fontSize: "9px", color: "#98a2b3" }}>
                Expected value from eligible automated retries
              </div>
            </div>

            <div
              style={{
                padding: "12px 14px",
                borderRadius: "10px",
                background: "#fafafa",
                border: "1px solid #eef2f6",
              }}
            >
              <div style={{ fontSize: "9px", fontWeight: 800, letterSpacing: "0.05em", color: "#667085" }}>
                AVG RECOVERY PROBABILITY
              </div>
              <div style={{ marginTop: "4px", fontSize: "16px", fontWeight: 800 }}>
                {Math.round(intelligence.summary.averageRecoveryProbability * 100)}%
              </div>
              <div style={{ marginTop: "2px", fontSize: "9px", color: "#98a2b3" }}>
                Across current recovery candidates
              </div>
            </div>
          </div>

          {intelligence.recentRecoveries.length > 0 && (
            <div style={{ marginTop: "10px", padding: "12px 14px", borderRadius: "10px", background: "#ecfdf3", border: "1px solid #d1fadf" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 800, color: "#087443", letterSpacing: "0.05em" }}>RECENT RECOVERY OUTCOME</div>
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "#344054" }}>
                    {intelligence.recentRecoveries.length} completed recovery case{intelligence.recentRecoveries.length === 1 ? "" : "s"} recorded with an auditable decision trail.
                  </div>
                </div>
                <strong style={{ fontSize: "15px", color: "#087443", whiteSpace: "nowrap" }}>
                  {formatMoney(intelligence.recentRecoveries.reduce((total, recovery) => total + recovery.amount, 0))}
                </strong>
              </div>
            </div>
          )}
        </div>
      )}

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

              {latestIntelligenceDecision && (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    marginBottom: "10px",
                  }}
                >
                  <div
                    style={{
                      padding: "7px 9px",
                      borderRadius: "7px",
                      background: "#f5f3ff",
                      border: "1px solid #e9dfff",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "8px",
                        fontWeight: 800,
                        color: "#667085",
                        letterSpacing: "0.05em",
                      }}
                    >
                      RECOVERY STRATEGY
                    </div>
                    <div
                      style={{
                        marginTop: "2px",
                        fontSize: "10px",
                        fontWeight: 800,
                        color: "#53389e",
                      }}
                    >
                      {latestIntelligenceDecision.recoveryStrategy
                        .replaceAll("_", " ")}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "7px 9px",
                      borderRadius: "7px",
                      background: "#f8fafc",
                      border: "1px solid #e4e7ec",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "8px",
                        fontWeight: 800,
                        color: "#667085",
                        letterSpacing: "0.05em",
                      }}
                    >
                      RECOVERY PRIORITY
                    </div>
                    <div
                      style={{
                        marginTop: "2px",
                        fontSize: "10px",
                        fontWeight: 800,
                        color: "#344054",
                      }}
                    >
                      {latestIntelligenceDecision.recoveryPriority}
                    </div>
                  </div>
                </div>
              )}

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

      {/* RECOVERY SIMULATION */}
      <div
        style={{
          marginBottom: "18px",
          border: "1px solid #d9d6ff",
          borderRadius: "14px",
          background: "#ffffff",
          padding: "18px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            marginBottom: "14px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: "0.08em",
                color: "#635bff",
              }}
            >
              RECOVERY SIMULATION
            </div>

            <h2
              style={{
                margin: "5px 0 3px",
                fontSize: "18px",
              }}
            >
              Simulate batch recovery
            </h2>

            <p
              style={{
                margin: 0,
                fontSize: "12px",
                color: "#667085",
              }}
            >
              Preview bounded AI recovery actions across all current failed
              payments before any recovery workflow is executed.
            </p>
          </div>

          <button
            type="button"
            onClick={simulateRecovery}
            disabled={simulating}
            style={{
              border: "1px solid #635bff",
              borderRadius: "8px",
              background: simulating ? "#f2f4f7" : "#635bff",
              color: simulating ? "#667085" : "#ffffff",
              padding: "9px 13px",
              fontSize: "11px",
              fontWeight: 800,
              cursor: simulating ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {simulating ? "Simulating..." : "Run simulation"}
          </button>
        </div>

        <div
          style={{
            padding: "10px 12px",
            borderRadius: "9px",
            background: "#f8fafc",
            border: "1px solid #eef2f6",
            marginBottom: "12px",
            fontSize: "10px",
            color: "#475467",
          }}
        >
          <strong>Read-only safety check:</strong>{" "}
          Simulation evaluates current failed payments and does not change
          payment state, create transactions, write recovery audit events, or
          move money.
        </div>

        {!simulation ? (
          <div
            style={{
              padding: "18px",
              borderRadius: "10px",
              background: "#fafafa",
              border: "1px dashed #d0d5dd",
              color: "#667085",
              fontSize: "12px",
              textAlign: "center",
            }}
          >
            Run a simulation to preview the current recovery opportunity.
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "10px",
                marginBottom: "12px",
              }}
            >
              {[
                {
                  label: "REVENUE AT RISK",
                  value: formatMoney(
                    simulation.summary.revenueAtRisk,
                  ),
                },
                {
                  label: "PROJECTED RECOVERY",
                  value: formatMoney(
                    simulation.summary.projectedRecoveryOpportunity,
                  ),
                },
                {
                  label: "AUTO RECOVERY",
                  value: formatMoney(
                    simulation.summary.automatedRecoveryOpportunity,
                  ),
                },
                {
                  label: "PROTECTED / REVIEW",
                  value: formatMoney(
                    simulation.summary.stoppedAmount +
                      simulation.summary.escalationAmount,
                  ),
                },
              ].map((metric) => (
                <div
                  key={metric.label}
                  style={{
                    padding: "13px",
                    borderRadius: "9px",
                    background: "#f8fafc",
                    border: "1px solid #eef2f6",
                  }}
                >
                  <div
                    style={{
                      fontSize: "9px",
                      fontWeight: 800,
                      letterSpacing: "0.05em",
                      color: "#667085",
                    }}
                  >
                    {metric.label}
                  </div>
                  <div
                    style={{
                      marginTop: "5px",
                      fontSize: "18px",
                      fontWeight: 800,
                    }}
                  >
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))",
                gap: "8px",
                marginBottom: "12px",
              }}
            >
              {(
                [
                  ["RETRY", "#087443", "#ecfdf3"],
                  ["STOP", "#b54708", "#fff7ed"],
                  ["REVIEW", "#175cd3", "#eff6ff"],
                ] as const
              ).map(([action, color, background]) => {
                const key =
                  action === "REVIEW"
                    ? "ESCALATE"
                    : action;
                const item =
                  simulation.actionBreakdown[key];

                return (
                  <div
                    key={action}
                    style={{
                      padding: "11px",
                      borderRadius: "9px",
                      background,
                      border: `1px solid ${background}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "9px",
                        fontWeight: 800,
                        color,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {action}
                    </div>
                    <div
                      style={{
                        marginTop: "4px",
                        fontSize: "16px",
                        fontWeight: 800,
                      }}
                    >
                      {item.cases}
                    </div>
                    <div
                      style={{
                        marginTop: "2px",
                        fontSize: "9px",
                        color: "#667085",
                      }}
                    >
                      {formatMoney(item.amount)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                fontSize: "10px",
                color: "#98a2b3",
                marginBottom: "8px",
              }}
            >
              Simulated at{" "}
              {formatDate(simulation.simulation.simulatedAt)}
              {" · "}
              {simulation.simulation.readOnly
                ? "read-only"
                : "execution mode"}
              {" · "}
              {simulation.simulation.executionPerformed
                ? "execution performed"
                : "no execution performed"}
            </div>

            {simulation.decisions.length > 0 && (
              <div
                style={{
                  overflowX: "auto",
                  border: "1px solid #eef2f6",
                  borderRadius: "9px",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "10px",
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "ACTION",
                        "PAYMENT",
                        "FAILURE",
                        "CONFIDENCE",
                        "AMOUNT",
                      ].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            textAlign: "left",
                            padding: "8px 9px",
                            borderBottom:
                              "1px solid #eaecf0",
                            color: "#667085",
                            fontSize: "8px",
                            fontWeight: 800,
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {simulation.decisions.map(
                      (decision) => (
                        <tr
                          key={`${decision.orderId}:${decision.attemptId}`}
                        >
                          <td
                            style={{
                              padding: "9px",
                              borderBottom:
                                "1px solid #f2f4f7",
                              fontWeight: 800,
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
                            {decision.action ===
                            "ESCALATE"
                              ? "REVIEW"
                              : decision.action}
                          </td>

                          <td
                            style={{
                              padding: "9px",
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
                                marginTop: "2px",
                                color: "#98a2b3",
                              }}
                            >
                              {shortId(
                                decision.orderId,
                              )}
                            </div>
                          </td>

                          <td
                            style={{
                              padding: "9px",
                              borderBottom:
                                "1px solid #f2f4f7",
                              color: "#667085",
                            }}
                          >
                            {decision.failureCode ||
                              "Unknown"}
                          </td>

                          <td
                            style={{
                              padding: "9px",
                              borderBottom:
                                "1px solid #f2f4f7",
                              fontWeight: 700,
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
                              padding: "9px",
                              borderBottom:
                                "1px solid #f2f4f7",
                              fontWeight: 700,
                            }}
                          >
                            {formatMoney(
                              decision.amount,
                              decision.currency,
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {simulation.decisions.length === 0 && (
              <div
                style={{
                  padding: "14px",
                  borderRadius: "9px",
                  background: "#ecfdf3",
                  border: "1px solid #d1fadf",
                  color: "#087443",
                  fontSize: "11px",
                }}
              >
                No active failed payments require recovery simulation.
              </div>
            )}
          </>
        )}
      </div>

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
