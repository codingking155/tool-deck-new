/** Tool registry — the only place a tool is declared. Adding a tool here plus a
    lazy component in App.jsx is the entire wiring. FAQs feed both the visible
    section and the FAQPage JSON-LD. */

export const TOOLS = [
  { id: "utc", cat: "Time & network", icon: "🕐", big: true, c: "#F97316", name: "UTC Wait-Time Generator", desc: "Day-wise UTC wait schedules with live countdowns, weekend highlighting and CSV export — plus an order → target send wait calculator with an hourly UTC table.", pv: "utc",
    blurb: "Build day-wise UTC wait schedules with live countdowns, weekend highlighting and CSV export, plus an order → target send calculator that gives the wait between an order time and the next send time with an hourly UTC table. Runs entirely in your browser.",
    faqs: [
      ["How do I convert a UTC time to my local time?", "Enter the UTC start time and your timezone; every row shows the matching local time and date, updated live."],
      ["How is the order → target send wait calculated?", "Pick the customer's timezone, the order date and time, and the target send time. The tool finds the next matching local send time after the order (or on a fixed send date you choose) and shows the wait, both UTC timestamps and an hourly table, with daylight-saving handled per row."],
      ["Does the schedule highlight weekends?", "Yes — the day-wise schedule tints weekend rows so you can spot them."],
      ["Can I export the schedule?", "Yes — copy the whole table or download it as CSV. Nothing you enter is stored anywhere."],
    ] },
  { id: "phone", cat: "Time & network", icon: "📞", c: "#06B6D4", name: "Phone → Country", desc: "Paste any number, instantly see its country, flag, formats and timezone.", pv: "globe",
    blurb: "Paste any phone number to instantly see its country, flag, international and E.164 formats, and local timezone. Detection is by dialing prefix and never reveals the owner or live location.",
    faqs: [
      ["How do you find the country of a phone number?", "The tool reads the international dialing prefix (like +91 or +44) and matches it against an indexed list of country codes."],
      ["Can this tool locate a person?", "No. It only shows the numbering country or region a number belongs to — never the owner, device, or live location."],
      ["Do I need the + prefix?", "Adding the international prefix gives the most accurate result. Without it, the tool marks the guess as assumed."],
    ] },
  { id: "shopify", cat: "Shopping & web", icon: "🛍️", c: "#22C55E", name: "Shopify Detector", desc: "18-signal scan with shop domain, theme, currency and a live API for automation.", pv: "scan",
    blurb: "Check whether any website runs Shopify. Eighteen independent signals — page markers, response headers and live storefront endpoints — score into one confidence value, plus shop domain, theme, currency and Shopify Plus detection. Works from a URL, or pasted page source when a site blocks direct reads. Also exposes a JSON API for CRM, Zapier and n8n.",
    faqs: [
      ["How can I tell if a website uses Shopify?", "Scan the store URL; the tool checks eighteen markers — CDN assets, checkout endpoints, response headers and live endpoint probes — then scores a confidence value, alongside shop domain, theme and currency when detectable."],
      ["Is the Shopify checker free?", "Yes, it's free and needs no sign-up. With the server API deployed it reads response headers server-side (the strongest evidence); otherwise it tries the site directly, falls back to read-only proxies, and can also read pasted page source."],
      ["Why does a check sometimes fail?", "Some stores block cross-origin reads or hide markers behind a headless front end. Paste the page source (Ctrl+U) or deploy the server API for one-click, header-based checks."],
      ["Can I automate this — CRM, Zapier, n8n?", "Yes — deploy the Supabase API and call it as a JSON endpoint; branch your automation on is_shopify. See \"API for CRM / Zapier / n8n\" inside the tool for the exact request/response shape."],
    ] },
  { id: "shopifydetector", cat: "Shopping & web", icon: "🔍", c: "#FF6B35", name: "Shopify Store Detector", desc: "Instantly verify if a website is powered by Shopify with API-backed detection.", pv: "scan",
    blurb: "Detect whether any website is running Shopify in seconds. Enter a URL and get instant results with confidence score, shop domain, and technical signals. Powered by the ShopifyOrNot API.",
    faqs: [
      ["What does the Shopify detector do?", "Enter a website URL and the tool checks if it's a Shopify store, returning a confidence score, detected shop domain, and technical signals."],
      ["How accurate is the detection?", "The detection uses the external ShopifyOrNot API which analyzes response headers, body content, and other technical markers to determine Shopify usage with a confidence percentage."],
      ["Can I check multiple stores at once?", "Currently the tool checks one URL at a time. Enter the domain and wait for the result, then check another if needed."],
    ] },
  { id: "speed", cat: "Time & network", icon: "⚡", c: "#EAB308", name: "Internet Speed Test", desc: "Download, upload, idle and loaded latency, jitter — with honest Unavailable for what browsers can't measure.", pv: "gauge",
    blurb: "Measure ping, jitter, download and upload speed from your browser against a global edge network — no redirects, no app. A full run transfers roughly 20–35 MB.",
    faqs: [
      ["How much data does a speed test use?", "A full run transfers roughly 20–35 MB. There's also a demo run that uses no data."],
      ["What is a good ping and download speed?", "Under 60 ms ping suits gaming; 25 Mbps download handles 4K streaming; 20 Mbps down and 5 up covers most work-from-home needs."],
      ["Why did the test not run?", "Sandboxed previews block outside network calls. Deploy the site or open it directly and it runs against the live measurement endpoints."],
    ] },
  { id: "ip", cat: "Time & network", icon: "🌐", c: "#8B5CF6", name: "My IP & IPv6 Test", desc: "Public IPv4/IPv6, ISP, and honest IPv6 guidance with enable steps.", pv: "packets",
    blurb: "See your public IPv4 and IPv6 addresses, ISP, and browser details, with honest guidance and step-by-step instructions for enabling IPv6 on Android, iPhone, Windows, macOS and routers.",
    faqs: [
      ["How do I check if IPv6 is enabled?", "Run the check; if a public IPv6 address is detected, your connection is dual-stack. If not, the panel shows how to enable it per device."],
      ["Does IPv6 make the internet faster?", "Not by itself. IPv6 gives a far larger address space and can improve direct connectivity, but speed depends on your ISP, router and device."],
      ["Is my IP address stored?", "No. Addresses are read from the network and shown only to you; this page never logs them."],
    ] },
  { id: "price", cat: "Shopping & web", icon: "📉", c: "#EC4899", name: "Price Tracker", desc: "Live Amazon prices, recorded price history, drop alerts.", pv: "chart",
    blurb: "Paste an Amazon product link to see its live price, the real price history we've recorded, lowest / highest / average analytics, and set a target-price alert.",
    faqs: [
      ["How do I track an Amazon price?", "Paste the product link — any format, including app share links. You get the live price, availability and the history recorded so far, and the product keeps being checked automatically."],
      ["Where does the price history come from?", "Only from real readings: ToolDeck checks each tracked product every few hours, and where a licensed history provider is connected, its earlier recorded prices are imported with their original dates. Nothing is estimated or filled in."],
      ["Can I get an alert when the price drops?", "Yes. Set a target price and we'll notify you by email or WhatsApp when a live check finds the price at or below it."],
    ] },
  { id: "breach", cat: "Security", icon: "🛡️", c: "#14B8A6", name: "Breach Checker", desc: "See if your email appeared in a data breach, and whether a password has leaked.", pv: "scan",
    blurb: "Check an email address against the XposedOrNot breach database to see which breaches exposed it and what data leaked, and test a password against Have I Been Pwned's Pwned Passwords without it ever leaving your browser.",
    faqs: [
      ["How does the email check work?", "Your address is sent to our server, which looks it up in the XposedOrNot breach database and returns the breaches it appears in. Nothing is stored or logged."],
      ["Is it safe to type my password here?", "Yes. The password is hashed in your browser and only the first 5 characters of the hash are sent (k-anonymity), so neither we nor the service can see it."],
      ["What if no breaches are found?", "It means none are known to the database — not that you're safe. Keep using unique passwords and two-factor authentication."],
      ["Can I check someone else's email?", "Only check addresses you own. Lookups are rate-limited to discourage misuse."],
    ] },
  { id: "pdf", cat: "Documents", icon: "📑", c: "#EF4444", name: "PDF Toolkit", desc: "Merge, split, compress, rotate, watermark and convert PDFs — privately, in your browser.", pv: "scan",
    blurb: "A set of 19 PDF tools: merge, split, remove/extract/reorder pages, compress, repair, OCR, JPG to PDF, PDF to JPG, PDF to Word, rotate, page numbers, watermark, crop, compare, sign and unlock. Everything runs locally in your browser; files are never uploaded.",
    faqs: [
      ["Are my PDFs uploaded anywhere?", "No. Every tool runs in your browser, so your documents stay on your device. The only download is OCR's one-time language model."],
      ["How good is PDF to Word?", "It recovers the text as editable paragraphs and page breaks. Layout, images and tables are not reproduced, and scanned PDFs (no selectable text) can't be converted without OCR."],
      ["Does Compress keep my text selectable?", "No. It re-renders pages as compressed images, which is what makes files much smaller. Use a lower level for better quality."],
      ["Can Unlock remove a password?", "Only restrictions on editing, printing or copying. A PDF that needs a password to open can't be unlocked here."],
      ["Is the signature legally binding?", "Sign PDF stamps a visual signature, like signing on paper. It is not a certificate-based digital signature, so check whether your use case needs one."],
      ["Which tools are missing?", "Anything needing a server: Word/Excel/PowerPoint/HTML to PDF, PDF to PowerPoint/Excel/PDF-A, password protection, redaction and PDF text editing."],
    ] },
];

export const CATEGORIES = ["All", "Time & network", "Shopping & web", "Documents", "Security"];

export const tint = (hex, a) => hex + a; /* hex + alpha suffix, e.g. tint('#F97316','22') */

export const ROTATE = [
  "Generate UTC wait-time schedules", "Find a phone number's country", "Check whether a site runs Shopify",
  "Test your internet speed", "Check if IPv6 is enabled", "Track Amazon prices", "Detect Shopify storefronts",
  "Merge, split and compress PDFs", "Check if your email was in a breach",
];
