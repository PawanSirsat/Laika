/**
 * Reading a closed vocabulary out of the server's `enums.ts` (LAI-147).
 *
 * Two tests mirror `ACTIVITY_TYPES` — the SSE subscription list and the
 * dashboard's wording — and both read it as **text**, because the client cannot
 * import from `server/src`. Reading source as text is fine; reading it
 * *carelessly* is not, and this file exists because it was.
 *
 * ## What broke, and why it was nobody's mistake
 *
 * The parse matched any single-quoted run: `/'([^']+)'/g`. LAI-113 added a
 * comment **inside** the array — deliberately, so the no-backfill reasoning sits
 * where the next person meets it — containing the words *"§4.13's indexes"*.
 *
 * **The apostrophe in `4.13's` opened a match.** Everything up to the next
 * apostrophe became a "type", and the assertion failed with a diff full of
 * prose. A legal, deliberate change to the server broke a guard that was
 * pattern-matching rather than parsing, and the failure read as a drift that did
 * not exist.
 *
 * ## Two defences, because either alone is a bet
 *
 * 1. **Strip comments first.** Prose cannot contribute a match if it is gone —
 *    and that also covers a comment that mentions a real type by name, which the
 *    shape check alone would happily pick up.
 * 2. **Match the shape, not "anything quoted".** An activity type is
 *    `word.word`; an apostrophe in prose is not.
 *
 * Comments inside these arrays are **normal now, not exceptional**, so this has
 * to survive the next one written without anybody thinking about this file.
 */

/** `//` to end of line, and `/* … *\/` blocks, removed before anything is read. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The string literals of one `export const NAME = [...] as const;` array.
 *
 * Returns them in source order, which is what the callers assert — the two
 * lists are one vocabulary, and a client subscribing to the right names in the
 * wrong order is a difference nobody would notice from outside.
 */
export function readVocabulary(source: string, name: string): string[] {
  const block = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(source);
  if (block === null) {
    throw new Error(`could not find ${name} — this check can no longer see anything`);
  }

  // Shape, not "anything quoted": `word.word`, which is what §4.8 names are.
  return [...stripComments(block[1] ?? '').matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(
    (m) => m[1] ?? '',
  );
}
