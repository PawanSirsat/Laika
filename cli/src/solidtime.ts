/**
 * The calls `laika time` makes to Solidtime, and nothing else (LAI-788,
 * D-088 item 10) — Solidtime v0.22's REST API, read from its source by the
 * integration research.
 *
 * **Only this machine talks to Solidtime.** The person's own personal access
 * token rides in `Authorization: Bearer` to the Solidtime URL they gave, and
 * to nowhere else; the board is never told either. A token acts with the
 * person's full role in Solidtime (its scopes are not enforced), which is why
 * it stays in a `0600` file and is never a flag.
 *
 * Shapes worth knowing, each a reason for something elsewhere:
 *
 * - resources come as `{ data }`; projects, tasks and members page by `page`
 *   (`meta.last_page`), time entries by `limit` ≤ 500 and `offset`
 *   (`meta.total`), newest start first;
 * - a time entry carries `user_id`, not `member_id`, and no `updated_at`;
 *   deletes are hard — so a sync re-reads a window and compares;
 * - `start` and `end` filter on the entry's start; times are
 *   `Y-m-d\TH:i:s\Z`, UTC;
 * - there is no idempotency key and no external id.
 */

export const REQUEST_TIMEOUT_MS = 20_000;
/** Solidtime's largest time-entry page. */
export const ENTRIES_PAGE = 500;
/** A list that has not ended after this many pages is not one this CLI trusts. */
const PAGES_MAX = 200;

export interface Connection {
  readonly url: string;
  readonly token: string;
  readonly organizationId?: string;
}

export interface StUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly timezone: string | null;
}

export interface StMembership {
  readonly id: string;
  readonly organization: { readonly id: string; readonly name: string };
  readonly role: string;
}

export interface StMember {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly is_placeholder: boolean;
}

export interface StProject {
  readonly id: string;
  readonly name: string;
  readonly is_billable: boolean;
  readonly is_archived: boolean;
}

export interface StTask {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
}

export interface StEntry {
  readonly id: string;
  readonly start: string;
  readonly end: string | null;
  readonly description: string | null;
  readonly task_id: string | null;
  readonly project_id: string | null;
  readonly user_id: string;
  readonly billable: boolean;
  readonly tags: readonly string[];
}

export type StResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly status?: number;
      /** Solidtime's own `key` for an API exception, such as `time_entry_still_running`. */
      readonly key?: string;
      readonly message: string;
    };

const ok = <T>(value: T): StResult<T> => ({ ok: true, value });

/** `Y-m-d\TH:i:s\Z` — the one form Solidtime takes. Seconds, never milliseconds. */
export function stTime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A Solidtime time as unix ms. */
export function stMs(value: string): number {
  return Date.parse(value);
}

async function call<T>(
  c: Connection,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<StResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${c.url}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    return {
      ok: false,
      message:
        name === 'TimeoutError'
          ? `Solidtime gave no answer within ${String(REQUEST_TIMEOUT_MS / 1000)} s`
          : `could not reach Solidtime (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
  if (response.status === 204) return ok(undefined as T);
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const b = (parsed ?? {}) as { key?: unknown; message?: unknown };
    return {
      ok: false,
      status: response.status,
      ...(typeof b.key === 'string' ? { key: b.key } : {}),
      message:
        response.status === 401
          ? 'Solidtime refused the key (401): it was revoked, has expired, or is not a key for this Solidtime'
          : `Solidtime answered ${String(response.status)}${typeof b.message === 'string' ? `: ${b.message}` : ''}`,
    };
  }
  return ok(parsed as T);
}

const org = (c: Connection): string => {
  if (c.organizationId === undefined) throw new Error('no Solidtime organisation chosen');
  return `/organizations/${encodeURIComponent(c.organizationId)}`;
};

function unwrap<T>(r: StResult<{ data?: T }>, what: string): StResult<T> {
  if (!r.ok) return r;
  if (r.value.data === undefined) return { ok: false, message: `Solidtime's ${what} had no data` };
  return ok(r.value.data);
}

/** Every page of a `page`-paged list. */
async function allPages<T>(c: Connection, path: string, what: string): Promise<StResult<T[]>> {
  const out: T[] = [];
  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const r = await call<{ data?: T[]; meta?: { last_page?: number } }>(
      c,
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}page=${String(page)}`,
    );
    if (!r.ok) return r;
    if (!Array.isArray(r.value.data))
      return { ok: false, message: `Solidtime's ${what} had no data` };
    out.push(...r.value.data);
    const last = r.value.meta?.last_page ?? page;
    if (page >= last || r.value.data.length === 0) return ok(out);
  }
  return { ok: false, message: `Solidtime's ${what} did not end after ${String(PAGES_MAX)} pages` };
}

