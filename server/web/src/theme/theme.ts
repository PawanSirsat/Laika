/**
 * Theme resolution and persistence.
 *
 * Resolution order, per LAI-018: explicit user choice → OS `prefers-color-scheme`
 * → light.
 *
 * The OS preference only *selects* a theme here; it never defines colours.
 * `styles/theme.css` declares every colour in every theme block, so a media
 * query that redeclared any of them would be a second source of truth and could
 * strand a value when the user toggles away from their OS setting.
 */

/**
 * Every theme, in switcher order (LAI-606).
 *
 * **Adding a theme is adding a block to `styles/theme.css` and a name here.**
 * Nothing else: the switcher reads this array, so a new theme appears in the UI
 * without an edit, and components never learn its name.
 */
export const THEMES = ['light', 'dark', 'black'] as const;
export type Theme = (typeof THEMES)[number];

/** What the user asked for. `system` means "follow the OS". */
export type ThemePreference = Theme | 'system';

/**
 * Which dark theme `system` resolves to when the OS asks for dark (LAI-1212):
 * the brand navy, or true black for OLED screens.
 */
export const DARK_VARIANTS = ['dark', 'black'] as const;
export type DarkVariant = (typeof DARK_VARIANTS)[number];

export const STORAGE_KEY = 'laika.theme';

/**
 * The dark variant System uses. Absent means `dark`, for the same reason
 * `system` is absent rather than stored: a future default reaches everyone
 * who never chose.
 */
export const DARK_VARIANT_KEY = 'laika.theme.dark';

/** Whether a theme is one of the dark ones — what `color-scheme` and the avatar ramp care about. */
export function isDarkTheme(theme: Theme): boolean {
  return theme !== 'light';
}

/**
 * The attribute `styles/theme.css` hangs each palette on.
 *
 * **Dark is the bare `:root` and carries no attribute.** Every other theme is
 * `:root[data-theme='<name>']`, so the default needs no markup to be correct —
 * which is what makes a first paint before any script the *dark* one rather
 * than a flash of something else.
 */
const THEME_ATTRIBUTE = 'data-theme';

/** The theme that `:root` itself declares, and therefore needs no attribute. */
const DEFAULT_THEME: Theme = 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || (typeof value === 'string' && THEMES.includes(value as Theme));
}

/**
 * Read the stored preference.
 *
 * Storage can throw outright — Safari in private mode, or a browser configured
 * to block site data — and a theme lookup must never be the reason the app fails
 * to start. An unreadable or unrecognised value is treated as no preference.
 */
export function readPreference(storage: Pick<Storage, 'getItem'> = localStorage): ThemePreference {
  try {
    const stored: unknown = storage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writePreference(
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
): void {
  try {
    if (preference === 'system') {
      // Remove rather than store 'system', so a future change to the default
      // reaches users who never made an explicit choice.
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // Preference does not persist; the current session still honours it.
  }
}

function isDarkVariant(value: unknown): value is DarkVariant {
  return typeof value === 'string' && DARK_VARIANTS.includes(value as DarkVariant);
}

/** The dark variant System follows; `dark` when unset, unreadable or unknown. */
export function readDarkVariant(storage?: Pick<Storage, 'getItem'>): DarkVariant {
  try {
    // Inside the try: in a context with no `localStorage` at all, naming it throws.
    const stored: unknown = (storage ?? localStorage).getItem(DARK_VARIANT_KEY);
    return isDarkVariant(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

export function writeDarkVariant(
  variant: DarkVariant,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
): void {
  try {
    if (variant === 'dark') storage.removeItem(DARK_VARIANT_KEY);
    else storage.setItem(DARK_VARIANT_KEY, variant);
  } catch {
    // Does not persist; this session still honours it.
  }
}

/**
 * What the OS asks for: `light`, or `dark` when it prefers a dark scheme.
 * Light when the browser cannot say. The OS has no notion of *which* dark —
 * that is the reader's {@link DarkVariant}, applied in {@link resolveTheme}.
 */
export function systemTheme(query: string = DARK_QUERY): 'light' | 'dark' {
  return typeof matchMedia === 'function' && matchMedia(query).matches ? 'dark' : 'light';
}

/**
 * The preference, resolved to an actual theme. `system` follows the OS, and
 * an OS asking for dark gets the reader's dark variant.
 */
export function resolveTheme(
  preference: ThemePreference,
  system: Theme = systemTheme(),
  variant?: DarkVariant,
): Theme {
  if (preference !== 'system') return preference;
  // The stored variant is read only when System actually needs it.
  return isDarkTheme(system) ? (variant ?? readDarkVariant()) : 'light';
}

/**
 * Where a one-click "switch theme" goes (the person menu, the palette,
 * `ThemeSwitch`): from any dark theme to light, and from light back to the
 * reader's dark variant — so a Black reader toggling twice lands on Black.
 */
export function toggledTheme(theme: Theme, variant: DarkVariant = readDarkVariant()): Theme {
  return isDarkTheme(theme) ? 'light' : variant;
}

/**
 * Put the theme on the document.
 *
 * `color-scheme` is set alongside the class so the browser themes what CSS does
 * not reach — form controls, scrollbars and the canvas behind the page — which
 * is what stops a white scrollbar framing a dark app.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === DEFAULT_THEME) {
    // Removed, not set to 'dark': `:root` already *is* dark, and an attribute
    // that names the default is a second place for it to be wrong.
    root.removeAttribute(THEME_ATTRIBUTE);
  } else {
    root.setAttribute(THEME_ATTRIBUTE, theme);
  }

  // `black` is not a colour-scheme keyword; every dark theme is `dark` to the browser.
  root.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light';
}

/**
 * Choose a theme: persist it and put it on the document (LAI-606).
 *
 * The one entry point the brief asks for — the switcher calls this and nothing
 * else. `'system'` is a valid choice and clears the stored value, so a reader
 * who picks it follows the OS again rather than being pinned to whatever it
 * happened to be at the moment they chose.
 */
export function setTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): Theme {
  writePreference(preference);
  const theme = resolveTheme(preference);
  applyTheme(theme, root);
  return theme;
}

/**
 * Call as early as possible, before React renders.
 *
 * The *first* application happens earlier still, in `public/theme-boot.js`
 * (LAI-1212): a classic, same-origin script in `<head>` that runs before the
 * body is parsed, so a Light or Black reader never sees a frame of the default
 * dark. It is not inline — the CSP is `script-src 'self'` with no
 * `'unsafe-inline'` (LAI-023, LAI-103) — and `test/theme/theme-boot.test.ts`
 * holds it to this module's resolution. This call stays as the authority: it
 * re-applies the same answer once the bundle is here.
 */
export function initTheme(): Theme {
  const theme = resolveTheme(readPreference());
  applyTheme(theme);
  return theme;
}

/**
 * Follow the OS while the user has expressed no preference.
 *
 * Returns an unsubscribe function. Without this, a reader whose machine flips to
 * dark at sunset keeps the light palette until they reload.
 */
export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  // No matchMedia (very old browser, or a non-DOM test environment): there is
  // nothing to subscribe to, so hand back a no-op unsubscribe rather than
  // making every caller null-check.
  if (typeof matchMedia !== 'function') return () => undefined;

  const query = matchMedia(DARK_QUERY);
  const listener = (event: MediaQueryListEvent): void => {
    if (readPreference() === 'system') onChange(event.matches ? readDarkVariant() : 'light');
  };

  query.addEventListener('change', listener);
  return () => {
    query.removeEventListener('change', listener);
  };
}
