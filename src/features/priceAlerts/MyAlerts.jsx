import { useState, useEffect, useCallback } from "react";
import { createAlertsApi } from "./api.js";

function money(n, currency = "INR") {
  if (n == null) return "—";
  try { return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(Number(n)); }
  catch { return `${currency} ${n}`; }
}
const STATUS_CHIP = { active: "act", triggered: "up", paused: "wk", cancelled: "done", expired: "done" };
const DELIVERY_CHIP = { sent: "act", failed: "wk", pending: "done", skipped: "done" };

export default function MyAlerts({ functionsBase, getToken, manageToken, signedIn = false }) {

  const api = createAlertsApi({ functionsBase, getToken });

  const [alerts, setAlerts] = useState([]);
  const [state, setState] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState("");

  const load = useCallback(async () => {
    setState("loading"); setError("");
    try {
      if (manageToken) {
        const r = await api.getByToken(manageToken);
        setAlerts(r.alert ? [r.alert] : []);
      } else {
        const r = await api.list();
        setAlerts(r.alerts || []);
      }
      setState("ready");
    } catch (e) {
      setError(e.message || "Could not load your alerts.");
      setState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageToken]);

  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    try { await fn(); await load(); }
    catch (e) { setError(e.message || "Action failed."); }
  }

  const saveEdit = (a) =>
    act(() => api.update(a.id, { targetPrice: Number(editVal) }, manageToken)).then(() => setEditing(null));

  if (state === "loading") return <div className="pa-empty">Loading your alerts…</div>;
  if (state === "error") return (
    <div className="panel"><div className="pb">
      <div className="pa-formerr"><b>Couldn't load alerts.</b> {error}</div>
      <button className="btn gh" onClick={load}>Try again</button>
    </div></div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <h3 style={{ fontFamily: "var(--disp)", fontSize: 17, fontWeight: 700 }}>
          {manageToken ? "Your price alert" : "My price alerts"}
        </h3>
        <span className="pa-beta">Beta</span>
      </div>

      {error && <div className="pa-formerr" style={{ marginBottom: 12 }}>{error}</div>}

      {alerts.length === 0 ? (
        <div className="pa-empty">
          No alerts yet. Track a product and choose “Set price alert” to get notified when the price drops.
        </div>
      ) : alerts.map((a) => (
        <div className="pa-alertcard" key={a.id}>
          <div className="pa-top">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{a.productName || a.productId}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--tx2)", marginTop: 3 }}>
                Target {money(a.targetPrice, a.currency)}
                {a.originalPrice ? <> · was {money(a.originalPrice, a.currency)}</> : null}
              </div>
            </div>
            <span className={`chip ${STATUS_CHIP[a.status] || "done"}`}>{a.status}</span>
          </div>

          <div className="pa-delivery">
            {a.emailEnabled && (
              <span className={`chip ${DELIVERY_CHIP[a.notificationStatus?.email] || "done"}`}>
                email: {a.notificationStatus?.email || "pending"}
              </span>
            )}
            {a.whatsappEnabled && (
              <span className={`chip ${DELIVERY_CHIP[a.notificationStatus?.whatsapp] || "done"}`}>
                whatsapp: {a.notificationStatus?.whatsapp || "pending"}
              </span>
            )}
            {a.triggeredAt && <span className="chip up">notified {new Date(a.triggeredAt).toLocaleDateString()}</span>}
          </div>

          {editing === a.id ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input type="number" min="1" className="field" style={{ margin: 0, flex: 1 }}
                value={editVal} onChange={(e) => setEditVal(e.target.value)} />
              <button className="btn gh" onClick={() => saveEdit(a)}>Save</button>
              <button className="btn gh" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          ) : (
            <div className="pa-actions">
              <button className="pill" onClick={() => { setEditing(a.id); setEditVal(String(a.targetPrice)); }}>Edit target</button>
              {a.status === "active"
                ? <button className="pill" onClick={() => act(() => api.pause(a.id, manageToken))}>Pause</button>
                : (a.status === "paused" || a.status === "triggered")
                  ? <button className="pill" onClick={() => act(() => api.reactivate(a.id, manageToken))}>Reactivate</button>
                  : null}
              <button className="pill" onClick={() => act(() => api.remove(a.id, manageToken))}>Delete</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
