// Runs before the first paint, so the page never flashes the wrong theme.
// The stored choice is 'auto' (follow the system) or one of the theme names in web/ui/tokens.css.
(function () {
  var choice = 'auto';
  try { choice = localStorage.getItem('theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  var known = ['light', 'dark', 'dark_dimmed', 'light_high_contrast', 'dark_high_contrast'];
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', known.indexOf(choice) >= 0 ? choice : (dark ? 'dark' : 'light'));
}());