export const me = async (c: Connection): Promise<StResult<StUser>> =>
  unwrap(await call<{ data?: StUser }>(c, 'GET', '/users/me'), 'account');

export const memberships = async (c: Connection): Promise<StResult<StMembership[]>> =>
  unwrap(await call<{ data?: StMembership[] }>(c, 'GET', '/users/me/memberships'), 'memberships');

/** Everyone in the organisation — `403` for an employee's key. */
export const members = (c: Connection): Promise<StResult<StMember[]>> =>
  allPages<StMember>(c, `${org(c)}/members`, 'members');

export const projects = (c: Connection): Promise<StResult<StProject[]>> =>
  allPages<StProject>(c, `${org(c)}/projects`, 'projects');

export const tasks = (c: Connection): Promise<StResult<StTask[]>> =>
  allPages<StTask>(c, `${org(c)}/tasks`, 'tasks');

export interface EntryWindow {
  readonly entries: StEntry[];
  /**
   * Every page was read and the count agrees with `meta.total`. Offset paging
   * over a list that changes under it can skip or repeat a row; only a whole
   * window may be used to infer a delete, or to say an entry is not there.
   */
  readonly complete: boolean;
  /** What stopped the read, when it stopped early. */
  readonly stopped?: string;
}

/** The entries starting from `fromMs` to `toMs` — one member's, or everyone's the key may see. */
export async function entries(
  c: Connection,
  window: { fromMs: number; toMs: number; memberId?: string },
): Promise<StResult<EntryWindow>> {
  const seen = new Map<string, StEntry>();
  let total = 0;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const query = new URLSearchParams({
      start: stTime(window.fromMs),
      end: stTime(window.toMs),
      limit: String(ENTRIES_PAGE),
      offset: String(page * ENTRIES_PAGE),
    });
    if (window.memberId !== undefined) query.set('member_id', window.memberId);
    const r = await call<{ data?: StEntry[]; meta?: { total?: number } }>(
      c,
      'GET',
      `${org(c)}/time-entries?${query.toString()}`,
    );
    if (!r.ok) {
      if (page === 0) return r;
      return ok({ entries: [...seen.values()], complete: false, stopped: r.message });
    }
    const data = r.value.data;
    if (!Array.isArray(data)) return { ok: false, message: "Solidtime's time entries had no data" };
    for (const e of data) seen.set(e.id, e);
    total = r.value.meta?.total ?? seen.size;
    if ((page + 1) * ENTRIES_PAGE >= total || data.length === 0) break;
  }
  return ok({ entries: [...seen.values()], complete: seen.size === total });
}

export interface EntryWrite {
  readonly member_id: string;
  readonly project_id: string | null;
  readonly start: string;
  readonly end: string | null;
  readonly billable: boolean;
  readonly description: string | null;
  readonly task_id?: string | null;
  readonly tags?: readonly string[];
}

export const createEntry = async (c: Connection, body: EntryWrite): Promise<StResult<StEntry>> =>
  unwrap(await call<{ data?: StEntry }>(c, 'POST', `${org(c)}/time-entries`, body), 'new entry');

export const updateEntry = async (
  c: Connection,
  id: string,
  body: Partial<EntryWrite>,
): Promise<StResult<StEntry>> =>
  unwrap(
    await call<{ data?: StEntry }>(
      c,
      'PUT',
      `${org(c)}/time-entries/${encodeURIComponent(id)}`,
      body,
    ),
    'entry',
  );

export async function deleteEntry(c: Connection, id: string): Promise<StResult<true>> {
  const r = await call<unknown>(c, 'DELETE', `${org(c)}/time-entries/${encodeURIComponent(id)}`);
  return r.ok ? ok(true) : r;
}

/** The person's running timer, or `null` when none runs (Solidtime answers 404). */
export async function activeEntry(c: Connection): Promise<StResult<StEntry | null>> {
  const r = await call<{ data?: StEntry }>(c, 'GET', '/users/me/time-entries/active');
  if (!r.ok) return r.status === 404 ? ok(null) : r;
  return ok(r.value.data ?? null);
}
