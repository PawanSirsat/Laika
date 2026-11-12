/**
 * The interface font: which face `--font-ui` points at (LAI-1125).
 *
 * The same shape as `theme.ts`, on purpose. The default carries **no
 * attribute** — `:root` already declares Plus Jakarta Sans — and every other
 * face is `:root[data-font='<id>']` in `styles/theme.css`, which re-points
 * `--font-ui` at that face's stack. Components never learn a family name: they
 * read `--font-ui`, as they always have.
 *
 * Per device, in `localStorage`. There is no server field for it, and adding
 * one would be CORE's (SPEC §4); a font is a reading preference of this
 * screen, not of the person.
 *
 * **Adding a face is a token, a block in `styles/theme.css`, its `@import` in
 * `index.css` and an entry here.** The picker reads this array.
 */

export interface InterfaceFont {
  /** The `data-font` value, and what is stored. */
  readonly id: string;
  /** The family's own name, as the picker shows it — set in that face. */
  readonly name: string;
  /** The token in `styles/theme.css` holding this face's stack. */
  readonly token: `--font-face-${string}`;
  /**
   * One line of honesty under the name, where the face has a cost a reader
   * would otherwise find out about later. Absent where there is none.
   */
  readonly note?: string;
}

/** The face `:root` declares, which therefore needs no attribute. */
export const DEFAULT_FONT = 'plus-jakarta-sans';

/** Every face, in picker order: the default first, then the plain faces, then display. */
export const FONTS = [
  { id: DEFAULT_FONT, name: 'Plus Jakarta Sans', token: '--font-face-plus-jakarta-sans' },
  {
    id: 'poppins',
    name: 'Poppins',
    token: '--font-face-poppins',
    note: 'Wider letters — long titles cut off a little sooner.',
  },
  { id: 'commissioner', name: 'Commissioner', token: '--font-face-commissioner' },
  {
    id: 'average-sans',
    name: 'Average Sans',
    token: '--font-face-average-sans',
    note: 'One weight — bold text shows at regular weight.',
  },
  {
    id: 'carter-one',
    name: 'Carter One',
    token: '--font-face-carter-one',
    note: 'Display style — best for personal taste, less suited to dense tables.',
  },
  {
    id: 'short-stack',
    name: 'Short Stack',
    token: '--font-face-short-stack',
    note: 'Display style — best for personal taste, less suited to dense tables.',
  },
] as const satisfies readonly InterfaceFont[];

export type FontId = (typeof FONTS)[number]['id'];

export const FONT_STORAGE_KEY = 'laika.font';

const FONT_ATTRIBUTE = 'data-font';

export function isFontId(value: unknown): value is FontId {
  return typeof value === 'string' && FONTS.some((font) => font.id === value);
}

/**
 * The stored face, or the default.
 *
 * Storage can throw outright — Safari in private mode, a browser blocking site
 * data — and a font lookup must never be the reason the app fails to start. A
 * value this build does not know (a face since removed, or garbage) is the
 * default, not an error.
 */
export function readFont(storage: Pick<Storage, 'getItem'> = localStorage): FontId {
  try {
    const stored: unknown = storage.getItem(FONT_STORAGE_KEY);
    return isFontId(stored) ? stored : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

export function writeFont(
  font: FontId,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
): void {
  try {
    if (font === DEFAULT_FONT) {
      // Removed rather than stored, so a future change of default reaches
      // everyone who never chose — as `writePreference('system')` does.
      storage.removeItem(FONT_STORAGE_KEY);
    } else {
      storage.setItem(FONT_STORAGE_KEY, font);
    }
  } catch {
    // Does not persist; this session still shows the choice.
  }
}

/** Put the face on the document: an attribute for any face but the default. */
export function applyFont(font: FontId, root: HTMLElement = document.documentElement): void {
  if (font === DEFAULT_FONT) root.removeAttribute(FONT_ATTRIBUTE);
  else root.setAttribute(FONT_ATTRIBUTE, font);
}

/**
 * Call before React renders, beside `initTheme()`, so the first paint React
 * produces is already in the chosen face — the sign-in screen included.
 */
export function initFont(): FontId {
  const font = readFont();
  applyFont(font);
  return font;
}
