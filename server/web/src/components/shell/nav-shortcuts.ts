import { typingIn, type TypingTarget } from '../typing-in.ts';

/**
 * The sidebar's keyboard shortcuts (LAI-1221): **⌥1 – ⌥5 on a Mac, Alt+1 –
 * Alt+5 elsewhere**, one per sidebar destination, in the rail's own order.
 *
 * ## Why Alt + a digit, and not *G then a letter*
 *
 * Every bare letter that would name a destination is already a screen's key:
 * My day uses G (General), D W M Y (its views), N, T, J, K and X; the Review
 * dialog uses J K A S; a space uses `c` (Create task) and the Workroom `.`;
 * `/` and ⌘K open the search. A *G then I* sequence would fire My day's G on
 * the way in, and every letter after it is somebody's. A digit held with Alt
 * is nobody's in the app (the board's own Alt keys are the arrows), so it
 * cannot clash with a screen, now or when a screen grows a letter.
 *
 * **Read off `event.code`, not `event.key`**: on a Mac ⌥1 types `¡`, so the
 * key is never `1`; the code is `Digit1` on every layout that has a number
 * row. Shift, ⌘ and Ctrl refuse it — those are the browser's and the OS's.
 *
 * The digit is fixed per destination rather than counted down the visible
 * list, so a member and an owner press the same key for Insights; a
 * destination the reader cannot see simply does not answer to its key.
 */
export const NAV_SHORTCUT_DIGITS: Readonly<Record<string, string>> = {
  '/my-day': '1',
  '/inbox': '2',
  '/insights': '3',
  '/organisation': '4',
  '/developer': '5',
};

/** A destination's shortcut in `shortcut.ts`'s spelling (`Alt+2`), or none. */
export function navShortcut(path: string): string | undefined {
  const digit = NAV_SHORTCUT_DIGITS[path];
  return digit === undefined ? undefined : `Alt+${digit}`;
}

/** What a key event carries that matters here — a real one, or a test's. */
export interface NavKey {
  readonly code: string;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented?: boolean;
  readonly target: TypingTarget | null;
}

/**
 * The destination a key goes to, among the paths the reader can see, or
 * `undefined`. Never while typing in a field: Alt + a digit types a character
 * there on several layouts, and that character is the reader's.
 */
export function navShortcutTarget(event: NavKey, visible: readonly string[]): string | undefined {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return undefined;
  if (event.defaultPrevented === true) return undefined;
  if (typingIn(event.target)) return undefined;
  const match = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
  if (match === null) return undefined;
  const path = Object.keys(NAV_SHORTCUT_DIGITS).find((p) => NAV_SHORTCUT_DIGITS[p] === match[1]);
  return path !== undefined && visible.includes(path) ? path : undefined;
}

/**
 * Whether a bare `?` opens the app's shortcuts sheet. A screen with a sheet
 * of its own claims `?` by putting it on its help button as
 * `aria-keyshortcuts="?"` — My day does — and there `?` keeps opening that
 * one, which lists the screen's keys; the header's ? button still opens the
 * app's. Never while typing, and never over a modal.
 */
export function helpKeyOpensSheet(
  event: Pick<NavKey, 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'> & {
    readonly key: string;
  },
  doc: Pick<Document, 'querySelector'>,
): boolean {
  if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.defaultPrevented === true) return false;
  if (typingIn(event.target)) return false;
  if (doc.querySelector('[aria-modal="true"]') !== null) return false;
  return doc.querySelector('[aria-keyshortcuts="?"]:not([data-header-help])') === null;
}
