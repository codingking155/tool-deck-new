import { useState, useMemo } from "react";
import { USER_TZ, bulkSendTimes } from "../lib/time.js";
import ZonePicker from "../components/ZonePicker.jsx";

const SAMPLE = "2026-07-11 18:00\n2026-07-11 21:30\n2026-07-12 09:15, Europe/Amsterdam";

export default function UtcBulkMode({ notify }) {
  const [text, setText] = useState("");
  const [tz, setTz] = useState(USER_TZ);
  const [sendTime, setSendTime] = useState("08:00");
  const [sendDate, setSendDate] = useState("");
  const rows = useMemo(() => (text.trim() && sendTime ? bulkSendTimes({ text, defaultTz: tz, sendTime, sendDate }) : []), [text, tz, sendTime, sendDate]);
  const good = rows.filter((r) => !r.error);

  const table = () => {
    const head = ["Line", "Order (local)", "Timezone", "Order UTC", "Target UTC", "Wait", "Target ISO"];
    return [head, ...good.map((r) => [r.line, `${r.date} ${r.time}`, r.tz, r.orderUtcText, r.sendUtcText, r.wait, r.iso])];
  };
  const copy = () => navigator.clipboard.writeText(table().map((r) => r.join("\t")).join("\n")).then(() => notify("Table copied.")).catch(() => notify("Copy blocked."));
  const csv = () => {
    const body = table().map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "order-send-times.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    notify("CSV downloaded.");
  };

  return (
    <>
      <div className="grid2">
        <div className="panel rise d1">
          <div className="ph"><h3>Bulk orders</h3><p>One order per line: <code>YYYY-MM-DD HH:MM</code>, optionally followed by a timezone.</p></div>
          <div className="pb">
            <div className="field">
              <label htmlFor="bulk">Orders</label>
              <textarea id="bulk" value={text} placeholder={SAMPLE} spellCheck={false} onChange={(e) => setText(e.target.value)} />
              <button type="button" className="linkbtn" onClick={() => setText(SAMPLE)}>Use example</button>
            </div>
            <div className="field"><label>Default timezone (for lines without one)</label><ZonePicker value={tz} onChange={setTz} /></div>
            <div className="two">
              <div className="field"><label htmlFor="bst">Target Send Time</label><input id="bst" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} /></div>
              <div className="field"><label htmlFor="bsd">Fixed send date (optional)</label><input id="bsd" type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} /></div>
            </div>
          </div>
        </div>
        <div className="panel rise d2">
          {rows.length === 0 ? <div className="empty">Paste your orders to see each target send time and wait.</div> : (
            <div className="pb">
              <div className="bigres" style={{ marginBottom: 12 }}>
                <div className="lab">Processed</div>
                <div className="val">{good.length} of {rows.length}</div>
                {rows.length > good.length && <div className="sub" style={{ color: "var(--bad)" }}>{rows.length - good.length} line(s) need fixing — see below.</div>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn gh" onClick={copy} disabled={!good.length}>⧉ Copy table</button>
                <button className="btn gh" onClick={csv} disabled={!good.length}>⬇ CSV</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="tblwrap rise d3" style={{ marginTop: 16 }}>
          <table className="rt" style={{ minWidth: 820 }}>
            <thead><tr><th>#</th><th>Order (local)</th><th>Timezone</th><th>Order UTC</th><th>Target UTC</th><th style={{ textAlign: "right" }}>Wait</th></tr></thead>
            <tbody>
              {rows.map((r) => r.error ? (
                <tr key={r.line}><td>{r.line}</td><td colSpan={5} style={{ color: "var(--bad)" }}>{r.input} — {r.error}</td></tr>
              ) : (
                <tr key={r.line}>
                  <td>{r.line}</td><td>{r.date} {r.time}</td><td>{r.tz}</td><td>{r.orderUtcText}</td>
                  <td className="c-utc">{r.sendUtcText}</td><td style={{ textAlign: "right", color: "var(--tx)", fontWeight: 600 }}>{r.wait}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
