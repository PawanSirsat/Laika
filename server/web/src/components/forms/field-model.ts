/**
 * The rules behind `Field` that are worth testing without a renderer (LAI-1204).
 */

export interface CharCount {
  /** What is drawn: `12 / 120`, grouped for the reader's locale. */
  readonly text: string;
  /** What a screen reader hears through `aria-describedby`: `12 of 120 characters`. */
  readonly spoken: string;
  readonly over: boolean;
}

/**
 * A character count, in **user-perceived characters** — grapheme clusters —
 * not UTF-16 code units. `'👩‍💻'.length` is 5; a person typing it typed one
 * thing, and a count that jumps by five for one keystroke reads as broken.
 *
 * The server's limits are checked by Zod's `.max()`, which counts code units,
 * so this can show *fewer* than the server will count for emoji-heavy text.
 * The count is guidance; the server's refusal still lands under the field.
 */
export function charCount(value: string, max: number, locale?: string): CharCount {
  const used = graphemes(value);
  const nf = new Intl.NumberFormat(locale);
  return {
    text: `${nf.format(used)} / ${nf.format(max)}`,
    spoken: `${nf.format(used)} of ${nf.format(max)} characters`,
    over: used > max,
  };
}

export function graphemes(value: string): number {
  if (value === '') return 0;
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(seg.segment(value)).length;
}

/** The ids a control is described by, in reading order: help, count, error. */
export function describedByIds(parts: {
  readonly helpId?: string | undefined;
  readonly countId?: string | undefined;
  readonly errorId?: string | undefined;
}): string | undefined {
  const ids = [parts.helpId, parts.countId, parts.errorId].filter(
    (id): id is string => id !== undefined && id !== '',
  );
  return ids.length === 0 ? undefined : ids.join(' ');
}

/** What `focusFirstInvalid` needs of the DOM: enough to stub in a test. */
export interface Focusable {
  focus(options?: { preventScroll?: boolean }): void;
  scrollIntoView?(options?: { block?: 'center' | 'nearest' }): void;
}

export interface InvalidQuery {
  querySelector(selector: string): Focusable | null;
}

/**
 * After a refused submit, put the focus on the first field that is wrong
 * (LAI-1204), so a keyboard or screen-reader user lands on the problem rather
 * than on a Save button whose form went red somewhere above it.
 *
 * Document order is the order `querySelector` returns, which is the order the
 * fields are read in. Returns whether it found one, so a caller with a
 * form-level message (no field named) can focus that instead.
 */
export function focusFirstInvalid(root: InvalidQuery | null): boolean {
  const target = root?.querySelector('[aria-invalid="true"]') ?? null;
  if (target === null) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: 'center' });
  return true;
}
