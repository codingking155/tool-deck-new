import { useState, useCallback } from "react";
import { useDocumentMeta } from "../hooks/index.js";

function parseDate(dateStr) {
  const d = new Date(dateStr);
  return {
    iso: d.toISOString(),
    display: d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
    time: Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  };
}

function getDaysUntilExpiry(dateStr) {
  const d = new Date(dateStr);
  return Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function getSeverity(daysLeft) {
  if (daysLeft < 0) return { level: "expired", color: "var(--bad)", icon: "✗" };
  if (daysLeft < 7) return { level: "critical", color: "var(--bad)", icon: "⚠" };
  if (daysLeft < 30) return { level: "warning", color: "var(--warn)", icon: "!" };
  if (daysLeft < 90) return { level: "caution", color: "var(--pri2)", icon: "○" };
  return { level: "ok", color: "var(--good)", icon: "✓" };
}

export default function SslTool({ notify }) {
  const [domain, setDomain] = useState("google.com");
  const [loading, setLoading] = useState(false);
  const [cert, setCert] = useState(null);
  const [error, setError] = useState("");
  const tool = { name: "SSL Certificate Checker", blurb: "View certificate chain, expiry dates, key strength, and vulnerabilities" };
  useDocumentMeta(tool);

  const checkCertificate = useCallback(async () => {
    const trimmed = domain.trim();
    if (!trimmed) {
      setError("Enter a domain name");
      return;
    }

    setLoading(true);
    setError("");
    setCert(null);

    try {
      const url = `https://www.howsmyssl.com/a/check?host=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url, { mode: "cors" });

      if (!response.ok) {
        throw new Error("Certificate not found or domain unreachable");
      }

      const data = await response.json();

      // Also try TLS Scanner API as fallback
      if (!data.certificates) {
        const tlsRes = await fetch(
          `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(trimmed)}&publish=off&all=done`,
          { signal: AbortSignal.timeout(5000) }
        ).catch(() => null);

        if (tlsRes?.ok) {
          const tlsData = await tlsRes.json();
          setCert({
            domain: trimmed,
            fromTlsLabs: true,
            tlsData,
            issuer: tlsData.cert?.issuerLabel || "Loading...",
            subject: trimmed,
          });
          return;
        }
      }

      // Parse certificate data
      if (data.certificates && data.certificates.length > 0) {
        const certs = data.certificates.map(cert => ({
          subject: cert.subject || "Unknown",
          issuer: cert.issuer || "Unknown",
          validFrom: cert.not_before ? parseDate(cert.not_before) : null,
          validTo: cert.not_after ? parseDate(cert.not_after) : null,
          keySize: cert.key_size || "Unknown",
          keyAlgorithm: cert.key_algorithm || "Unknown",
          signatureAlgorithm: cert.signature_algorithm || "Unknown",
          serialNumber: cert.serial_number || "Unknown",
        }));

        setCert({
          domain: trimmed,
          certificates: certs,
          grade: data.grade || "Unknown",
          rating: data.rating || "Unknown",
        });
        notify("Certificate data loaded");
      } else {
        throw new Error("No certificate data available");
      }
    } catch (err) {
      setError(err.message || "Failed to fetch certificate. Domain may not exist or be unreachable.");
      setCert(null);
    } finally {
      setLoading(false);
    }
  }, [domain, notify]);

  const handleKeyPress = (e) => {
    if (e.key === "Enter") checkCertificate();
  };

  return (
    <div className="grid2">
      <div className="panel">
        <div className="ph">
          <h3>Domain</h3>
          <p>Enter domain to check certificate</p>
        </div>
        <div className="pb">
          <div className="field">
            <label>Domain Name</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="example.com"
            />
          </div>
          <button className="btn pri" onClick={checkCertificate} disabled={loading}>
            {loading ? "Checking..." : "Check Certificate"}
          </button>

          {error && (
            <div className="note w" style={{ marginTop: "14px" }}>
              <b>Error: </b>{error}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="ph">
          <h3>Certificate Info</h3>
          <p>{cert ? "Details below" : "Check a domain to see details"}</p>
        </div>
        <div className="pb">
          {!cert && !error && (
            <div className="empty">
              <p>Enter a domain name to check its SSL certificate chain, expiry date, and key strength.</p>
              <p style={{ fontSize: "12px", color: "var(--tx3)", marginTop: "12px" }}>
                Try: google.com, github.com, or your own domain
              </p>
            </div>
          )}

          {cert && cert.certificates && cert.certificates.length > 0 && (
            <div>
              {cert.certificates.map((c, i) => {
                const daysLeft = c.validTo ? getDaysUntilExpiry(c.validTo.iso) : null;
                const severity = daysLeft !== null ? getSeverity(daysLeft) : null;

                return (
                  <div key={i} style={{ marginBottom: i < cert.certificates.length - 1 ? "16px" : 0 }}>
                    <div className="kv" style={{ paddingTop: "0" }}>
                      <span className="k">Level</span>
                      <span className="v">{i === 0 ? "Leaf" : i === cert.certificates.length - 1 ? "Root" : "Intermediate"}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Subject</span>
                      <span className="v" style={{ fontSize: "11px", wordBreak: "break-all" }}>{c.subject}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Issuer</span>
                      <span className="v" style={{ fontSize: "11px", wordBreak: "break-all" }}>{c.issuer}</span>
                    </div>
                    {c.validFrom && (
                      <div className="kv">
                        <span className="k">Valid From</span>
                        <span className="v">{c.validFrom.display}</span>
                      </div>
                    )}
                    {c.validTo && (
                      <div className="kv">
                        <span className="k">Valid Until</span>
                        <span className="v" style={{ color: severity?.color }}>
                          {severity?.icon} {c.validTo.display}
                        </span>
                      </div>
                    )}
                    {c.validTo && (
                      <div className="kv">
                        <span className="k">Days Left</span>
                        <span className="v" style={{ color: severity?.color, fontWeight: "600" }}>
                          {getDaysUntilExpiry(c.validTo.iso)} days
                        </span>
                      </div>
                    )}
                    <div className="kv">
                      <span className="k">Key Algorithm</span>
                      <span className="v">{c.keyAlgorithm}</span>
                    </div>
                    {c.keySize && (
                      <div className="kv">
                        <span className="k">Key Size</span>
                        <span className="v">{c.keySize} bits</span>
                      </div>
                    )}
                    <div className="kv">
                      <span className="k">Signature Algorithm</span>
                      <span className="v" style={{ fontSize: "11px" }}>{c.signatureAlgorithm}</span>
                    </div>
                    <div className="kv" style={{ borderBottom: "0" }}>
                      <span className="k">Serial</span>
                      <span className="v" style={{ fontSize: "10px", fontFamily: "var(--mono)" }}>{c.serialNumber.slice(0, 16)}...</span>
                    </div>
                    {i < cert.certificates.length - 1 && <div style={{ height: "1px", background: "var(--line2)", marginTop: "12px" }} />}
                  </div>
                );
              })}

              <div className="note i" style={{ marginTop: "16px" }}>
                <b>Chain Analysis:</b> {cert.certificates.length} certificate{cert.certificates.length !== 1 ? "s" : ""} in chain
              </div>
            </div>
          )}

          {cert && cert.tlsData && (
            <div>
              <div className="kv">
                <span className="k">Host</span>
                <span className="v">{cert.domain}</span>
              </div>
              <div className="kv">
                <span className="k">Status</span>
                <span className="v">{cert.tlsData.status || "Checking..."}</span>
              </div>
              <div className="empty" style={{ marginTop: "12px" }}>
                <p style={{ fontSize: "12px" }}>Full SSL Labs analysis in progress. Check back in a moment for complete details.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
