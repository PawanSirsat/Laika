/**
 * Whether a key pressed on `target` belongs to a field the reader is typing
 * in — so no single-letter shortcut fires from inside one (LAI-831, moved
 * here from My day's `shortcuts.ts` by LAI-1167 so the Create task dialog's
 * `c` can share it: a component may not import from a screen).
 *
 * A field, a text area, a select or editable text keeps every key, so a note
 * that says "create the gap" never opens a dialog. A key on a control that is
 * pressed, not typed into — a checkbox, a button — is not typing.
 */

/** What a key event's target carries that matters here — a real one, or a test's. */
export interface TypingTarget {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

/**
 * Inputs that take a click, not typing. A range is not one of them: its ← →
 * move its own thumb (the Timeline's zoom slider, LAI-891), so every key on
 * it is its own.
 */
const PRESSED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color']);

export function typingIn(target: TypingTarget | null): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !PRESSED.has((target.type ?? 'text').toLowerCase());
}
