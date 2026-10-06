export default function RecentChecks({ items, onPick, onClear }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="hint" style={{ margin: "0 0 6px", display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>Recent checks (saved on this device only)</span>
        <button type="button" className="linkbtn" style={{ margin: 0 }} onClick={onClear}>Clear</button>
      </div>
      <div className="pillrow">
        {items.map((e) => (
          <button key={e.host} type="button" className="pill" onClick={() => onPick(e.host)} title={e.label || e.host}>
            {e.host}{e.label ? <span style={{ color: "var(--tx3)", marginLeft: 6 }}>{e.label}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
