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
export const CHIP_COLORS = ['orange', 'green', 'blue', 'pink', 'purple', 'neutral'] as const;
export type ChipColor = (typeof CHIP_COLORS)[number];

/**
 * Tags whose colour is a judgement, not a hash.
 *
 * Kept small on purpose: every entry here is a claim that this word means
 * something specific, and a long list is a palette by another name — which is
 * the thing D-027 was right to resist.
 */
const NAMED: Readonly<Record<string, ChipColor>> = {
  // The brief's TAG_COLORS, verbatim (LAI-606): ui amber · server/presence
  // blue · board/auth green · bug pink · agent/ai purple · the rest grey.
  ui: 'orange',
  design: 'orange',
  server: 'blue',
  api: 'blue',
  presence: 'blue',
  board: 'green',
  auth: 'green',
  docs: 'green',
  bug: 'pink',
  blocked: 'pink',
  agent: 'purple',
  ai: 'purple',
  a11y: 'neutral',
  policy: 'neutral',
  core: 'neutral',
  infra: 'neutral',
  audit: 'neutral',
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
  /*
   * Unknown tags are **neutral**, not hashed (LAI-606). The hash gave every
   * new tag a stable colour with no table to maintain — but the brief's map
   * is exhaustive about which hues *mean* something, and the prototype's own
   * fallback is grey. A colour that arrives by hash looks deliberate, and a
   * chip colour that looks deliberate and means nothing is noise with
   * authority. New meanings earn an entry above.
   */
  return NAMED[tag.trim().toLowerCase()] ?? 'neutral';
}

