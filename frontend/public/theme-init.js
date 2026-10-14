// Apply the saved theme before first paint (kept external so a strict CSP can forbid inline scripts).
(function () {
  try {
    if (window.localStorage.getItem('theme.v1') === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {
    /* storage unavailable: keep the light default */
  }
})();
