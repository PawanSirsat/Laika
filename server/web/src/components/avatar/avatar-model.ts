/**
 * The rules behind `Avatar` and `AvatarGroup` (LAI-1206), as plain data so
 * `node --test` can pin them.
 */

/**
 * The sizes, in px: rail rows, list rows, cards and headers (LAI-1206), and
 * the three the people surfaces drew by hand before D-161 converged them —
 * a row's and the header's 28, a Capacity card's or a comment's 36, and a
 * profile's 60 — and the two the last hand-drawn discs had (LAI-1336): a
 * task row's, a dropdown's and a swimlane's 22, and a picker row's 26.
 */
export const AVATAR_SIZES = [16, 20, 22, 24, 26, 28, 32, 36, 60] as const;
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

/** The two states a face is ringed for (LAI-1349): offline and unknown wear none. */
export type Ring = 'online' | 'away';

/**
 * The class that rings a face by its status — green online, amber away, as
 * Capacity's cards and the header's who's-here — or `''` for no ring. For a
 * face drawn alone (a picker row); a stack's button rings its own border.
 */
export function ringClass(ring: Ring | undefined): string {
  return ring === undefined ? '' : `avatar-ring avatar-ring-${ring}`;
}
