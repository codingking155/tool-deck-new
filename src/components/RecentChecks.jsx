import { History, X } from "lucide-react";
import "../tools/css/recent.css";

/** Quiet chips of recent lookups (kept on this device). items: [{ host, label }] — `host` is the value re-run on pick. */
export default function RecentChecks({ items, onPick, onClear, title = "Recent checks" }) {
  if (!items.length) return null;
  return (
    <div className="rchecks">
      <div className="rc-h">
        <span className="rc-t"><History size={13} aria-hidden="true" />{title}<span className="rc-dev"> · saved on this device only</span></span>
        <button type="button" className="linkbtn rc-clear" onClick={onClear}><X size={12} aria-hidden="true" />Clear</button>
      </div>
      <ul className="rc-list" aria-label={title}>
        {items.map((e) => (
          <li key={e.host}>
            <button type="button" className="rc-chip" onClick={() => onPick(e.host)} title={e.label || e.host}>
              <span className="rc-v">{e.host}</span>{e.label ? <span className="rc-l">{e.label}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
