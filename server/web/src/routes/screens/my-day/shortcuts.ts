/**
 * My day's keys (LAI-831, the owner's design and CHIEF's addition H): on the
 * selected draft, ↵ confirms, G puts it on General, X marks it not work; J
 * and K move to the next and previous draft; ← and → step along every block
 * on the Timeline (LAI-888, the design's footer); ? opens the sheet that
 * lists them.
 *
 * **None fires while typing.** A field, a text area, a select or editable
 * text keeps every key, so a note that says "fix the gap" never marks a block
 * not work. A key held with Cmd, Ctrl or Alt is the browser's. ↵ on a button
 * or a link presses *that* — it never confirms behind the reader's back.
 */

export type Shortcut =
  'confirm' | 'general' | 'dismiss' | 'next' | 'prev' | 'right' | 'left' | 'help' | 'close';

/** What a key event carries that matters here — a real one, or a test's. */
export interface KeyLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly target: {
    readonly tagName?: string;
    readonly type?: string;
    readonly isContentEditable?: boolean;
  } | null;
}

/** Inputs that take a click, not typing. */
const PRESSED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color']);

export function typingIn(target: KeyLike['target']): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !PRESSED.has((target.type ?? 'text').toLowerCase());
}

/** Elements whose own ↵ means something. */
const ACTS_ON_ENTER = new Set(['BUTTON', 'A', 'INPUT', 'SUMMARY', 'SELECT', 'TEXTAREA']);

const LETTERS: Readonly<Record<string, Shortcut>> = {
  g: 'general',
  x: 'dismiss',
  j: 'next',
  k: 'prev',
};

export function shortcutFor(event: KeyLike): Shortcut | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  if (typingIn(event.target)) return undefined;
  if (event.key === '?') return 'help';
  if (event.key === 'Escape') return 'close';
  if (event.key === 'ArrowRight') return 'right';
  if (event.key === 'ArrowLeft') return 'left';
  if (event.key === 'Enter') {
    const tag = (event.target?.tagName ?? '').toUpperCase();
    return ACTS_ON_ENTER.has(tag) ? undefined : 'confirm';
  }
  return LETTERS[event.key.toLowerCase()];
}

/** The sheet's rows, in the order the design's hint row gives them. */
export const SHORTCUT_SHEET: readonly (readonly [string, string])[] = [
  ['↵', 'Confirm the selected draft'],
  ['G', 'Put it on General'],
  ['X', 'Mark it not work'],
  ['← →', 'Previous and next block on the Timeline'],
  ['J', 'Next draft'],
  ['K', 'Previous draft'],
  ['?', 'Show these keys'],
  ['Esc', 'Close this, or let go of a picked gap'],
];
