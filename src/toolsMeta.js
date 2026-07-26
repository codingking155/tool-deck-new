/** Tool registry — the only place a tool is declared. Adding a tool here plus a
    lazy component in App.jsx is the entire wiring. FAQs feed both the visible
    section and the FAQPage JSON-LD. */

export const TOOLS = [
  { id: "utc", icon: "🕐", big: true, c: "#F97316", name: "UTC Wait-Time Generator", desc: "Day-wise UTC wait schedules with live countdowns, weekend highlighting, CSV export — plus an order → notification mode that skips weekends.", pv: "utc",
    blurb: "Build day-wise UTC wait schedules with live countdowns, weekend highlighting and CSV export, plus an order → notification mode that skips weekends. Runs entirely in your browser.",
    faqs: [
      ["How do I convert a UTC time to my local time?", "Enter the UTC start time and your timezone; every row shows the matching local time and date, updated live."],
      ["Does the schedule skip weekends?", "The order → notification mode moves Saturday and Sunday sends to Monday. The day-wise schedule tints weekend rows so you can spot them."],
      ["Can I export the schedule?", "Yes — copy the whole table or download it as CSV. Nothing you enter is stored anywhere."],
    ] },
  { id: "phone", icon: "📞", c: "#06B6D4", name: "Phone → Country", desc: "Paste any number, instantly see its country, flag, formats and timezone.", pv: "globe",
    blurb: "Paste any phone number to instantly see its country, flag, international and E.164 formats, and local timezone. Detection is by dialing prefix and never reveals the owner or live location.",
    faqs: [
      ["How do you find the country of a phone number?", "The tool reads the international dialing prefix (like +91 or +44) and matches it against an indexed list of country codes."],
      ["Can this tool locate a person?", "No. It only shows the numbering country or region a number belongs to — never the owner, device, or live location."],
      ["Do I need the + prefix?", "Adding the international prefix gives the most accurate result. Without it, the tool marks the guess as assumed."],
    ] },
  { id: "shopify", icon: "🛍️", c: "#22C55E", name: "Shopify Detector", desc: "Nine-signal scan with a confidence score for any storefront.", pv: "scan",
    blurb: "Check whether any website runs Shopify. Nine independent signals are scored into one confidence value, with Shopify Plus and theme detection. Works from a URL or pasted page source.",
    faqs: [
      ["How can I tell if a website uses Shopify?", "Scan the store URL; the tool looks for nine markers such as the Shopify CDN, checkout endpoints, and the window.Shopify object, then scores a confidence value."],
      ["Is the Shopify checker free?", "Yes, it's free and needs no sign-up. It tries the site directly, falls back to read-only proxies, and can also read pasted page source."],
      ["Why does a check sometimes fail?", "Some stores block cross-origin reads. Paste the page source (Ctrl+U) or deploy your own server proxy for one-click checks."],
    ] },
  { id: "speed", icon: "⚡", c: "#EAB308", name: "Internet Speed Test", desc: "Download, upload, idle and loaded latency, jitter — with honest Unavailable for what browsers can't measure.", pv: "gauge",
    blurb: "Measure ping, jitter, download and upload speed from your browser against Cloudflare's public edge — no redirects, no app. A full run transfers roughly 20–35 MB.",
    faqs: [
      ["How much data does a speed test use?", "A full run transfers roughly 20–35 MB. There's also a demo run that uses no data."],
      ["What is a good ping and download speed?", "Under 60 ms ping suits gaming; 25 Mbps download handles 4K streaming; 20 Mbps down and 5 up covers most work-from-home needs."],
      ["Why did the test not run?", "Sandboxed previews block outside network calls. Deploy the site or open it directly and it runs against Cloudflare's endpoints."],
    ] },
  { id: "ip", icon: "🌐", c: "#8B5CF6", name: "My IP & IPv6 Test", desc: "Public IPv4/IPv6, ISP, and honest IPv6 guidance with enable steps.", pv: "packets",
    blurb: "See your public IPv4 and IPv6 addresses, ISP, and browser details, with honest guidance and step-by-step instructions for enabling IPv6 on Android, iPhone, Windows, macOS and routers.",
    faqs: [
      ["How do I check if IPv6 is enabled?", "Run the check; if a public IPv6 address is detected, your connection is dual-stack. If not, the panel shows how to enable it per device."],
      ["Does IPv6 make the internet faster?", "Not by itself. IPv6 gives a far larger address space and can improve direct connectivity, but speed depends on your ISP, router and device."],
      ["Is my IP address stored?", "No. Addresses are read from the network and shown only to you; this page never logs them."],
    ] },
  { id: "price", icon: "📉", c: "#EC4899", name: "Price Tracker", desc: "Amazon & Flipkart price history, 30-day to 5-year analytics, alerts.", pv: "chart",
    blurb: "Track Amazon.in and Flipkart price history from 30 days to 5 years, with lowest, highest and average analytics, a buy verdict, and target-price alerts. Preview uses simulated data.",
    faqs: [
      ["How do I track an Amazon or Flipkart price?", "Paste the product URL to see its price history, min/max/average analytics and a buy verdict. The live preview uses simulated data."],
      ["Is real price history accurate?", "Real tracking needs a backend with licensed price feeds and genuinely recorded history — analytics are only honest once that range has actually been recorded."],
      ["Can I get an alert when the price drops?", "Set a target price; alerts deliver by email or WhatsApp through the Supabase backend."],
    ] },
];

export const tint = (hex, a) => hex + a; /* hex + alpha suffix, e.g. tint('#F97316','22') */

export const ROTATE = [
  "Generate UTC wait-time schedules", "Find a phone number's country", "Check whether a site runs Shopify",
  "Test your internet speed", "Check if IPv6 is enabled", "Track Amazon & Flipkart prices",
];
