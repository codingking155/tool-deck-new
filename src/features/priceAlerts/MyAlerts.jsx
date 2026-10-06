import { useState, useEffect, useCallback } from "react";
import { BellOff, BellRing, CircleCheck, CirclePause, Mail, MessageCircle, Package, Pencil, Play, Pause, Trash2 } from "lucide-react";
import { EmptyState, Notice, StatusBadge, BetaBadge } from "../../components/ui.jsx";
import { createAlertsApi } from "./api.js";
import "./alerts.css";

function money(n, currency = "INR") {
  if (n == null) return "—";
  try { return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(Number(n)); }
  catch { return `${currency} ${n}`; }
}
/* status → badge tone + icon + words (never colour alone) */
const STATUS = {
  active: ["ok", BellRing, "Active"], triggered: ["brand", CircleCheck, "Triggered"], paused: ["warn", CirclePause, "Paused"],
  cancelled: ["", BellOff, "Cancelled"], expired: ["", BellOff, "Expired"],
};
const DELIVERY_TONE = { sent: "ok", failed: "warn", pending: "", skipped: "" };

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

  const [editErr, setEditErr] = useState("");

  /* resolves true on success; on failure the error stays visible and callers keep their UI open */
  async function act(fn) {
    setError("");
    try { await fn(); }
    catch (e) { setError(e.message || "Action failed."); return false; }
    await load();
    return true;
  }

  const saveEdit = async (a) => {
    const n = Number(editVal);
    if (!editVal || !Number.isFinite(n) || n <= 0) { setEditErr("Enter a target price above 0."); return; }
    setEditErr("");
    if (await act(() => api.update(a.id, { targetPrice: n }, manageToken))) setEditing(null);
  };

  if (state === "loading") return (
    <div className="pa-page">
      <PageHead manageToken={manageToken} />
      <div className="pa-list" role="status" aria-label="Loading your alerts">
        {[0, 1].map((i) => <div key={i} className="pa-row pa-row-skel"><div className="skel pa-thumb" /><div className="pa-rmain"><div className="skel pa-sk1" /><div className="skel pa-sk2" /></div></div>)}
      </div>
    </div>
  );
  if (state === "error") return (
    <div className="pa-page">
      <PageHead manageToken={manageToken} />
      <Notice tone="e" title="Couldn't load alerts." actions={<button type="button" className="btn gh sm" onClick={load}>Try again</button>}>
        <p>{error}</p>
      </Notice>
    </div>
  );

  return (
    <div className="pa-page">
      <PageHead manageToken={manageToken} />

      {error && <Notice tone="e" className="pa-formerr">{error}</Notice>}

      {alerts.length === 0 ? (
        <div className="panel">
          <EmptyState icon={BellOff} title="No alerts yet"
            actions={<a className="btn gh" href="/tool/price">Track a product</a>}>
            No alerts yet. Track a product and choose “Set price alert” to get notified when the price drops.
          </EmptyState>
        </div>
      ) : (
        <ul className="pa-list">
          {alerts.map((a) => {
            const [tone, Icon, word] = STATUS[a.status] || ["", BellOff, a.status];
            return (
              <li className="pa-row" key={a.id}>
                {a.productImage
                  ? <img className="pa-thumb" src={a.productImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  : <div className="pa-thumb pa-noimg" aria-hidden="true"><Package size={20} strokeWidth={1.7} /></div>}
                <div className="pa-rmain">
                  <div className="pa-rtop">
                    <h2 className="pa-rname">
                      {a.productUrl
                        ? <a href={a.productUrl} target="_blank" rel="nofollow sponsored noopener noreferrer">{a.productName || a.productId}<span className="sr-only"> (opens in a new tab)</span></a>
                        : (a.productName || a.productId)}
                    </h2>
                    <StatusBadge tone={tone} icon={Icon}>{word}</StatusBadge>
                  </div>
                  <dl className="pa-prices">
                    <div><dt>Target</dt><dd>{money(a.targetPrice, a.currency)}</dd></div>
                    {a.originalPrice ? <div><dt>Price when set</dt><dd>{money(a.originalPrice, a.currency)}</dd></div> : null}
                  </dl>

                  <div className="pa-delivery">
                    {a.emailEnabled && (
                      <StatusBadge tone={DELIVERY_TONE[a.notificationStatus?.email] || ""} icon={Mail}>
                        email: {a.notificationStatus?.email || "pending"}
                      </StatusBadge>
                    )}
                    {a.whatsappEnabled && (
                      <StatusBadge tone={DELIVERY_TONE[a.notificationStatus?.whatsapp] || ""} icon={MessageCircle}>
                        whatsapp: {a.notificationStatus?.whatsapp || "pending"}
                      </StatusBadge>
                    )}
                    {a.triggeredAt && <StatusBadge tone="brand" icon={CircleCheck}>notified {new Date(a.triggeredAt).toLocaleDateString()}</StatusBadge>}
                  </div>

                  {editing === a.id ? (
                    <div className="field pa-edit">
                      <label htmlFor={`pa-edit-${a.id}`}>New target price ({a.currency || "INR"})</label>
                      <div className="inrow">
                        <input id={`pa-edit-${a.id}`} type="number" min="1" inputMode="decimal" className="mono"
                          value={editVal} onChange={(e) => { setEditVal(e.target.value); if (editErr) setEditErr(""); }}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(a); }}
                          aria-invalid={!!editErr} aria-describedby={editErr ? `pa-edit-err-${a.id}` : undefined} />
                        <button type="button" className="btn sm" onClick={() => saveEdit(a)}>Save</button>
                        <button type="button" className="btn qt sm" onClick={() => { setEditing(null); setEditErr(""); }}>Cancel</button>
                      </div>
                      {editErr && <div id={`pa-edit-err-${a.id}`} className="pa-err" role="alert">{editErr}</div>}
                    </div>
                  ) : (
                    <div className="actions pa-actions">
                      <button type="button" className="btn gh sm" onClick={() => { setEditing(a.id); setEditVal(String(a.targetPrice)); setEditErr(""); }}><Pencil size={14} aria-hidden="true" />Edit target</button>
                      {a.status === "active"
                        ? <button type="button" className="btn gh sm" onClick={() => act(() => api.pause(a.id, manageToken))}><Pause size={14} aria-hidden="true" />Pause</button>
                        : (a.status === "paused" || a.status === "triggered" || a.status === "expired")
                          ? <button type="button" className="btn gh sm" onClick={() => act(() => api.reactivate(a.id, manageToken))}><Play size={14} aria-hidden="true" />Reactivate</button>
                          : null}
                      <button type="button" className="btn qt sm pa-del" onClick={() => act(() => api.remove(a.id, manageToken))}><Trash2 size={14} aria-hidden="true" />Delete</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PageHead({ manageToken }) {
  return (
    <div className="pa-pagehead">
      <h1>{manageToken ? "Your price alert" : "My price alerts"} <BetaBadge /></h1>
      <p>Alerts check the live Amazon price every hour and notify you once it's at or below your target.</p>
    </div>
  );
}
