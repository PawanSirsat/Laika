/**
 * Task labels.
 *
 * **No API.** There is no tags table, no column on `tasks`, and no endpoint —
 * `grep -i tag server/src` finds only prose. The design puts label chips on
 * every card (`agent`, `core`, `presence`, `auth`, `ui`), so they are derived
 * here instead.
 *
 * Replace with: a task-labels endpoint, once one exists.
 *
 * Derived from the task id rather than random, so a card keeps the same labels
 * across renders and reloads — a chip that changed on every paint would read as
 * a bug rather than as sample data.
 */

export type TagTone = 'agent' | 'presence' | 'auth' | 'ui' | 'neutral';

export interface DemoTag {
  readonly label: string;
  readonly tone: TagTone;
}

/** The palette the prototype uses, with its tone mapping. */
const VOCABULARY: readonly DemoTag[] = [
  { label: 'agent', tone: 'agent' },
  { label: 'ai', tone: 'agent' },
  { label: 'presence', tone: 'presence' },
  { label: 'auth', tone: 'auth' },
  { label: 'ui', tone: 'ui' },
  { label: 'core', tone: 'neutral' },
  { label: 'audit', tone: 'neutral' },
  { label: 'infra', tone: 'neutral' },
  { label: 'billing', tone: 'neutral' },
];

/** FNV-1a, the same hash `theme/avatar-color.ts` uses. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Zero, one or two labels for a task. Not every card carries them in the
 * design, and a board where every card has chips reads as noise.
 */
export function demoTags(taskId: string): readonly DemoTag[] {
  // D-032: demo data must be incapable of reaching a production build. Vite
  // substitutes this literally, so everything below is dead code in prod and the
  // minifier removes the fixtures with it. `demo-not-in-bundle.test.ts` greps
  // the built bundle and fails if any of it survives.
  if (import.meta.env.PROD) return [];

  const h = hash(taskId);
  const count = h % 3;
  if (count === 0) return [];

  const first = VOCABULARY[h % VOCABULARY.length];
  if (first === undefined) return [];
  if (count === 1) return [first];

  const second = VOCABULARY[(h >>> 8) % VOCABULARY.length];
  if (second === undefined || second.label === first.label) return [first];
  return [first, second];
}
