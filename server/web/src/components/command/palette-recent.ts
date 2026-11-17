/**
 * The palette's *Recent* (LAI-1221): the last few places opened from it,
 * shown before anything is typed.
 *
 * **Ids only, never content.** A page is its path, a space its slug, a person
 * their id, a task its id, its key (`LC-12`) and its space's slug — what the
 * address bar already shows. No title, no name, no query is written: a task's
 * title or a search can say more than its owner would want left in a shared
 * browser. Names are looked up again from what the reader may read *now*, so a
 * page or a person since withdrawn from them is not offered again.
 *
 * Per person (`recentKey`), and storage that refuses is no Recent, never an
 * error.
 */

export type RecentKind = 'page' | 'space' | 'task' | 'person';

export interface RecentEntry {
  readonly kind: RecentKind;
  /** The path, the slug, the task's id or the person's id. */
  readonly id: string;
  /** A task's key, as `LC-12`. */
  readonly key?: string | undefined;
  /** A task's space, by slug — where it opens. */
  readonly space?: string | undefined;
}

/** How many Recent shows. */
export const RECENT_LIMIT = 5;

export function recentKey(userId: string): string {
  return `laika.palette.recent.${userId}`;
}

const KINDS: ReadonlySet<string> = new Set(['page', 'space', 'task', 'person']);
/** What an id may look like: a path, a slug, a ULID, a key. Nothing with spaces. */
const ID = /^[A-Za-z0-9/_.:-]{1,200}$/;

function valid(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.kind !== 'string' || !KINDS.has(row.kind)) return false;
  if (typeof row.id !== 'string' || !ID.test(row.id)) return false;
  if (row.key !== undefined && (typeof row.key !== 'string' || !ID.test(row.key))) return false;
  if (row.space !== undefined && (typeof row.space !== 'string' || !ID.test(row.space))) {
    return false;
  }
  return true;
}

/** Only the fields an entry may carry, so nothing else is ever written. */
function strip(entry: RecentEntry): RecentEntry {
  return {
    kind: entry.kind,
    id: entry.id,
    ...(entry.key === undefined ? {} : { key: entry.key }),
    ...(entry.space === undefined ? {} : { space: entry.space }),
  };
}

export function readRecent(
  storage: Pick<Storage, 'getItem'> | undefined,
  userId: string,
): readonly RecentEntry[] {
  try {
    const raw = storage?.getItem(recentKey(userId)) ?? null;
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(valid).map(strip).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** `entry` first, any older copy of it gone, at most {@link RECENT_LIMIT}. */
export function pushRecent(
  list: readonly RecentEntry[],
  entry: RecentEntry,
): readonly RecentEntry[] {
  if (!valid(entry)) return list;
  const rest = list.filter((e) => !(e.kind === entry.kind && e.id === entry.id));
  return [strip(entry), ...rest].slice(0, RECENT_LIMIT);
}

export function writeRecent(
  storage: Pick<Storage, 'setItem'> | undefined,
  userId: string,
  list: readonly RecentEntry[],
): void {
  try {
    storage?.setItem(recentKey(userId), JSON.stringify(list.map(strip)));
  } catch {
    // No Recent next time; nothing else depends on it.
  }
}
