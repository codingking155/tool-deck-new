/* Runs before first paint: apply the saved (or OS) theme to <html> so light-mode users don't see a dark flash. */
try {
  var t = localStorage.getItem("toolDeck.theme");
  if (t !== "dark" && t !== "light") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: CSS default (dark) applies */ }
