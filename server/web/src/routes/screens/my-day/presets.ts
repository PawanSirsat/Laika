import type { EntryKind } from '../../../api/time.ts';

/**
 * Off-screen work (the owner's design, D-110 item 5, LAI-504): time Laika
 * cannot see, one tap sets the kind and the title. The design's six presets,
 * each on the design's own kind (LAI-516).
 */
export interface Preset {
  readonly title: string;
  readonly kind: EntryKind;
}

export const PRESETS: readonly Preset[] = [
  { title: 'Brainstorm', kind: 'thinking' },
  { title: 'Whiteboarding', kind: 'thinking' },
  { title: 'Reading docs', kind: 'research' },
  { title: 'Planning', kind: 'thinking' },
  { title: 'Helping a teammate', kind: 'support' },
  { title: 'Interview', kind: 'meeting' },
];
