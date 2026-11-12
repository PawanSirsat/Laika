import { SIZE_LEVELS, type SizeLevel } from '../../api/estimates.ts';

/**
 * The rules behind `Chip` (LAI-1206), as plain data so `node --test` can pin
 * them: which variants exist, how each is told apart **without colour**
 * (WCAG 1.4.1), and the few words and numbers a chip draws.
 *
 * Every chip on a card shares one height, one padding and one type step; what
 * differs is the *shape* (a square-cornered tab or a round pill), the *face*
 * (the UI sans or the mono used for codes) and a drawn *glyph*. Two variants
 * that can sit side by side on one row never share all three — that is the
 * property `chip-model.test.ts` asserts, and it is the whole fix for a sprint
 * `S2` reading as the effort `S` beside it (visual audit, problem 5).
 */

export const CHIP_VARIANTS = [
  'status',
  'priority',
  'size',
  'sprint',
  'tag',
  'count',
  'ref',
] as const;
export type ChipVariant = (typeof CHIP_VARIANTS)[number];

/** The token families a chip may wear; each maps to an existing `--chip-*` triple. */
export const CHIP_TONES = [
  'neutral',
  'blue',
  'green',
  'orange',
  'pink',
  'purple',
  'accent',
  'danger',
] as const;
export type ChipTone = (typeof CHIP_TONES)[number];

export type ChipShape = 'tab' | 'pill';
export type ChipFace = 'ui' | 'mono';
/** The drawn mark at a chip's start. `none` for a tag, whose word is the whole point. */
export type ChipGlyph = 'dot' | 'priority' | 'bars' | 'cycle' | 'none' | 'link';

export interface ChipAnatomy {
  readonly shape: ChipShape;
  readonly face: ChipFace;
  readonly glyph: ChipGlyph;
}

/**
 * The anatomy of each variant. Read by `Chip.tsx` for its classes and by the
 * test for the told-apart-without-colour property, so the two cannot drift.
 */
export const CHIP_ANATOMY: Readonly<Record<ChipVariant, ChipAnatomy>> = {
  status: { shape: 'pill', face: 'ui', glyph: 'dot' },
  priority: { shape: 'tab', face: 'ui', glyph: 'priority' },
  // The effort: a code (`XS`…`XL`) with a rising meter, square-cornered.
  size: { shape: 'tab', face: 'mono', glyph: 'bars' },
  // The sprint: a round pill with the iteration mark, in the UI face — never
  // the square mono tab the effort wears.
  sprint: { shape: 'pill', face: 'ui', glyph: 'cycle' },
  tag: { shape: 'tab', face: 'ui', glyph: 'none' },
  // A number alone: the round mono badge, no mark — the digits are the content.
  count: { shape: 'pill', face: 'mono', glyph: 'none' },
  // An outside id (LAI-780): a code that points somewhere else.
  ref: { shape: 'tab', face: 'mono', glyph: 'link' },
};

/**
 * The marks a **status** chip may draw in place of its dot, each a different
 * drawing: overdue is a warning triangle, due-today a clock, sent back a
 * return arrow. A status is never told apart by its tone alone.
 */
export const STATUS_MARKS = ['dot', 'alert', 'clock', 'back'] as const;
export type StatusMark = (typeof STATUS_MARKS)[number];

/** The largest count a badge spells out; above it, `99+`. */
export const COUNT_CAP = 99;

/**
 * A count as a badge has room for it: whole, never negative, never `NaN`,
 * and `99+` past the cap. The exact number is the caller's to say in words.
 */
export function formatCount(count: number, cap: number = COUNT_CAP): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  const whole = Math.floor(count);
  return whole > cap ? `${String(cap)}+` : String(whole);
}

/**
 * The exact count in words for a screen reader — `1 task`, `128 tasks` —
 * so a capped `99+` never hides the real number from anyone.
 */
export function countWords(count: number, one: string, many: string): string {
  const whole = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${String(whole)} ${whole === 1 ? one : many}`;
}

/**
 * Bars lit on the effort meter, one per level: `XS` one, `XL` five. The level
 * is still the text; the meter repeats it as a shape.
 */
export function sizeBars(level: SizeLevel): number {
  return SIZE_LEVELS.indexOf(level) + 1;
}

/**
 * The effort's tone repeats its level (D-085): the small sizes neutral, a
 * typical task blue, the large ones stronger — never red, because a large
 * task is not a problem.
 */
export const SIZE_TONES: Readonly<Record<SizeLevel, ChipTone>> = {
  XS: 'neutral',
  S: 'neutral',
  M: 'blue',
  L: 'purple',
  XL: 'orange',
};

/** The meter's length — the number of levels there are. */
export const SIZE_BAR_COUNT = SIZE_LEVELS.length;

/**
 * What the sprint chip's mark is called aloud. The label (`S2`) is the
 * visible text; the mark says what kind of thing it is, and whether it is
 * the sprint running now — the one fact the chip's colour also carries.
 */
export function sprintGlyphLabel(active: boolean): string {
  return active ? 'Active sprint' : 'Sprint';
}
