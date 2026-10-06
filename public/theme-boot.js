/* Runs before first paint: apply the saved (or OS) theme to <html> so light-mode users don't see a dark flash. */
try {
  var t = localStorage.getItem("toolDeck.theme");
  if (t !== "dark" && t !== "light") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", t === "light" ? "#F6F2EB" : "#0A0B0E");
} catch (e) { /* storage blocked: CSS default (dark) applies */ }
