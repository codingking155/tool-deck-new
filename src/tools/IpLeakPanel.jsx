import { useState, useRef, useEffect } from "react";
import { collectIceCandidates, webrtcVerdict, runDnsLeakTest, dnsVerdict, DNS_PROVIDER } from "../lib/leak.js";

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

const DNS_STEPS = [["start", "Get a one-time test ID"], ["probe", "Look up random test addresses"], ["collect", "Ask which DNS servers looked them up"]];

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const netName = (n) => n.publicResolver || n.name || (n.asn ? `AS${n.asn}` : "Unknown network");
const listNames = (ns) => [...new Set(ns.map(netName))].join(", ");

function dnsMessage(v) {
  const others = v.networks.filter((n) => !n.yours);
  const yourNet = v.you?.network?.name || "your provider";
  switch (v.level) {
    case "same": return { tone: "good", title: "DNS stays on your connection", text: `Every DNS server belongs to ${yourNet}, the same network your IP address comes from. On a VPN, that means your lookups stay inside the tunnel. Without one, it's simply your internet provider's DNS.` };
    case "public": return { tone: "info", title: `You're using ${listNames(others)}`, text: `Your lookups are answered by a well-known public DNS service, not by ${yourNet}. That isn't a leak by itself — you, your router, browser or VPN picked it. On a VPN, check the VPN app is the one that set it.` };
    case "mixed": return { tone: "warn", title: "DNS is split across networks", text: `Some lookups went through ${yourNet} and some through ${listNames(others)}. If you're on a VPN, the ones outside the VPN's network may be leaking around it.` };
    case "other": return { tone: "bad", title: "DNS goes around your connection", text: `Your lookups are answered by ${listNames(others)}, not by ${yourNet} (where your IP address comes from). If you're on a VPN, this is a DNS leak: that network can see which sites you visit. Without a VPN it's usually just your provider's or router's DNS.` };
    case "unknown": return { tone: "info", title: `${plural(v.count, "DNS server")} found`, text: "The test couldn't tell which network your IP belongs to, so compare these with your VPN or internet provider yourself." };
    default: return { tone: "warn", title: "No DNS servers reported", text: "The test service saw no lookups from you. Try again — ad blockers, private DNS or a strict firewall can interfere." };
  }
}

const TONE = { good: ["ok", "var(--good)", "\u2713"], info: ["i", "var(--teal)", "i"], warn: ["w", "var(--warn)", "!"], bad: ["e", "var(--bad)", "!"] };

function DnsNetwork({ n }) {
  const tag = n.yours ? ["act", "Your network"] : n.publicResolver ? ["up", "Public DNS"] : ["wk", "Other network"];
  return (
    <li className="dns-net">
      <div className="dns-net-head">
        <div className="dns-net-name">
          <b>{netName(n)}</b>
          <span>{[n.publicResolver && n.name, n.asn && `AS${n.asn}`, n.countries.join(", ")].filter(Boolean).join(" · ")}</span>
        </div>
        <span className={`chip ${tag[0]}`}>{tag[1]}</span>
      </div>
      <details className="dns-ips" open={n.ips.length <= 4}>
        <summary>{plural(n.ips.length, "server address", "server addresses")}</summary>
        <ul>{n.ips.map((ip) => <li key={ip}>{ip}</li>)}</ul>
      </details>
    </li>
  );
}

function DnsCard() {
  const [state, setState] = useState({ phase: "idle" });
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = async () => {
    ctrl.current?.abort(); const c = ctrl.current = new AbortController();
    setState({ phase: "running", step: "start" });
    try {
      const r = await runDnsLeakTest(fetch, { signal: c.signal, onStep: (step) => !c.signal.aborted && setState({ phase: "running", step }) });
      if (!c.signal.aborted) setState({ phase: "done", r, v: dnsVerdict(r) });
    } catch (e) {
      if (e?.name !== "AbortError" && !c.signal.aborted) setState({ phase: "error", msg: /unavailable|unexpected/.test(e?.message || "") ? e.message : "Couldn't reach the DNS test service." });
    }
  };
  const { phase, v, step, msg } = state;
  const m = v && dnsMessage(v);
  const tone = m && TONE[m.tone];
  const countries = v ? new Set(v.networks.flatMap((n) => n.countries)).size : 0;
  const stepAt = DNS_STEPS.findIndex(([k]) => k === step);
  return (
    <div className="panel dns-card">
      <h3 style={{ margin: "0 0 4px" }}>DNS leak check</h3>
      <p className="hint" style={{ marginTop: 0 }}>Finds out which DNS servers turn website names into addresses for you. On a VPN they should belong to the VPN (or a DNS service you chose), not your home internet provider.</p>

      {phase === "running" && (
        <ol className="dns-steps" aria-live="polite">
          {DNS_STEPS.map(([k, label], i) => <li key={k} className={i < stepAt ? "done" : i === stepAt ? "now" : ""}>{label}</li>)}
        </ol>
      )}
      {phase === "error" && <div className="note w" style={{ marginTop: 12 }}><b>Couldn't run the test · </b>{msg}</div>}
      {phase === "done" && (
        <div className="dns-result">
          <div className={`note ${tone[0]} dns-verdict`} role="status">
            <span className="dns-badge" style={{ background: tone[1] }} aria-hidden="true">{tone[2]}</span>
            <div><b>{m.title}</b><div>{m.text}</div></div>
          </div>
          {v.count > 0 && <>
            <div className="dns-stats">
              <div><b>{v.count}</b><span>{v.count === 1 ? "server" : "servers"}</span></div>
              <div><b>{v.networks.length}</b><span>{v.networks.length === 1 ? "network" : "networks"}</span></div>
              <div><b>{countries}</b><span>{countries === 1 ? "country" : "countries"}</span></div>
            </div>
            {v.you && <div className="kv dns-you"><span className="k">Your IP (as the test saw it)</span><span className="v">{v.you.ip}{v.you.network?.name ? ` · ${v.you.network.name}` : ""}</span></div>}
            <ul className="dns-nets">{v.networks.map((n) => <DnsNetwork key={n.key} n={n} />)}</ul>
          </>}
        </div>
      )}

      <button className="btn pri" style={{ marginTop: 14 }} onClick={run} disabled={phase === "running"}>{phase === "running" ? "Testing…" : phase === "idle" ? "Run DNS check" : "Run again"}</button>

      <details className="dns-how">
        <summary>How does this work? Is it private?</summary>
        <p>Your browser asks for a few made-up addresses like <code>1.x7k2….{DNS_PROVIDER.name}</code>. Nobody has looked those up before, so the request has to travel to the DNS server you really use, which then asks {DNS_PROVIDER.name} for the answer. {DNS_PROVIDER.name} notes which DNS servers asked and reports them back here.</p>
        <p>{DNS_PROVIDER.name} is a free third-party testing service. Like any website you open, it sees your IP address; it doesn't see anything else on this page, and ToolDeck stores nothing.</p>
        {v?.count > 0 && state.r?.conclusion && <p>{DNS_PROVIDER.name}'s own one-line verdict was “{state.r.conclusion}” — it says that whenever the DNS servers aren't from your IP's network, even for a public DNS you chose on purpose, so the summary above is more specific.</p>}
      </details>
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
