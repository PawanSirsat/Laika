/**
 * The rules behind `Avatar` and `AvatarGroup` (LAI-1206), as plain data so
 * `node --test` can pin them.
 */

/** The four sizes, in px: rail rows, list rows, cards, headers. */
export const AVATAR_SIZES = [16, 20, 24, 32] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

/**
 * A person's presence, as the presence API reports it. `undefined` — not
 * known, or presence switched off for the organisation — draws no dot at all,
 * because a grey dot would claim *offline* when the truth is *not told*.
 */
export type Presence = 'online' | 'away' | 'offline';

/** The words for a presence dot, read aloud after the name. Never colour alone. */
export const PRESENCE_WORDS: Readonly<Record<Presence, string>> = {
  online: 'online',
  away: 'away',
  offline: 'offline',
};

export interface GroupOverflow {
  /** How many avatars to draw. */
  readonly shown: number;
  /** How many the `+N` stands for; 0 draws no `+N`. */
  readonly extra: number;
}

/**
 * How a group of `count` people fits in `max` places. When it does not, the
 * last place goes to the `+N` — so `+1` never stands in for a single face
 * that would have fitted in the same room.
 */
export function groupOverflow(count: number, max: number): GroupOverflow {
  const total = Math.max(0, Math.floor(count));
  const room = Math.max(1, Math.floor(max));
  if (total <= room) return { shown: total, extra: 0 };
  return { shown: room - 1, extra: total - (room - 1) };
}

/**
 * Who the `+N` stands for, in words, for its accessible name and its hover:
 * `and 3 more: Jo, Aleksandra Wiśniewska-Kowalczyk, Bartholomew Fitzgerald`.
 */
export function overflowWords(names: readonly string[]): string {
  return `and ${String(names.length)} more: ${names.join(', ')}`;
}
