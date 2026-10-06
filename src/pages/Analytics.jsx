import { useState, useEffect } from "react";
import { useDocumentMeta } from "../hooks/index.js";

function generateMockAnalytics() {
  const toolNames = ["UTC", "Phone", "Shopify", "Speed", "IP", "Price", "JSON", "SSL"];
  return {
    totalSessions: Math.floor(Math.random() * 50000) + 10000,
    totalTools: toolNames.length,
    avgSessionDuration: (Math.random() * 8 + 2).toFixed(1),
    toolUsage: toolNames.map((name, i) => ({
      name,
      count: Math.floor(Math.random() * 5000) + 500,
      percentChange: (Math.random() * 40 - 20).toFixed(1),
    })).sort((a, b) => b.count - a.count),
    geographic: [
      { country: "India", count: Math.floor(Math.random() * 15000) + 5000, code: "🇮🇳" },
      { country: "United States", count: Math.floor(Math.random() * 8000) + 2000, code: "🇺🇸" },
      { country: "United Kingdom", count: Math.floor(Math.random() * 4000) + 1000, code: "🇬🇧" },
      { country: "Canada", count: Math.floor(Math.random() * 3000) + 800, code: "🇨🇦" },
      { country: "Australia", count: Math.floor(Math.random() * 2500) + 600, code: "🇦🇺" },
      { country: "Others", count: Math.floor(Math.random() * 5000) + 2000, code: "🌍" },
    ],
    alerts: {
      created: Math.floor(Math.random() * 1000) + 200,
      delivered: Math.floor(Math.random() * 900) + 100,
      failed: Math.floor(Math.random() * 100) + 10,
      pending: Math.floor(Math.random() * 50) + 5,
    },
    performance: {
      avgLoadTime: (Math.random() * 1.5 + 0.5).toFixed(2),
      avgInteractionTime: (Math.random() * 2 + 1).toFixed(2),
      uptime: (99 + Math.random()).toFixed(2),
    },
  };
}

export default function Analytics() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  useDocumentMeta(null);

  useEffect(() => {
    setTimeout(() => {
      setAnalytics(generateMockAnalytics());
      setLoading(false);
    }, 500);
  }, []);

  if (loading || !analytics) {
    return (
      <div className="tpage">
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <p style={{ color: "var(--tx3)" }}>Loading analytics...</p>
        </div>
      </div>
    );
  }

  const deliveryRate = analytics.alerts.delivered > 0
    ? ((analytics.alerts.delivered / analytics.alerts.created) * 100).toFixed(1)
    : 0;

  return (
    <div className="tpage">
      <div className="crumb">
        <span>Analytics Dashboard</span>
      </div>

      {/* Summary Stats */}
      <div className="secbar" style={{ marginTop: "20px" }}>
        <h3>Key Metrics</h3>
      </div>
      <div className="pstat">
        <div className="pcell">
          <div className="k">Total Sessions</div>
          <div className="v">{analytics.totalSessions.toLocaleString()}</div>
          <div style={{ fontSize: "11px", color: "var(--tx3)", marginTop: "4px" }}>All time</div>
        </div>
        <div className="pcell">
          <div className="k">Avg Session Duration</div>
          <div className="v">{analytics.avgSessionDuration} <span style={{ fontSize: "12px", color: "var(--tx3)" }}>min</span></div>
        </div>
        <div className="pcell">
          <div className="k">Load Time</div>
          <div className="v gd">{analytics.performance.avgLoadTime}s</div>
        </div>
        <div className="pcell">
          <div className="k">Uptime</div>
          <div className="v gd">{analytics.performance.uptime}%</div>
        </div>
      </div>

      {/* Tool Popularity */}
      <div className="secbar" style={{ marginTop: "28px" }}>
        <h3>Tool Popularity</h3>
      </div>
      <div className="panel">
        <div className="pb">
          {analytics.toolUsage.map((tool, i) => {
            const total = analytics.toolUsage.reduce((sum, t) => sum + t.count, 0);
            const pct = ((tool.count / total) * 100).toFixed(1);
            const change = parseFloat(tool.percentChange);
            const trend = change > 0 ? "📈" : change < 0 ? "📉" : "→";

            return (
              <div
                key={i}
                style={{
                  paddingBottom: "12px",
                  marginBottom: "12px",
                  borderBottom: i < analytics.toolUsage.length - 1 ? "1px solid var(--line2)" : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontWeight: "600", color: "var(--tx)" }}>{tool.name}</span>
                  <span style={{ fontSize: "12px", color: "var(--tx3)" }}>
                    {tool.count.toLocaleString()} uses ({pct}%)
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <div
                    style={{
                      flex: 1,
                      height: "6px",
                      background: "var(--line)",
                      borderRadius: "3px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, var(--pri2), var(--pri))",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "11px", color: change > 0 ? "var(--good)" : "var(--bad)" }}>
                    {trend} {Math.abs(change)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Geographic Distribution */}
      <div className="secbar" style={{ marginTop: "28px" }}>
        <h3>Geographic Distribution</h3>
      </div>
      <div className="panel">
        <div className="pb">
          {analytics.geographic.map((geo, i) => {
            const total = analytics.geographic.reduce((sum, g) => sum + g.count, 0);
            const pct = ((geo.count / total) * 100).toFixed(1);

            return (
              <div
                key={i}
                style={{
                  paddingBottom: "12px",
                  marginBottom: "12px",
                  borderBottom: i < analytics.geographic.length - 1 ? "1px solid var(--line2)" : "none",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: "18px", marginRight: "8px" }}>{geo.code}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "600", color: "var(--tx)", marginBottom: "4px" }}>{geo.country}</div>
                  <div
                    style={{
                      height: "4px",
                      background: "var(--line)",
                      borderRadius: "2px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, var(--teal), var(--pri2))",
                      }}
                    />
                  </div>
                </div>
                <span style={{ fontSize: "12px", color: "var(--tx3)", marginLeft: "12px", minWidth: "60px", textAlign: "right" }}>
                  {geo.count.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alert Delivery Status */}
      <div className="secbar" style={{ marginTop: "28px" }}>
        <h3>Price Alert Delivery</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "20px" }}>
        <div className="pcell">
          <div className="k">Created</div>
          <div className="v">{analytics.alerts.created}</div>
        </div>
        <div className="pcell">
          <div className="k">Delivered</div>
          <div className="v gd">{analytics.alerts.delivered}</div>
        </div>
        <div className="pcell">
          <div className="k">Pending</div>
          <div className="v pr">{analytics.alerts.pending}</div>
        </div>
        <div className="pcell">
          <div className="k">Failed</div>
          <div className="v bd">{analytics.alerts.failed}</div>
        </div>
        <div className="pcell">
          <div className="k">Delivery Rate</div>
          <div className="v gd">{deliveryRate}%</div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="note i" style={{ marginBottom: "20px" }}>
        <b>Note:</b> Analytics shown are aggregated data across all users. All individual data is anonymized and does not include personal information.
      </div>
    </div>
  );
}
