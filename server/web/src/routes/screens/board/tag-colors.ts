/**
 * One chip colour per work-type tag (LAI-606).
 *
 * ## This reverses D-027, at the owner's instruction
 *
 * D-027 refused a per-tag palette, and its reasoning was sound: a colour has to
 * be chosen, stored, kept legible in both themes, and explained to whoever adds
 * the tenth tag. The owner has since asked for it against a reference, so the
 * decision is overridden — and the objection is answered rather than ignored:
 *
 *  - **Not stored.** The colour is derived, so adding a tag needs no migration
 *    and no admin screen.
 *  - **Legible in every theme**, because it resolves to a `--chip-*` token and
 *    each theme block declares its own value for that token.
 *  - **The tenth tag needs no explanation** — it gets a colour from the same
 *    rule as the first.
 *
 * `docs/` is CHIEF's, so the reversal itself wants recording there.
 *
 * ## Why a hash and not just a map
 *
 * The named entries below are the tags this project actually uses, and they are
 * deliberate — `bug` and `blocked` should be the warning colour, not whatever a
 * hash produced. Everything else falls through to a hash of the tag name, which
 * is **stable**: the same tag is the same colour on every board, every reload
 * and every machine, without a lookup table anyone has to maintain.
 */

/** The chip colours a tag may take. Each is a token, declared per theme. */
export const CHIP_COLORS = ['orange', 'green', 'blue', 'pink', 'neutral'] as const;
export type ChipColor = (typeof CHIP_COLORS)[number];

/**
 * Tags whose colour is a judgement, not a hash.
 *
 * Kept small on purpose: every entry here is a claim that this word means
 * something specific, and a long list is a palette by another name — which is
 * the thing D-027 was right to resist.
 */
const NAMED: Readonly<Record<string, ChipColor>> = {
  bug: 'pink',
  blocked: 'pink',
  server: 'blue',
  api: 'blue',
  ui: 'orange',
  design: 'orange',
  board: 'green',
  docs: 'green',
  a11y: 'neutral',
  chore: 'neutral',
};

/**
 * A stable colour for a tag.
 *
 * The hash is the classic 32-bit string fold. It does not need to be good — it
 * needs to be **the same every time**, which `Math.random()` or insertion order
 * would not be.
 */
export function tagColor(tag: string): ChipColor {
  const key = tag.trim().toLowerCase();
  const named = NAMED[key];
  if (named !== undefined) return named;

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }

  // `neutral` is excluded from the hash range: it is the *absence* of a
  // colour, and a tag should not land there by accident.
  const palette = CHIP_COLORS.filter((c) => c !== 'neutral');
  return palette[Math.abs(hash) % palette.length] ?? 'neutral';
}
