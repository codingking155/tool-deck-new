/* Sheaf: theme.js
   Follow ToolDeck's theme: live from the parent page when embedded in the PDF Toolkit,
   otherwise from the saved ToolDeck choice. Without either, the OS preference applies. */
(function () {
  var root = document.documentElement, host = null;
  function set(t) { if (t === 'light' || t === 'dark') root.dataset.theme = t; }
  try { if (window.parent !== window) host = window.parent.document.documentElement; } catch (e) { /* not same-origin */ }
  if (host) {
    set(host.dataset.theme);
    new MutationObserver(function () { set(host.dataset.theme); }).observe(host, { attributes: true, attributeFilter: ['data-theme'] });
  } else {
    try { set(localStorage.getItem('toolDeck.theme')); } catch (e) { /* storage blocked */ }
  }
})();
