import { request } from './client.ts';
import { ApiError, NetworkError } from './errors.ts';

/**
 * What Microsoft's directory says of each person, as Laika keeps it (D-161,
 * LAI-1330): their job title, department, manager and synced photo, by user
 * id — one read, `GET /people/directory`, held here for every avatar and
 * every row that shows a person.
 *
 * Module state, not React context, as `project-looks.ts` is: a person is
 * drawn in many places, and most of them hold only an id and a name. Every
 * avatar given a user id reads this one map, so nothing else needs to carry
 * a photo. The read happens once a session, the first time something asks
 * (`loadDirectory`), and again when the people sync is run from its card
 * (`reloadDirectory`); a read that fails for want of an answer is tried
 * again, backing off, rather than leaving the session faceless (review F9).
 * Anyone the sync has not read has no entry, and is drawn by their
 * initials, as everyone was before.
 */

/** One person's entry. */
export interface PersonDirectory {
  /** `?v=` for their photo, or null when there is none to ask for. */
  readonly photo_v: number | null;
  readonly job_title: string | null;
  readonly department: string | null;
  /** Their manager's user id, when the directory names one who is on the board. */
  readonly manager_id: string | null;
  /** That manager's name, for "Reports to". */
  readonly manager_name: string | null;
}

/** `GET /api/v1/people/directory`: everyone the sync has read, by user id. */
export interface PeopleDirectory {
  readonly people: Readonly<Record<string, PersonDirectory>>;
}

/** `GET /api/v1/people/directory` (`member_list.read`, every role). */
export function getPeopleDirectory(signal?: AbortSignal): Promise<PeopleDirectory> {
  return request<PeopleDirectory>('/people/directory', signal === undefined ? {} : { signal });
}

/**
 * Where a person's photo is, at its version — served by Laika from the store,
 * so `img-src 'self'` covers it and a year's cache keeps it — or null.
 */
export function photoUrlOf(userId: string, entry: PersonDirectory | undefined): string | null {
  if (entry?.photo_v == null) return null;
  return `/api/v1/users/${encodeURIComponent(userId)}/photo?v=${String(entry.photo_v)}`;
}

const entries = new Map<string, PersonDirectory>();
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let loaded = false;
let version = 0;
let failures = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
/**
 * Which user's reads count: {@link forgetDirectory} moves it, and a read that
 * began before then is dropped when it answers — an admin's titles must not
 * land in a viewer's session signed in mid-read (review round 2).
 */
let generation = 0;

/** The first wait before a failed read is tried again; each next one doubles, to the most. */
export const DIRECTORY_RETRY_FIRST_MS = 2_000;
export const DIRECTORY_RETRY_MOST_MS = 60_000;
/** How many times a failed read is tried again before the session does without. */
export const DIRECTORY_RETRIES = 6;

/**
 * A failure worth trying again: no answer at all, a `5xx` or a `429`. A
 * refusal is an answer — an older server with no directory, a caller who
 * may not read it — and asking again changes nothing.
 */
function worthRetrying(cause: unknown): boolean {
  if (cause instanceof NetworkError) return true;
  return cause instanceof ApiError && (cause.status >= 500 || cause.status === 429);
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** A number that moves whenever any entry does — what a derived read keys on. */
export function directoryVersion(): number {
  return version;
}

function same(a: PersonDirectory, b: PersonDirectory): boolean {
  return (
    a.photo_v === b.photo_v &&
    a.job_title === b.job_title &&
    a.department === b.department &&
    a.manager_id === b.manager_id &&
    a.manager_name === b.manager_name
  );
}

/**
 * Hold this answer as the directory. An entry that did not change keeps its
 * object, so nothing reading it draws again; anyone no longer in it is gone.
 */
export function rememberDirectory(view: PeopleDirectory): void {
  // An answer that is not a directory — a stub, an empty body — teaches nothing.
  const people = (view as Partial<PeopleDirectory> | null | undefined)?.people;
  if (people === undefined || people === null || typeof people !== 'object') return;
  let changed = false;
  for (const id of [...entries.keys()]) {
    if (!(id in people)) {
      entries.delete(id);
      changed = true;
    }
  }
  for (const [id, entry] of Object.entries(people)) {
    const held = entries.get(id);
    if (held !== undefined && same(held, entry)) continue;
    entries.set(id, entry);
    changed = true;
  }
  if (changed) notify();
}

/** A person's entry, or `undefined` when the sync has not read them (or nothing has loaded). */
export function directoryEntryOf(userId: string): PersonDirectory | undefined {
  return entries.get(userId);
}

/** Everyone whose manager is `userId` — the "My team" filter's people. */
export function reportsOf(userId: string): ReadonlySet<string> {
  const team = new Set<string>();
  for (const [id, entry] of entries) if (entry.manager_id === userId) team.add(id);
  return team;
}

/** Be told when any entry changes; the answer stops telling. */
export function subscribeDirectory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read the directory, once a session: a second ask while the first is going
 * joins it, and one after it has answered does nothing. A board whose server
 * has no directory, or that refuses it, is a directory with nobody in it. A
 * read that got no answer is tried again after a wait that doubles, up to
 * {@link DIRECTORY_RETRIES} times.
 */
export function loadDirectory(): Promise<void> {
  if (loaded) return Promise.resolve();
  const mine = generation;
  loading ??= getPeopleDirectory()
    .then((view) => {
      if (mine !== generation) return;
      rememberDirectory(view);
      loaded = true;
      failures = 0;
    })
    .catch((cause: unknown) => {
      if (mine !== generation) return;
      if (!worthRetrying(cause) || failures >= DIRECTORY_RETRIES) {
        loaded = true;
        return;
      }
      failures += 1;
      const wait = Math.min(
        DIRECTORY_RETRY_MOST_MS,
        DIRECTORY_RETRY_FIRST_MS * 2 ** (failures - 1),
      );
      if (retry !== null) clearTimeout(retry);
      retry = setTimeout(() => {
        retry = null;
        void loadDirectory();
      }, wait);
    })
    .finally(() => {
      if (mine === generation) loading = null;
    });
  return loading;
}

/** Read it again — after the people sync ran from its card. */
export function reloadDirectory(): Promise<void> {
  loaded = false;
  return loadDirectory();
}

/** Forget everyone — on a change of user (`setStoreUser`, sign-out included), and between tests. */
export function forgetDirectory(): void {
  generation += 1;
  loaded = false;
  loading = null;
  failures = 0;
  if (retry !== null) clearTimeout(retry);
  retry = null;
  if (entries.size === 0) return;
  entries.clear();
  notify();
}
