/*
 * The theme and interface font, on <html> before the first paint (LAI-1212).
 *
 * A classic, same-origin script loaded from <head> in index.html. The browser
 * runs it before it parses <body>, so a reader who chose Light or Black never
 * sees a frame of the default dark — which the module bundle, deferred by
 * definition, could not promise. It is a file rather than an inline script
 * because the CSP is `script-src 'self'` with no 'unsafe-inline' (LAI-023).
 *
 * It mirrors `src/theme/theme.ts` and `src/theme/font.ts`, which stay the
 * authority and re-apply the same answer when the bundle arrives.
 * `test/theme/theme-boot.test.ts` runs this file against those modules over
 * every stored value, so the two cannot drift silently. No colours here.
 */
(function () {
  var THEMES = ['light', 'dark', 'black'];
  var VARIANTS = ['dark', 'black'];
  var FONTS = [
    'plus-jakarta-sans',
    'poppins',
    'commissioner',
    'average-sans',
    'carter-one',
    'short-stack',
  ];
  var root = document.documentElement;

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  var stored = read('laika.theme');
  var variant = read('laika.theme.dark');
  if (VARIANTS.indexOf(variant) === -1) variant = 'dark';

  var theme;
  if (THEMES.indexOf(stored) !== -1) {
    theme = stored;
  } else {
    var dark = false;
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) {
      dark = false;
    }
    theme = dark ? variant : 'light';
  }

  // Dark is the bare :root and carries no attribute, as theme.ts applies it.
  if (theme === 'dark') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';

  var font = read('laika.font');
  if (font !== FONTS[0] && FONTS.indexOf(font) !== -1) root.setAttribute('data-font', font);
})();
