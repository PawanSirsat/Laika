import { ENTRY_KINDS, type EntryKind } from '../../../api/time.ts';

/**
 * The eight kinds a typed entry may be (D-108, LAI-897), each with the word
 * on the segment and the glyph on the block. The list is the server's; the
 * order is the segment's.
 */
export interface KindFace {
  readonly kind: EntryKind;
  readonly label: string;
  readonly glyph: string;
}

const FACES: Readonly<Record<EntryKind, { label: string; glyph: string }>> = {
  meeting: { label: 'Meeting', glyph: '▣' },
  call: { label: 'Call', glyph: '☏' },
  review: { label: 'Review', glyph: '◎' },
  planning: { label: 'Planning', glyph: '▤' },
  learning: { label: 'Learning', glyph: '✎' },
  support: { label: 'Support', glyph: '✚' },
  admin: { label: 'Admin', glyph: '≡' },
  other: { label: 'Other', glyph: '•' },
};

export const KINDS: readonly KindFace[] = ENTRY_KINDS.map((kind) => ({ kind, ...FACES[kind] }));

export function kindLabel(kind: EntryKind): string {
  return FACES[kind].label;
}

export function kindGlyph(kind: EntryKind): string {
  return FACES[kind].glyph;
}
