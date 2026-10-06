/** Tool registry — the only place a tool is declared. `beta: true` marks a tool that is
    not fully functional yet: it gets a Beta badge everywhere and is listed last. Adding a tool here plus a
    lazy component in App.jsx is the entire wiring. FAQs feed both the visible
    section and the FAQPage JSON-LD. */

export const TOOLS = [
  { id: "utc", where: "device", cat: "Time & network", icon: "🕐", big: true, c: "#F97316", name: "UTC Wait-Time Generator", desc: "Wait time from an order to the next send time in any timezone — UTC timestamps, an hourly table, weekend skipping and calendar export.", pv: "utc",
    blurb: "Work out the wait between an order and the next target send time in any timezone, with both UTC timestamps, a live countdown, an hourly what-if table, optional weekend skipping and .ics or Google Calendar export. Runs entirely in your browser.",
    faqs: [
      ["How is the wait calculated?", "Pick the customer's timezone, the order date and time, and the target send time. The tool finds the next matching local send time after the order, or uses a fixed send date if you set one, and shows the wait with both UTC timestamps."],
      ["What is the hourly table for?", "It shows the same calculation for orders placed each hour over the next 24 hours, so you can see how the wait changes through the day. Each row uses its own local date and GMT offset, so daylight-saving changes are handled."],
      ["Can it skip weekends?", "Yes. Turn on Skip weekends and any send that would land on Saturday or Sunday moves to Monday. It is off by default."],
      ["Can I add the send time to my calendar?", "Yes — download an .ics file or open a pre-filled Google Calendar event. Nothing you enter is stored anywhere, and presets stay on your device."],
    ] },
  { id: "phone", where: "device", cat: "Time & network", icon: "📞", c: "#06B6D4", name: "Phone → Country", desc: "Paste any number, instantly see its country, flag, formats and timezone.", pv: "globe",
    blurb: "Paste any phone number to instantly see its country, flag, international and E.164 formats, and local timezone. Detection is by dialing prefix and never reveals the owner or live location.",
    faqs: [
      ["How do you find the country of a phone number?", "The tool reads the international dialing prefix (like +91 or +44) and matches it against an indexed list of country codes."],
      ["Can this tool locate a person?", "No. It only shows the numbering country or region a number belongs to — never the owner, device, or live location."],
      ["Do I need the + prefix?", "Adding the international prefix gives the most accurate result. Without it, the tool marks the guess as assumed."],
    ] },
  { id: "shopifydetector", where: "server", cat: "Shopping & web", icon: "🔍", c: "#FF6B35", name: "Shopify Store Detector", desc: "Instantly verify if a website is powered by Shopify with API-backed detection.", pv: "lens",
    blurb: "Detect whether any website is running Shopify in seconds. Enter a URL and get instant results with confidence score, shop domain, and technical signals. Runs on ToolDeck's own detection service.",
    faqs: [
      ["What does the Shopify detector do?", "Enter a website URL and the tool checks if it's a Shopify store, returning a confidence score, detected shop domain, and technical signals."],
      ["How accurate is the detection?", "ToolDeck's own detection service checks response headers, page markup and live Shopify endpoints (/cart.js, /products.json) to determine Shopify usage with a confidence percentage."],
      ["Can I check multiple stores at once?", "Currently the tool checks one URL at a time. Enter the domain and wait for the result, then check another if needed."],
    ] },
  { id: "speed", where: "server", cat: "Time & network", icon: "⚡", c: "#EAB308", name: "Internet Speed Test", desc: "Download, upload, idle and loaded latency, jitter — with honest Unavailable for what browsers can't measure.", pv: "gauge",
    blurb: "Measure ping, jitter, download and upload speed from your browser against a global edge network — no redirects, no app. A full run transfers roughly 20–35 MB.",
    faqs: [
      ["How much data does a speed test use?", "A full run transfers roughly 20–35 MB. There's also a demo run that uses no data."],
      ["What is a good ping and download speed?", "Under 60 ms ping suits gaming; 25 Mbps download handles 4K streaming; 20 Mbps down and 5 up covers most work-from-home needs."],
      ["Why did the test not run?", "Sandboxed previews block outside network calls. Deploy the site or open it directly and it runs against the live measurement endpoints."],
    ] },
  { id: "ip", where: "server", cat: "Time & network", icon: "🌐", c: "#8B5CF6", name: "My IP & IPv6 Test", desc: "Public IPv4/IPv6, ISP, and honest IPv6 guidance with enable steps.", pv: "packets",
    blurb: "See your public IPv4 and IPv6 addresses, ISP, and browser details, with honest guidance for enabling IPv6 on Android, iPhone, Windows, macOS and routers — plus WebRTC and DNS leak checks to see whether a VPN is really hiding you.",
    faqs: [
      ["How do I check if IPv6 is enabled?", "Open this tool — it checks automatically. It asks an IPv6-only server for your address, so if one is detected, your connection is dual-stack. If not, the panel shows how to enable it per device."],
      ["Does IPv6 make the internet faster?", "Not by itself. IPv6 gives a far larger address space and can improve direct connectivity, but speed depends on your ISP, router and device."],
      ["What do the leak checks tell me?", "The WebRTC check shows whether your browser exposes a public or local address that differs from what websites see. The DNS check lists which DNS servers answer your lookups, so you can tell whether a VPN is handling them or your ISP still is."],
      ["Is my IP address stored?", "No. Addresses are read from the network and shown only to you; this page never logs them."],
    ] },
  { id: "json", where: "device", cat: "Developer", icon: "{ }", c: "#06B6D4", name: "JSON Formatter & Validator", desc: "Format, validate and auto-fix JSON — tree view, compare, query, TypeScript & JSON Schema generation.", pv: "braces",
    blurb: "Validate JSON as you type with the exact line of any error, and auto-fix broken JSON (trailing commas, single quotes, comments, unquoted keys). Beautify or minify, explore a searchable tree, compare two documents, query with JSONPath, and generate TypeScript interfaces, JSON Schema, YAML or CSV. Large IDs are kept exactly. Runs entirely in your browser.",
    faqs: [
      ["How do I fix invalid JSON?", "The validator shows the line and column of the first problem in plain words and marks the line. Auto-fix repairs common mistakes — trailing or missing commas, single or curly quotes, comments, unquoted keys, Python True/None, NaN and unclosed brackets — and lists every change it made."],
      ["Why do large numbers change in other formatters?", "JavaScript can only represent integers exactly up to 2⁵³ (about 9 quadrillion), so most tools silently round long IDs like 98765432109876543210. This tool keeps the original digits in every output."],
      ["How does Compare work?", "Paste two versions and you get every added, removed and changed value with its path. Key order is ignored, and arrays of objects with an id, _id, uuid or key field are matched by that field, so a reordered list isn't reported as all changed."],
      ["Can I generate TypeScript types from JSON?", "Yes — Convert → TypeScript interfaces. All items in an array are merged, so fields missing from some items become optional and mixed types become unions. JSON Schema (draft 2020-12) works the same way."],
      ["Is my JSON stored or uploaded?", "No. Everything runs in your browser; nothing is sent anywhere or saved."],
    ] },
  { id: "password", where: "mixed", cat: "Security", icon: "🔐", c: "#F59E0B", name: "Password Strength Checker", desc: "Client-side entropy calculation + HaveIBeenPwned breach check (k-anonymity).", pv: "dots",
    blurb: "Check password strength with client-side entropy calculation (charset and length). Verify against HaveIBeenPwned's 700+ million breached passwords using k-anonymity (your password is never sent to any API).",
    faqs: [
      ["How do you calculate password strength?", "By entropy: bits = log₂(charset size ^ password length). We check for lowercase, uppercase, digits, and special characters. 80+ bits resists brute force for years."],
      ["Is my password safe to check?", "Yes. The password stays on your device. HIBP check uses k-anonymity: we hash it locally, send only the first 5 hash characters, and check the response locally."],
      ["What does 'Not breached' mean?", "The password isn't in HIBP's public breach data (700+ million passwords from confirmed leaks). But always use a unique password per account."],
      ["What if HIBP is unavailable?", "The entropy check still works offline. If HIBP is down, try again later — the API has 99.9% uptime."],
    ] },
  { id: "prompt", where: "device", cat: "Developer", icon: "✨", c: "#A855F7", name: "AI Prompt Generator", desc: "Turn a rough idea into a structured prompt for ChatGPT, Claude or Gemini — templates, plain/Markdown/XML output.", pv: "spark",
    blurb: "Build clear, structured prompts for ChatGPT, Claude, Gemini and other AI assistants. Fill in the role, task, context, audience, tone, format and rules — or start from a template — and copy a ready-to-use prompt as plain text, Markdown or XML. Runs entirely in your browser.",
    faqs: [
      ["What makes a good AI prompt?", "A clear task plus the context the AI can't guess: who it's for, the tone, the output format and any rules. An example of a good answer helps most of all."],
      ["Which structure should I pick?", "Plain text works everywhere. Markdown sections and XML tags help with long prompts — Claude in particular follows XML-tagged sections well."],
      ["Is what I type sent anywhere?", "No. The prompt is assembled in your browser and nothing is stored or sent until you paste it into an assistant yourself."],
    ] },
  { id: "image", where: "device", cat: "Files & documents", icon: "🖼️", c: "#14B8A6", name: "Image Compressor & Converter", desc: "Compress, resize, crop, convert, rotate, watermark, edit, meme and blur images — in your browser, nothing uploaded.", pv: "image",
    blurb: "Nine image tools in one: compress, resize, crop, convert (JPG, PNG, WebP, AVIF), rotate & flip, watermark, photo editor, meme maker and blur/redact. Batch up to 40 images and download them as a ZIP. Everything runs locally in your browser, so your photos never leave your device.",
    faqs: [
      ["Are my images uploaded anywhere?", "No. Every tool runs on your device using the browser's canvas — files are never sent to a server."],
      ["How do I compress an image without losing quality?", "Use Compress and keep quality around 70–80 for JPG or WebP; the difference is rarely visible. PNG is lossless, so switch the output to WebP or JPG, or set a max width, for large savings."],
      ["Which formats can I convert between?", "Open JPG, PNG, WebP, GIF (first frame), BMP, SVG or AVIF and convert to JPG, PNG or WebP — plus AVIF in browsers that can encode it, such as Chrome and Edge."],
      ["Can it remove backgrounds or upscale with AI?", "Not here. Those need AI models or server processing, which would mean uploading your images; this tool stays fully private."],
    ] },
  { id: "breach", where: "mixed", cat: "Security", icon: "🛡️", c: "#14B8A6", name: "Breach Checker", desc: "See if your email appeared in a data breach, and whether a password has leaked.", pv: "shield",
    blurb: "Check an email address against the XposedOrNot breach database to see which breaches exposed it and what data leaked, and test a password against Have I Been Pwned's Pwned Passwords without it ever leaving your browser.",
    faqs: [
      ["How does the email check work?", "Your address is sent to our server, which looks it up in the XposedOrNot breach database and returns the breaches it appears in. Nothing is stored or logged."],
      ["Is it safe to type my password here?", "Yes. The password is hashed in your browser and only the first 5 characters of the hash are sent (k-anonymity), so neither we nor the service can see it."],
      ["What if no breaches are found?", "It means none are known to the database — not that you're safe. Keep using unique passwords and two-factor authentication."],
      ["Can I check someone else's email?", "Only check addresses you own. Lookups are rate-limited to discourage misuse."],
    ] },
  { id: "pdf", where: "device", cat: "Files & documents", icon: "📑", c: "#EF4444", name: "PDF Toolkit", desc: "Merge, split, compress, rotate, watermark and convert PDFs — privately, in your browser.", pv: "pages",
    blurb: "A set of 20 PDF tools: merge, split, remove/extract/reorder pages, compress, repair, OCR, JPG to PDF, PDF to JPG, PDF to Word, rotate, page numbers, watermark, crop, compare, sign, protect and unlock. Everything runs locally in your browser; files are never uploaded.",
    faqs: [
      ["Are my PDFs uploaded anywhere?", "No. Every tool runs in your browser, so your documents stay on your device. The only download is OCR's one-time language model."],
      ["How good is PDF to Word?", "It recovers the text as editable paragraphs and page breaks. Layout, images and tables are not reproduced, and scanned PDFs (no selectable text) can't be converted without OCR."],
      ["Does Compress keep my text selectable?", "No. It re-renders pages as compressed images, which is what makes files much smaller. Use a lower level for better quality."],
      ["Can Unlock remove a password?", "Yes, if you know it: enter the password and the PDF is saved without encryption. Without the password it can only remove edit, print and copy restrictions from PDFs that open freely — it cannot crack or guess passwords."],
      ["Is the signature legally binding?", "Sign PDF stamps a visual signature, like signing on paper. It is not a certificate-based digital signature, so check whether your use case needs one."],
      ["Which tools are missing?", "Anything needing a server: Word/Excel/PowerPoint/HTML to PDF, PDF to PowerPoint/Excel/PDF-A, redaction and PDF text editing."],
    ] },
  /* ── beta: depends on setup that isn't verified end-to-end yet; listed last ── */
  { id: "price", beta: true, where: "server", cat: "Shopping & web", icon: "📉", c: "#EC4899", name: "Price Tracker", desc: "Live Amazon prices, recorded price history, drop alerts.", pv: "chart",
    blurb: "Paste an Amazon product link to see its live price, the real price history we've recorded, lowest / highest / average analytics, and set a target-price alert.",
    faqs: [
      ["How do I track an Amazon price?", "Paste the product link — any format, including app share links. You get the live price, availability and the history recorded so far, and the product keeps being checked automatically."],
      ["Where does the price history come from?", "Only from real readings: ToolDeck checks each tracked product every few hours, and where a licensed history provider is connected, its earlier recorded prices are imported with their original dates. Nothing is estimated or filled in."],
      ["Can I get an alert when the price drops?", "Yes. Set a target price and we'll notify you by email or WhatsApp when a live check finds the price at or below it."],
    ] },
  { id: "ssl", beta: true, where: "server", cat: "Security", icon: "🔒", c: "#22C55E", name: "SSL Certificate Checker", desc: "Check whether a site's HTTPS certificate is trusted right now, and when it expires.", pv: "lock",
    blurb: "Enter a domain to test a live TLS handshake (is the certificate trusted, unexpired and issued for that name?) and see the latest certificate logged for it in public Certificate Transparency logs: issuer, validity dates, covered names and days to expiry.",
    faqs: [
      ["How does the check work?", "Our server opens a real TLS connection to the domain on port 443. If the handshake succeeds, browsers will trust the certificate today. If it fails, you see why: expired, not yet valid, issued for a different name, untrusted issuer or unreachable."],
      ["Where do the certificate details come from?", "From public Certificate Transparency logs, which every publicly trusted certificate must appear in. The tool shows the most recent unexpired certificate logged for the domain (or its wildcard), with issuer, validity dates and the names it covers."],
      ["What does 'Days left' mean?", "Days until that certificate expires. Under 30 days is flagged as a warning and under 7 days as critical; most sites renew automatically well before then."],
      ["Can I check internal or IP-only hosts?", "No. To keep the checker from being used to probe private networks, only public domain names are accepted."],
    ] },
];

export const BETA_HINT = "This tool is still being finished — results may sometimes be unavailable or incomplete.";

export const CATEGORIES = ["All", "Time & network", "Shopping & web", "Files & documents", "Developer", "Security"];

export const WHERE_LABEL = {
  device: ["On-device", "Runs entirely in your browser; your input is never sent anywhere."],
  server: ["Uses network", "Needs our server or a third-party service to work."],
  mixed: ["Mixed", "Mostly on-device; some checks use our server or a privacy-preserving third-party lookup."],
};

export const tint = (hex, a) => hex + a; /* hex + alpha suffix, e.g. tint('#F97316','22') */

export const ROTATE = [
  "Calculate order-to-send wait times in UTC", "Find a phone number's country", "Check whether a site runs Shopify",
  "Test your internet speed", "Check if IPv6 is enabled", "Track Amazon prices", "Validate and format JSON",
  "Check password strength and breaches", "Generate better AI prompts", "Compress and convert images",
  "Merge, split and compress PDFs", "Detect Shopify storefronts", "Check if your email was in a breach",
];
