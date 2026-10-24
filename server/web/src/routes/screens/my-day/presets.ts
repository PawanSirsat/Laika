import type { EntryKind } from '../../../api/time.ts';

/**
 * Off-screen work (the owner's design, D-110 item 5, LAI-504): time Laika
 * cannot see, one tap sets the kind and the title. The design's presets,
 * mapped onto the eight kinds.
 */
export interface Preset {
  readonly title: string;
  readonly kind: EntryKind;
}

export const PRESETS: readonly Preset[] = [
  { title: 'Brainstorm', kind: 'planning' },
  { title: 'Whiteboarding', kind: 'planning' },
  { title: 'Reading docs', kind: 'learning' },
  { title: 'Helping a teammate', kind: 'support' },
  { title: 'Interview', kind: 'meeting' },
  { title: 'Call', kind: 'call' },
];
