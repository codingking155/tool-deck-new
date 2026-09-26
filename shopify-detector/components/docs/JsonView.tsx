import type { ReactNode } from "react";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Tiny JSON highlighter — keys, strings, numbers and literals — without shipping a highlighting library. */
export function highlightJson(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of source.matchAll(TOKEN)) {
    const i = m.index!;
    if (i > last) out.push(source.slice(last, i));
    const [whole, str, colon, literal, num] = m;
    if (str && colon) {
      out.push(<span key={i} className="text-sky-300">{str}</span>, colon);
    } else if (str) {
      out.push(<span key={i} className="text-emerald-300">{str}</span>);
    } else if (literal) {
      out.push(<span key={i} className="text-violet-300">{literal}</span>);
    } else if (num) {
      out.push(<span key={i} className="text-amber-300">{num}</span>);
    } else {
      out.push(whole);
    }
    last = i + whole.length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

export default function JsonView({ value }: { value: unknown }) {
  return <>{highlightJson(JSON.stringify(value, null, 2))}</>;
}
