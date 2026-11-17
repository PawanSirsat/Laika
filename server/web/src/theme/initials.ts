/**
 * Initials for an avatar.
 *
 * Extracted while wiring the activity rail (LAI-070), which needed a fourth
 * copy of a function already living in `UserChrome`, `ProjectStats` and
 * `TaskCard` — identical in all three. Those three are **not** migrated here:
 * that is a refactor of working components and belongs to its own task
 * (LAI-215), not to the stream work that happened to notice it.
 *
 * First and last initial, so "Ada Lovelace" is `AL` and a single-word name is
 * one letter rather than a padded fake. `?` for an unknown actor, because a
 * blank circle reads as a rendering fault.
 */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  const first = firstGrapheme(parts[0]) ?? '?';
  const last = parts.length > 1 ? (firstGrapheme(parts[parts.length - 1]) ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * The first user-perceived character (LAI-1206). `word[0]` is a UTF-16 code
 * unit, so a name that begins with an emoji or an astral-plane letter
 * rendered half a surrogate pair — the `�` disc. `Intl.Segmenter` keeps a
 * whole grapheme (a flag, a skin-toned emoji, a letter with its combining
 * mark); a runtime without it falls back to code points, which is still
 * never half a character.
 */
function firstGrapheme(word: string | undefined): string | undefined {
  if (word === undefined || word === '') return undefined;
  if (typeof Intl.Segmenter === 'function') {
    const [first] = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
    return first?.segment;
  }
  return Array.from(word)[0];
}
