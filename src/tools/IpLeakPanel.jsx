import { useState, useRef, useEffect } from "react";
import { ShieldCheck, TriangleAlert, CircleMinus, CircleHelp, CircleDashed, LoaderCircle, CircleCheck, Radio, Server } from "lucide-react";
import { collectIceCandidates, webrtcVerdict, runDnsLeakTest, dnsVerdict, DNS_PROVIDER } from "../lib/leak.js";
import { Notice, StatusBadge } from "../components/ui.jsx";
import "./css/ip.css";

/* One status vocabulary for every diagnostic: icon + word, never colour alone.
   safe → Safe · issue → Potential issue · na → Unavailable · unknown → Unknown */
const STATUS = {
  safe:    ["ok", ShieldCheck, "Safe"],
  issue:   ["warn", TriangleAlert, "Potential issue"],
  na:      ["", CircleMinus, "Unavailable"],
  unknown: ["", CircleHelp, "Unknown"],
  idle:    ["", CircleDashed, "Not run yet"],
  busy:    ["", LoaderCircle, "Checking…"],
};

export function DiagStatus({ s, label }) {
  const [tone, Icon, word] = STATUS[s] || STATUS.unknown;
  return (
    <span className={`ipt-status${s === "busy" ? " busy" : ""}`}>
      <StatusBadge tone={tone} icon={label && s === "safe" ? CircleCheck : Icon}>{label || word}</StatusBadge>
    </span>
  );
}

const LEVEL = {
  ok:      { s: "safe",    tone: "ok", title: "No WebRTC leak found", text: "WebRTC only exposed the public address websites already see (and hid any local address behind a random .local name)." },
  local:   { s: "issue",   tone: "w",  title: "Local network address exposed", text: "Your browser revealed a private LAN address to this page. Sites could read it, which helps fingerprint you. Many browsers hide it by default; check your browser's WebRTC privacy setting." },
  leak:    { s: "issue",   tone: "w",  title: "Possible IP leak", text: "WebRTC revealed a public address that differs from the one websites see. If you use a VPN or proxy, your real address may be leaking around it." },
  unknown: { s: "unknown", tone: "i",  title: "Can't confirm yet", text: "WebRTC exposed a public address, but this page doesn't know which address websites see for you (for that IP version), so it can't tell whether it differs. Use “Re-check” at the top of the page, then run this check again." },
  blocked: { s: "unknown", tone: "i",  title: "WebRTC exposed nothing", text: "No addresses were gathered — WebRTC is disabled or blocked here, or the STUN server was unreachable. That is private, but it can also mean the test couldn't run." },
};

