import { useMemo, useRef } from "react";

const MAX_GUTTER_LINES = 100000;

/* Textarea with a line-number gutter kept in sync by transform (no re-render on scroll).
   Height comes in as a CSS custom property so the stylesheet can clamp it on small screens. */
export default function CodeEditor({ id, label, value, onChange, readOnly, height = 380, errorLine, taRef, onKeyDown, placeholder, onDrop, invalid, describedBy }) {
  const gutRef = useRef(null);
  const lines = useMemo(() => {
    let n = 1;
    for (let i = value.indexOf("\n"); i !== -1; i = value.indexOf("\n", i + 1)) n++;
    return n;
  }, [value]);
  const nums = useMemo(
    () => (lines > MAX_GUTTER_LINES ? "" : Array.from({ length: lines }, (_, i) => i + 1).join("\n")),
    [lines],
  );
  return (
    <div className={`code-ed${readOnly ? " ro" : ""}`} style={{ "--ed-h": `${height}px` }}>
      {nums && (
        <div className="code-gut" aria-hidden="true">
          <div className="code-gut-in" ref={gutRef}>
            {errorLine ? <div className="code-err" style={{ "--el": errorLine }} /> : null}
            {nums}
          </div>
        </div>
      )}
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id}
        ref={taRef}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        onScroll={(e) => { if (gutRef.current) gutRef.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`; }}
        onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
        onDrop={onDrop}
      />
    </div>
  );
}
