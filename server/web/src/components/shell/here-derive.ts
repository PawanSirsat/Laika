import { formatDurationMs } from '../../api/duration.ts';
import type { PresencePerson } from '../../api/presence.ts';
import { groupOverflow } from '../avatar/avatar-model.ts';

/**
 * The top bar's *who's here* (LAI-1348), as plain data so `node --test` can pin
 * it: which faces are drawn, what the stack says aloud, and what changed
 * between two reads — the arrivals and departures the stack animates.
 */

/** Faces drawn before the `+N` takes the last place; fewer below 1280px. */
export const HERE_MAX = 3;
export const HERE_MAX_NARROW = 2;

export interface HereFaces {
  readonly shown: readonly PresencePerson[];
  /** How many the `+N` stands for; 0 draws none. */
  readonly extra: number;
}

/** The people in the order the server sends them — online first — cut to `max` places. */
export function hereFaces(people: readonly PresencePerson[], max: number): HereFaces {
  const { shown, extra } = groupOverflow(people.length, max);
  return { shown: people.slice(0, shown), extra };
}

/** Status in words, never colour alone. */
export const HERE_WORDS: Readonly<Record<PresencePerson['status'], string>> = {
  online: 'online',
  away: 'away',
};

/**
 * What the stack says aloud and on hover: how many, and who among those drawn,
 * each with their status — `3 people online or away: Ada, online; Jo, away;
 * and 1 more`.
 */
export function hereLabel(people: readonly PresencePerson[], max: number): string {
  const { shown, extra } = hereFaces(people, max);
  const who = shown.map((p) => `${p.name}, ${HERE_WORDS[p.status]}`);
  if (extra > 0) who.push(`and ${String(extra)} more`);
  const count = `${String(people.length)} ${people.length === 1 ? 'person' : 'people'}`;
  return `${count} online or away: ${who.join('; ')}`;
}

/** One person's line in the list: `Online now`, or `Away · 11 min`, as Capacity says it. */
export function hereStatusText(person: PresencePerson, now: number): string {
  if (person.status === 'online') return 'Online now';
  const away = Math.max(60_000, Math.floor((now - person.last_seen) / 60_000) * 60_000);
  return `Away · ${formatDurationMs(away)}`;
}

export interface HereDiff {
  /** Here now and not before. */
  readonly arrived: readonly PresencePerson[];
  /** Here before and gone now — still drawn while they leave. */
  readonly left: readonly PresencePerson[];
  /** Here both times, with a different status. */
  readonly changed: readonly PresencePerson[];
}

const NOTHING: HereDiff = { arrived: [], left: [], changed: [] };

/**
 * What changed between two reads. **The first read changes nothing**
 * (`before` undefined): the stack appears as it is, and only what happens
 * while it is on screen animates.
 */
export function diffHere(
  before: readonly PresencePerson[] | undefined,
  after: readonly PresencePerson[],
): HereDiff {
  if (before === undefined) return NOTHING;
  const was = new Map(before.map((p) => [p.user_id, p]));
  const now = new Set(after.map((p) => p.user_id));
  return {
    arrived: after.filter((p) => !was.has(p.user_id)),
    left: before.filter((p) => !now.has(p.user_id)),
    changed: after.filter((p) => {
      const old = was.get(p.user_id);
      return old !== undefined && old.status !== p.status;
    }),
  };
}

/** The polite announcement for a change, or `''` when there is nothing to say. */
export function hereAnnouncement(diff: HereDiff): string {
  const lines = [
    ...diff.arrived.map((p) =>
      p.status === 'online' ? `${p.name} came online` : `${p.name} is away`,
    ),
    ...diff.changed.map((p) =>
      p.status === 'online' ? `${p.name} came online` : `${p.name} is away`,
    ),
    ...diff.left.map((p) => `${p.name} went offline`),
  ];
  return lines.length === 0 ? '' : `${lines.join('. ')}.`;
}
