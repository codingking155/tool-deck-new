import { useState, useRef, useEffect } from "react";
import { collectIceCandidates, webrtcVerdict, runDnsLeakTest, dnsSummary, DNS_PROVIDER } from "../lib/leak.js";

const LEVEL = {
  ok:      { color: "var(--good)", title: "No WebRTC leak found", text: "WebRTC only exposed the public address websites already see (and hid any local address behind a random .local name)." },
  local:   { color: "var(--warn)", title: "Local network address exposed", text: "Your browser revealed a private LAN address to this page. Sites could read it, which helps fingerprint you. Many browsers hide it by default; check your browser's WebRTC privacy setting." },
  leak:    { color: "var(--bad)",  title: "Possible IP leak", text: "WebRTC revealed a public address that differs from the one websites see. If you use a VPN or proxy, your real address may be leaking around it." },
  unknown: { color: "var(--warn)", title: "Can't confirm yet", text: "WebRTC exposed a public address, but this page doesn't know which address websites see for you (for that IP version), so it can't tell whether it differs. Run \u201cCheck my IP & IPv6\u201d above, then run this check again." },
  blocked: { color: "var(--tx2)",  title: "WebRTC exposed nothing", text: "No addresses were gathered — WebRTC is disabled or blocked here, or the STUN server was unreachable. That is private, but it can also mean the test couldn't run." },
};

function WebRtcCard({ known }) {
  const [state, setState] = useState({ phase: "idle" });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = async () => {
    setState({ phase: "running" });
    const { supported, candidates } = await collectIceCandidates();
    if (!alive.current) return;
    if (!supported) return setState({ phase: "unsupported" });
    setState({ phase: "done", v: webrtcVerdict(candidates, known) });
  };
  const { phase, v } = state;
  const L = v && LEVEL[v.level];
  return (
    <div className="panel" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>WebRTC leak check</h3>
      <p className="hint" style={{ marginTop: 0 }}>Browsers can reveal addresses through WebRTC even behind a VPN. This asks a STUN server what your browser exposes.</p>
      <button className="btn pri" onClick={run} disabled={phase === "running"}>{phase === "running" ? "Checking…" : phase === "done" ? "Run again" : "Run WebRTC check"}</button>
      {phase === "unsupported" && <div className="note i" style={{ marginTop: 12 }}><b>Not supported · </b>this browser has no WebRTC, so it can't leak through it.</div>}
      {phase === "done" && (
        <div style={{ marginTop: 12 }}>
          <div className="note" style={{ borderColor: L.color }}><b style={{ color: L.color }}>{L.title} · </b>{L.text}</div>
          {v.publicIps.length > 0 && <div className="kv"><span className="k">Public addresses seen</span><span className="v">{v.publicIps.join(", ")}</span></div>}
          {v.localIps.length > 0 && <div className="kv"><span className="k">Local addresses exposed</span><span className="v">{v.localIps.join(", ")}</span></div>}
          {v.mdnsCount > 0 && <div className="kv"><span className="k">Hidden behind .local names</span><span className="v">{v.mdnsCount}</span></div>}
          {v.unverified?.length > 0 && <div className="kv"><span className="k">Not yet compared</span><span className="v" style={{ color: "var(--warn)" }}>{v.unverified.join(", ")}</span></div>}
          {v.mismatched.length > 0 && <div className="kv"><span className="k">Not the address sites see</span><span className="v" style={{ color: "var(--bad)" }}>{v.mismatched.join(", ")}</span></div>}
        </div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>Uses Google's public STUN server, which sees your IP like any STUN request. Results stay on this page.</div>
    </div>
  );
}

function DnsCard() {
  const [state, setState] = useState({ phase: "idle" });
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = async () => {
    ctrl.current?.abort(); ctrl.current = new AbortController();
    setState({ phase: "running" });
    try {
      const r = await runDnsLeakTest(fetch, { signal: ctrl.current.signal });
      setState({ phase: "done", r });
    } catch (e) {
      if (e?.name !== "AbortError") setState({ phase: "error", msg: /unavailable|unexpected/.test(e?.message || "") ? e.message : "Couldn't reach the DNS test service." });
    }
  };
  const { phase, r, msg } = state;
  const sum = r ? dnsSummary(r.resolvers) : null;
  return (
    <div className="panel" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>DNS leak check</h3>
      <p className="hint" style={{ marginTop: 0 }}>Shows which DNS servers answer your lookups. With a VPN, these should belong to your VPN (or a resolver you chose), not your home ISP.</p>
      <button className="btn pri" onClick={run} disabled={phase === "running"}>{phase === "running" ? "Testing…" : phase === "done" ? "Run again" : "Run DNS check"}</button>
      {phase === "error" && <div className="note w" style={{ marginTop: 12 }}><b>Couldn't run the test · </b>{msg}</div>}
      {phase === "done" && (
        <div style={{ marginTop: 12 }}>
          {r.resolvers.length === 0
            ? <div className="note w"><b>No resolvers reported · </b>the test service saw no lookups from you. Try again; ad blockers or private DNS can interfere.</div>
            : <>
                <div className="note i"><b>{sum.count} DNS server{sum.count > 1 ? "s" : ""} · </b>{sum.networks} network{sum.networks !== 1 ? "s" : ""}, {sum.countries} countr{sum.countries !== 1 ? "ies" : "y"}.
                  Compare them with your VPN or ISP: servers from your ISP while a VPN is on mean DNS is leaking.</div>
                {r.resolvers.map((x) => (
                  <div key={x.ip} className="kv"><span className="k">{x.ip}</span><span className="v">{[x.asn, x.country].filter(Boolean).join(" · ") || "—"}</span></div>
                ))}
              </>}
          {r.conclusion && <div className="hint" style={{ marginTop: 8 }}>{DNS_PROVIDER.name} says: “{r.conclusion}”</div>}
        </div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>This test uses the third-party {DNS_PROVIDER.name} service: your browser looks up random sub-domains of it and it reports which DNS servers asked. It sees your IP, like any website you visit.</div>
    </div>
  );
}

export default function IpLeakPanel({ v4, v6 }) {
  return (
    <div className="panel rise d3" style={{ marginTop: 16 }}>
      <div className="ph"><h2>Privacy leak checks</h2><p>Check whether a VPN or privacy setting is really hiding you. Nothing is stored.</p></div>
      <div className="pb">
        <div className="grid2" style={{ marginTop: 0 }}>
          <WebRtcCard known={{ v4, v6 }} />
          <DnsCard />
        </div>
      </div>
    </div>
  );
}
