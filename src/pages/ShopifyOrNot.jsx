"use client";

import React, { useState, useEffect } from "react";
import { useRoute } from "../hooks/index.js";

export default function ShopifyOrNotPage() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("Please enter a website URL");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/shopify-check?url=" + encodeURIComponent(url));
      if (!response.ok) throw new Error("Failed to check URL");
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err.message || "Error checking URL");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F6F6F6] to-[#FAFAFA]">
      {/* Navbar */}
      <nav className="border-b border-[#E5E5E5] bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold text-[#008060]">ShopifyOrNot</div>
            <span className="text-sm text-[#666666] ml-2">.in</span>
          </div>
          <button className="text-[#008060] font-medium text-sm hover:text-[#006B52]">
            API Docs
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="text-5xl font-bold text-[#1A1A1A] mb-4">
          Is It a <span className="bg-gradient-to-r from-[#008060] to-[#00A56A] bg-clip-text text-transparent">Shopify</span> Store?
        </h1>
        <p className="text-xl text-[#424242] mb-8 max-w-2xl mx-auto">
          Instantly detect Shopify websites. Perfect for sales teams, app developers, and integrations.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mb-12">
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter website URL (e.g., example.com)"
              className="flex-1 px-4 py-3 border border-[#E5E5E5] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008060]"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-gradient-to-r from-[#008060] to-[#00A56A] text-white font-semibold rounded-lg hover:opacity-90 disabled:opacity-50 transition"
            >
              {loading ? "Checking..." : "Check"}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mb-6">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="max-w-2xl mx-auto">
            <div className={`rounded-lg p-8 mb-6 ${result.is_shopify ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
              <div className={`text-4xl font-bold mb-4 ${result.is_shopify ? "text-green-600" : "text-gray-600"}`}>
                {result.is_shopify ? "✓ Shopify Store" : "✗ Not Shopify"}
              </div>
              <div className="text-lg text-gray-700 mb-4">
                Confidence: <span className="font-semibold">{Math.round(result.confidence * 100)}%</span>
              </div>
              {result.shop_domain && (
                <div className="text-gray-600">
                  Shop Domain: <span className="font-semibold">{result.shop_domain}</span>
                </div>
              )}
              {result.theme && (
                <div className="text-gray-600 mt-2">
                  Theme: <span className="font-semibold">{result.theme}</span>
                </div>
              )}
              {result.platform && (
                <div className="text-gray-600 mt-2">
                  Platform Detected: <span className="font-semibold">{result.platform}</span>
                </div>
              )}
              <div className="text-sm text-gray-500 mt-4">
                Response time: {result.elapsed_ms}ms
              </div>
            </div>

            {/* Signals */}
            {result.detected_signals && result.detected_signals.length > 0 && (
              <div className="max-w-2xl mx-auto">
                <h3 className="text-lg font-semibold text-[#1A1A1A] mb-4 text-left">
                  Detected Signals ({result.detected_signals.length})
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {result.detected_signals.map((signal, idx) => (
                    <div key={idx} className="bg-white border border-[#E5E5E5] rounded-lg p-3 text-left text-sm text-[#424242]">
                      ✓ {signal}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Detection Methods */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-bold text-[#1A1A1A] mb-8 text-center">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { title: "HTML Analysis", desc: "Scans page markup for Shopify indicators" },
            { title: "Headers Detection", desc: "Checks response headers from the server" },
            { title: "Live Probes", desc: "Queries Shopify endpoints for verification" },
          ].map((method, idx) => (
            <div key={idx} className="bg-white rounded-lg border border-[#E5E5E5] p-6 text-center">
              <div className="text-4xl font-bold text-[#008060] mb-4">{idx + 1}</div>
              <h3 className="text-lg font-semibold text-[#1A1A1A] mb-2">{method.title}</h3>
              <p className="text-[#666666]">{method.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#E5E5E5] bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-sm text-[#666666]">
          <p>ShopifyOrNot.in - Detect Shopify stores instantly</p>
          <p className="mt-2">Powered by ToolDeck</p>
        </div>
      </footer>
    </div>
  );
}
