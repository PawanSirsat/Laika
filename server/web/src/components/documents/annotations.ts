/**
 * Anchored comments, the trial's prototype (LAI-1131, T8).
 *
 * An anchor is a **quote**, not an offset: the selected words plus a little
 * of what comes before and after them, and the section they sit in. That is
 * the shape deliverable-engine.md §2.3 T8 names — `{exact, prefix, suffix,
 * heading_slug}` — and it is what lets a comment made on v1 find its words
 * again in v2 after the text around it moved. When the words are gone, the
 * comment is **outdated**, shown as such, never silently attached elsewhere.
 *
 * Pure text in, offsets out: the DOM half is in `AnnotationLayer.tsx`. Nothing
 * here is persisted — the trial keeps comments in memory, and storing them is
 * Phase D's (anchored comments need a table, `can()` rows and an API).
 */

export interface Anchor {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
  /** The `h-<slug>` id of the heading the quote sits under, or `''`. */
  readonly headingId: string;
}

/** Characters of context kept either side of the quote. */
export const CONTEXT = 32;

/** The anchor for `text[start, end)`. */
export function anchorFor(text: string, start: number, end: number, headingId: string): Anchor {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    headingId,
  };
}

/** Length of the common suffix of `a` and `b`. */
function tailMatch(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Length of the common prefix of `a` and `b`. */
function headMatch(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export interface Located {
  readonly start: number;
  readonly end: number;
}

/**
 * Where `anchor` is in `text`, or `null` when its words are not there.
 *
 * Every occurrence of the exact quote is scored by how much of its prefix and
 * suffix still match; the best wins, the earliest on a tie. So a quote that
 * appears twice re-attaches to the one with the same surroundings, and a
 * quote whose surroundings were edited still finds its words.
 */
export function locate(text: string, anchor: Anchor): Located | null {
  if (anchor.exact === '') return null;
  let best: Located | null = null;
  let bestScore = -1;
  for (let at = text.indexOf(anchor.exact); at !== -1; at = text.indexOf(anchor.exact, at + 1)) {
    const end = at + anchor.exact.length;
    const score =
      tailMatch(text.slice(Math.max(0, at - CONTEXT), at), anchor.prefix) +
      headMatch(text.slice(end, end + CONTEXT), anchor.suffix);
    if (score > bestScore) {
      best = { start: at, end };
      bestScore = score;
    }
  }
  return best;
}

export interface Annotation {
  readonly id: string;
  /** Which document — the same across its versions, so a comment can follow v1 to v2. */
  readonly documentId: string;
  /** The version it was made on. */
  readonly version: string;
  readonly anchor: Anchor;
  readonly body: string;
}

let counter = 0;

/** A process-unique id; enough for comments that live in one tab. */
export function nextAnnotationId(): string {
  counter += 1;
  return `note-${String(counter)}`;
}
