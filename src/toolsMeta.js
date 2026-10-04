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
  { id: "shopify", icon: "🛍️", c: "#22C55E", name: "Shopify Detector", desc: "18-signal scan with shop domain, theme, currency and a live API for automation.", pv: "scan",
    blurb: "Check whether any website runs Shopify. Eighteen independent signals — page markers, response headers and live storefront endpoints — score into one confidence value, plus shop domain, theme, currency and Shopify Plus detection. Works from a URL, or pasted page source when a site blocks direct reads. Also exposes a JSON API for CRM, Zapier and n8n.",
    faqs: [
      ["How can I tell if a website uses Shopify?", "Scan the store URL; the tool checks eighteen markers — CDN assets, checkout endpoints, response headers and live endpoint probes — then scores a confidence value, alongside shop domain, theme and currency when detectable."],
      ["Is the Shopify checker free?", "Yes, it's free and needs no sign-up. With the server API deployed it reads response headers server-side (the strongest evidence); otherwise it tries the site directly, falls back to read-only proxies, and can also read pasted page source."],
      ["Why does a check sometimes fail?", "Some stores block cross-origin reads or hide markers behind a headless front end. Paste the page source (Ctrl+U) or deploy the server API for one-click, header-based checks."],
      ["Can I automate this — CRM, Zapier, n8n?", "Yes — deploy the Supabase API and call it as a JSON endpoint; branch your automation on is_shopify. See \"API for CRM / Zapier / n8n\" inside the tool for the exact request/response shape."],
    ] },
  { id: "shopifydetector", icon: "🔍", c: "#FF6B35", name: "Shopify Store Detector", desc: "Instantly verify if a website is powered by Shopify with API-backed detection.", pv: "scan",
    blurb: "Detect whether any website is running Shopify in seconds. Enter a URL and get instant results with confidence score, shop domain, and technical signals. Powered by the ShopifyOrNot API.",
    faqs: [
      ["What does the Shopify detector do?", "Enter a website URL and the tool checks if it's a Shopify store, returning a confidence score, detected shop domain, and technical signals."],
      ["How accurate is the detection?", "The detection uses the external ShopifyOrNot API which analyzes response headers, body content, and other technical markers to determine Shopify usage with a confidence percentage."],
      ["Can I check multiple stores at once?", "Currently the tool checks one URL at a time. Enter the domain and wait for the result, then check another if needed."],
    ] },
  { id: "speed", icon: "⚡", c: "#EAB308", name: "Internet Speed Test", desc: "Download, upload, idle and loaded latency, jitter — with honest Unavailable for what browsers can't measure.", pv: "gauge",
    blurb: "Measure ping, jitter, download and upload speed from your browser against a global edge network — no redirects, no app. A full run transfers roughly 20–35 MB.",
    faqs: [
      ["How much data does a speed test use?", "A full run transfers roughly 20–35 MB. There's also a demo run that uses no data."],
      ["What is a good ping and download speed?", "Under 60 ms ping suits gaming; 25 Mbps download handles 4K streaming; 20 Mbps down and 5 up covers most work-from-home needs."],
      ["Why did the test not run?", "Sandboxed previews block outside network calls. Deploy the site or open it directly and it runs against the live measurement endpoints."],
    ] },
  { id: "ip", icon: "🌐", c: "#8B5CF6", name: "My IP & IPv6 Test", desc: "Public IPv4/IPv6, ISP, and honest IPv6 guidance with enable steps.", pv: "packets",
    blurb: "See your public IPv4 and IPv6 addresses, ISP, and browser details, with honest guidance and step-by-step instructions for enabling IPv6 on Android, iPhone, Windows, macOS and routers.",
    faqs: [
      ["How do I check if IPv6 is enabled?", "Run the check; if a public IPv6 address is detected, your connection is dual-stack. If not, the panel shows how to enable it per device."],
      ["Does IPv6 make the internet faster?", "Not by itself. IPv6 gives a far larger address space and can improve direct connectivity, but speed depends on your ISP, router and device."],
      ["Is my IP address stored?", "No. Addresses are read from the network and shown only to you; this page never logs them."],
    ] },
  { id: "price", icon: "📉", c: "#EC4899", name: "Price Tracker", desc: "Live Amazon prices, recorded price history, drop alerts.", pv: "chart",
    blurb: "Paste an Amazon product link to see its live price, the real price history we've recorded, lowest / highest / average analytics, and set a target-price alert.",
    faqs: [
      ["How do I track an Amazon price?", "Paste the product link — any format, including app share links. You get the live price, availability and the history recorded so far, and the product keeps being checked automatically."],
      ["Where does the price history come from?", "Only from real readings: ToolDeck checks each tracked product every few hours, and where a licensed history provider is connected, its earlier recorded prices are imported with their original dates. Nothing is estimated or filled in."],
      ["Can I get an alert when the price drops?", "Yes. Set a target price and we'll notify you by email or WhatsApp when a live check finds the price at or below it."],
    ] },
  { id: "json", icon: "{ }", c: "#06B6D4", name: "JSON Formatter & Validator", desc: "Format, validate, minify and beautify JSON — exact error line, sort keys, YAML/CSV, path queries.", pv: "utc",
    blurb: "Paste JSON to validate it as you type, with the exact line and column of any error. Beautify with 2/4-space or tab indent, minify, sort keys, convert to YAML or CSV, and query values with paths like $.users[*].name. Runs entirely in your browser.",
    faqs: [
      ["How do I find the error in invalid JSON?", "The validator shows the line and column of the first problem in plain words — like a trailing comma, a missing comma or single quotes — and Jump to error selects it in the editor."],
      ["What's the difference between beautify and minify?", "Beautify adds indentation and line breaks so JSON is easy to read. Minify removes all whitespace so the file is as small as possible for APIs and storage."],
      ["How do path queries work?", "Start with $ and chain .key, [0], [-1] for the last item, [*] for every item, or ['key with spaces']. For example $.users[*].name lists every user's name."],
      ["Is my JSON stored or uploaded?", "No. Everything runs in your browser; nothing is sent anywhere."],
    ] },
  { id: "ssl", icon: "🔒", c: "#22C55E", name: "SSL Certificate Checker", desc: "View certificate chain, expiry dates, key strength, and vulnerability alerts.", pv: "scan",
    blurb: "Enter a domain to see its SSL certificate chain, expiry date, key algorithm, size, and signature algorithm. Get alerts for certificates expiring soon.",
    faqs: [
      ["How do I check a website's SSL certificate?", "Enter the domain name (e.g., google.com). The tool fetches the certificate chain and displays subject, issuer, expiry date, key size, and more."],
      ["What does 'Days Left' mean?", "The number of days until the certificate expires. Green = >90 days, orange = 30–90 days, red = <30 days or expired."],
      ["Can I check for weak keys or algorithms?", "Yes. The tool shows key size (aim for 2048+ bits for RSA) and signature algorithm. Older algorithms like SHA-1 are flagged as weak."],
    ] },
  { id: "password", icon: "🔐", c: "#F59E0B", name: "Password Strength Checker", desc: "Client-side entropy calculation + HaveIBeenPwned breach check (k-anonymity).", pv: "scan",
    blurb: "Check password strength with client-side entropy calculation (charset and length). Verify against HaveIBeenPwned's 700+ million breached passwords using k-anonymity (your password is never sent to any API).",
    faqs: [
      ["How do you calculate password strength?", "By entropy: bits = log₂(charset size ^ password length). We check for lowercase, uppercase, digits, and special characters. 80+ bits resists brute force for years."],
      ["Is my password safe to check?", "Yes. The password stays on your device. HIBP check uses k-anonymity: we hash it locally, send only the first 5 hash characters, and check the response locally."],
      ["What does 'Not breached' mean?", "The password isn't in HIBP's public breach data (700+ million passwords from confirmed leaks). But always use a unique password per account."],
      ["What if HIBP is unavailable?", "The entropy check still works offline. If HIBP is down, try again later — the API has 99.9% uptime."],
    ] },
  { id: "prompt", icon: "✨", c: "#A855F7", name: "AI Prompt Generator", desc: "Turn a rough idea into a structured prompt for ChatGPT, Claude or Gemini — templates, plain/Markdown/XML output.", pv: "utc",
    blurb: "Build clear, structured prompts for ChatGPT, Claude, Gemini and other AI assistants. Fill in the role, task, context, audience, tone, format and rules — or start from a template — and copy a ready-to-use prompt as plain text, Markdown or XML. Runs entirely in your browser.",
    faqs: [
      ["What makes a good AI prompt?", "A clear task plus the context the AI can't guess: who it's for, the tone, the output format and any rules. An example of a good answer helps most of all."],
      ["Which structure should I pick?", "Plain text works everywhere. Markdown sections and XML tags help with long prompts — Claude in particular follows XML-tagged sections well."],
      ["Is what I type sent anywhere?", "No. The prompt is assembled in your browser and nothing is stored or sent until you paste it into an assistant yourself."],
    ] },
  { id: "image", icon: "📸", c: "#14B8A6", name: "Image Compressor & Converter", desc: "Compress images and convert between JPG, PNG and WebP — batch, resize, all on your device.", pv: "scan",
    blurb: "Compress images and convert between JPG, PNG and WebP in your browser. Batch up to 30 images, set quality, resize by maximum width or height, see the size saved for each file and download them all as a ZIP. Nothing is uploaded, and hidden metadata such as GPS location is removed.",
    faqs: [
      ["How do I reduce an image's file size?", "Drop the image in, choose WebP or JPG and a quality around 70–80%. For big photos, also set a maximum width such as 1920 px — that usually saves the most."],
      ["Which format should I choose?", "WebP is smallest for most photos and works in all modern browsers. JPG works everywhere. PNG is lossless — best for screenshots, logos and transparency, but larger for photos."],
      ["Are my images uploaded?", "No. Compression runs on your device using the browser's own image encoder. Saving also strips EXIF metadata such as GPS location and camera details."],
      ["Why did a file get bigger?", "An already-optimised image can grow when re-encoded. If that happens in the same format without resizing, the tool keeps your original instead."],
    ] },
  { id: "pdf", icon: "📄", c: "#EF4444", name: "PDF Toolkit", desc: "Merge, split, compress, convert and extract text from PDFs — privately, in your browser.", pv: "chart",
    blurb: "Merge PDFs, split or extract pages, compress for email, convert PDF pages to JPG/PNG or images to PDF, and copy out the text — all in your browser. Files are never uploaded.",
    faqs: [
      ["Are my PDFs uploaded to a server?", "No. Every action runs in your browser, so the files never leave your device."],
      ["How much can it compress a PDF?", "Light compression is lossless and keeps text selectable but often saves little. Strong compression turns each page into an image — scans and photo-heavy PDFs often shrink by 50–90%, but text is no longer selectable."],
      ["How do I split a PDF?", "Choose Split, add the PDF and type ranges like 1-3, 5, 8-. Each range becomes its own PDF, or choose to put the selected pages in one file, or split every page."],
      ["Can it read text from scanned PDFs?", "Not yet. Text extraction reads the real text inside a PDF. Scanned pages are images and would need OCR."],
    ] },
];

export const tint = (hex, a) => hex + a; /* hex + alpha suffix, e.g. tint('#F97316','22') */

export const ROTATE = [
  "Generate UTC wait-time schedules", "Find a phone number's country", "Check whether a site runs Shopify",
  "Test your internet speed", "Check if IPv6 is enabled", "Track Amazon prices", "Validate and format JSON",
  "Check password strength and breaches", "Generate better AI prompts",
  "Compress and convert images", "Merge, split and compress PDFs",
];