function WebRtcCard({ known }) {
  const [state, setState] = useState({ phase: "idle" });
  const alive = useRef(true);
  /* re-arm on mount: StrictMode's dev double-mount would otherwise leave it false forever */
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async () => {
    setState({ phase: "running" });
    const { supported, candidates } = await collectIceCandidates();
    if (!alive.current) return;
    if (!supported) return setState({ phase: "unsupported" });
    setState({ phase: "done", v: webrtcVerdict(candidates, known) });
  };
  const { phase, v } = state;
  const L = v && LEVEL[v.level];
  const status = phase === "running" ? "busy" : phase === "unsupported" ? "safe" : L ? L.s : "idle";
  return (
    <section className="panel ipt-sec ipt-check" aria-labelledby="ipt-rtc-h">
      <div className="ipt-sechead">
        <h3 id="ipt-rtc-h"><Radio size={15} aria-hidden="true" />WebRTC leak check</h3>
        <DiagStatus s={status} />
      </div>
      <div className="pb">
        <p className="ipt-p">Browsers can reveal addresses through WebRTC even behind a VPN. This asks a STUN server what your browser exposes.</p>
        <div aria-live="polite">
          {phase === "unsupported" && <Notice tone="ok" title="Not supported">This browser has no WebRTC, so it can't leak through it.</Notice>}
          {phase === "done" && (
            <div className="ipt-result">
              <Notice tone={L.tone} title={L.title}>{L.text}</Notice>
              <div className="ipt-kvs">
                {v.publicIps.length > 0 && <div className="kv"><span className="k">Public addresses seen</span><span className="v">{v.publicIps.join(", ")}</span></div>}
                {v.localIps.length > 0 && <div className="kv"><span className="k">Local addresses exposed</span><span className="v">{v.localIps.join(", ")}</span></div>}
                {v.mdnsCount > 0 && <div className="kv"><span className="k">Hidden behind .local names</span><span className="v">{v.mdnsCount}</span></div>}
                {v.unverified?.length > 0 && <div className="kv"><span className="k">Not yet compared</span><span className="v">{v.unverified.join(", ")}</span></div>}
                {v.mismatched.length > 0 && (
                  <div className="kv is-flag"><span className="k"><TriangleAlert size={13} aria-hidden="true" />Not the address sites see</span><span className="v">{v.mismatched.join(", ")}</span></div>
                )}
              </div>
            </div>
          )}
        </div>
        <button type="button" className="btn auto" onClick={run} disabled={phase === "running"}>
          {phase === "running" ? "Checking…" : phase === "done" ? "Run again" : "Run WebRTC check"}
        </button>
        <p className="hint">Uses Google's public STUN server, which sees your IP like any STUN request. Results stay on this page.</p>
      </div>
    </section>
  );
}

const DNS_STEPS = [["start", "Get a one-time test ID"], ["probe", "Look up random test addresses"], ["collect", "Ask which DNS servers looked them up"]];

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const netName = (n) => n.publicResolver || n.name || (n.asn ? `AS${n.asn}` : "Unknown network");
const listNames = (ns) => [...new Set(ns.map(netName))].join(", ");

/* s = diagnostic status, tone = Notice tone. "other" was a red alarm; it's a potential issue that depends on VPN use. */
function dnsMessage(v) {
  const others = v.networks.filter((n) => !n.yours);
  const yourNet = v.you?.network?.name || "your provider";
  switch (v.level) {
    case "same": return { s: "safe", tone: "ok", title: "DNS stays on your connection", text: `Every DNS server belongs to ${yourNet}, the same network your IP address comes from. On a VPN, that means your lookups stay inside the tunnel. Without one, it's simply your internet provider's DNS.` };
    case "public": return { s: "safe", tone: "i", title: `You're using ${listNames(others)}`, text: `Your lookups are answered by a well-known public DNS service, not by ${yourNet}. That isn't a leak by itself — you, your router, browser or VPN picked it. On a VPN, check the VPN app is the one that set it.` };
    case "mixed": return { s: "issue", tone: "w", title: "DNS is split across networks", text: `Some lookups went through ${yourNet} and some through ${listNames(others)}. If you're on a VPN, the ones outside the VPN's network may be leaking around it.` };
    case "other": return { s: "issue", tone: "w", title: "DNS goes around your connection", text: `Your lookups are answered by ${listNames(others)}, not by ${yourNet} (where your IP address comes from). If you're on a VPN, this is a DNS leak: that network can see which sites you visit. Without a VPN it's usually just your provider's or router's DNS.` };
    case "unknown": return { s: "unknown", tone: "i", title: `${plural(v.count, "DNS server")} found`, text: "The test couldn't tell which network your IP belongs to, so compare these with your VPN or internet provider yourself." };
    default: return { s: "na", tone: "w", title: "No DNS servers reported", text: "The test service saw no lookups from you. Try again — ad blockers, private DNS or a strict firewall can interfere." };
  }
}

function DnsNetwork({ n }) {
  return (
    <li className="dns-net">
      <div className="dns-net-head">
        <div className="dns-net-name">
          <b>{netName(n)}</b>
          <span>{[n.publicResolver && n.name, n.asn && `AS${n.asn}`, n.countries.join(", ")].filter(Boolean).join(" · ")}</span>
        </div>
        {n.yours ? <StatusBadge tone="ok">Your network</StatusBadge>
          : n.publicResolver ? <StatusBadge tone="info">Public DNS</StatusBadge>
          : <StatusBadge>Other network</StatusBadge>}
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
  const countries = v ? new Set(v.networks.flatMap((n) => n.countries)).size : 0;
  const stepAt = DNS_STEPS.findIndex(([k]) => k === step);
  const status = phase === "running" ? "busy" : phase === "error" ? "na" : m ? m.s : "idle";
  return (
    <section className="panel ipt-sec ipt-check dns-card" aria-labelledby="ipt-dns-h">
      <div className="ipt-sechead">
        <h3 id="ipt-dns-h"><Server size={15} aria-hidden="true" />DNS leak check</h3>
        <DiagStatus s={status} />
      </div>
      <div className="pb">
        <p className="ipt-p">Finds out which DNS servers turn website names into addresses for you. On a VPN they should belong to the VPN (or a DNS service you chose), not your home internet provider.</p>

        {phase === "running" && (
          <ol className="dns-steps" aria-live="polite">
            {DNS_STEPS.map(([k, label], i) => (
              <li key={k} className={i < stepAt ? "done" : i === stepAt ? "now" : ""}>
                {label}{i < stepAt && <span className="sr-only"> (done)</span>}
              </li>
            ))}
          </ol>
        )}
        {phase === "error" && (
          <Notice tone="off" title="Couldn't run the test">{msg} Check your connection or try again shortly.</Notice>
        )}
        {phase === "done" && (
          <div className="ipt-result">
            <Notice tone={m.tone} title={m.title} role="status">{m.text}</Notice>
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

        <button type="button" className="btn auto" onClick={run} disabled={phase === "running"}>
          {phase === "running" ? "Testing…" : phase === "idle" ? "Run DNS check" : "Run again"}
        </button>

        <details className="more dns-how">
          <summary>How does this work? Is it private?</summary>
          <p>Your browser asks for a few made-up addresses like <code>1.x7k2….{DNS_PROVIDER.name}</code>. Nobody has looked those up before, so the request has to travel to the DNS server you really use, which then asks {DNS_PROVIDER.name} for the answer. {DNS_PROVIDER.name} notes which DNS servers asked and reports them back here.</p>
          <p>{DNS_PROVIDER.name} is a free third-party testing service. Like any website you open, it sees your IP address; it doesn't see anything else on this page, and ToolDeck stores nothing.</p>
          {v?.count > 0 && state.r?.conclusion && <p>{DNS_PROVIDER.name}'s own one-line verdict was “{state.r.conclusion}” — it says that whenever the DNS servers aren't from your IP's network, even for a public DNS you chose on purpose, so the summary above is more specific.</p>}
        </details>
      </div>
    </section>
  );
}

export default function IpLeakPanel({ v4, v6 }) {
  return (
    <section className="ipt-leaks" aria-labelledby="ipt-leaks-h">
      <div className="secbar">
        <div>
          <h2 id="ipt-leaks-h">Privacy leak checks</h2>
          <p className="ipt-secsub">Check whether a VPN or privacy setting is really hiding you. Nothing is stored.</p>
        </div>
      </div>
      <div className="ipt-pair">
        <WebRtcCard known={{ v4, v6 }} />
        <DnsCard />
      </div>
    </section>
  );
}
