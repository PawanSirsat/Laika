import { ENTRY_KINDS, type EntryKind } from '../../../api/time.ts';

/**
 * The eight kinds a typed entry may be (D-108, LAI-897; the owner's design's
 * eight since LAI-516), each with the word on the segment and the glyph on
 * the block. The list is the server's; the order is the design's KIND row.
 * `work` reads *Work* on a chip and *Building* on the timer and the charts,
 * as the design has it.
 */
export interface KindFace {
  readonly kind: EntryKind;
  readonly label: string;
  readonly glyph: string;
}

const FACES: Readonly<Record<EntryKind, { label: string; glyph: string }>> = {
  work: { label: 'Work', glyph: '◆' },
  meeting: { label: 'Meeting', glyph: '▣' },
  thinking: { label: 'Thinking', glyph: '◎' },
  research: { label: 'Research', glyph: '✎' },
  pairing: { label: 'Pairing', glyph: '✚' },
  review: { label: 'Review', glyph: '◇' },
  support: { label: 'Support', glyph: '☏' },
  admin: { label: 'Admin', glyph: '≡' },
};

/** The design's word for a kind where it stands as a bar or a timer: Work is *Building*. */
const CHART_LABELS: Readonly<Partial<Record<EntryKind, string>>> = {
  work: 'Building',
  meeting: 'Meetings',
};

export const KINDS: readonly KindFace[] = ENTRY_KINDS.map((kind) => ({ kind, ...FACES[kind] }));

export function kindLabel(kind: EntryKind): string {
  return FACES[kind].label;
}

export function kindGlyph(kind: EntryKind): string {
  return FACES[kind].glyph;
}

/** The kind's word on a chart segment or the timer's pill (the design's `kindColors`). */
export function kindChartLabel(kind: EntryKind): string {
  return CHART_LABELS[kind] ?? FACES[kind].label;
}

/** The timer's kinds (the design's Start a timer popover): Building, Meeting, Thinking. */
export const TIMER_KINDS: readonly KindFace[] = (['work', 'meeting', 'thinking'] as const).map(
  (kind) => ({ kind, label: kindChartLabel(kind), glyph: FACES[kind].glyph }),
);
