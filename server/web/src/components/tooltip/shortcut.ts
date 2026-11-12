/**
 * A keyboard shortcut, written once and shown the way the reader's keyboard
 * is labelled (LAI-1209): `Mod+Shift+Z` is `⌘⇧Z` on a Mac and `Ctrl+Shift+Z`
 * everywhere else, and `Control+Shift+Z` / `Meta+Shift+Z` for
 * `aria-keyshortcuts`, which a screen reader announces.
 *
 * Pure — the platform is a parameter — so the spelling is unit-tested rather
 * than read off a screenshot.
 *
 * The keys are written `+`-separated, modifiers first, in this vocabulary:
 * `Mod` (⌘ on a Mac, Ctrl elsewhere), `Shift`, `Alt`, then one key — a letter,
 * a digit, `Escape`, `Enter`.
 */

const MAC_GLYPH: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
};

const WORD: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
};

/** What a key is called on its keycap. */
function keyName(key: string): string {
  if (key === 'Escape') return 'Esc';
  if (key === 'Enter') return '↵';
  return key.length === 1 ? key.toUpperCase() : key;
}

function parts(keys: string): readonly string[] {
  return keys
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/**
 * For the eye: `⌘⇧Z` on a Mac — the glyphs run together, as on the menu bar —
 * and `Ctrl+Shift+Z` elsewhere. A key with no modifier is just its name.
 */
export function formatShortcut(keys: string, mac: boolean): string {
  const all = parts(keys);
  const key = all.at(-1) ?? '';
  const mods = all.slice(0, -1);
  if (mac) return [...mods.map((m) => MAC_GLYPH[m] ?? m), keyName(key)].join('');
  return [...mods.map((m) => WORD[m] ?? m), keyName(key)].join('+');
}

/** For `aria-keyshortcuts`: the DOM's key names, `Meta` or `Control` for Mod. */
export function ariaShortcut(keys: string, mac: boolean): string {
  return parts(keys)
    .map((p) => (p === 'Mod' ? (mac ? 'Meta' : 'Control') : p.length === 1 ? p.toUpperCase() : p))
    .join('+');
}

/** Whether the reader's keyboard says ⌘. Read once; it does not change mid-session. */
export function onMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}
