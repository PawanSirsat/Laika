import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';

/**
 * A Solidtime that answers the calls `laika time` makes, **in the shapes
 * Solidtime v0.22.0 serves them** (LAI-788). Read from the integration
 * research, which read Solidtime's source at that tag:
 *
 * - Every route is under `/api/v1`, behind a personal access token as
 *   `Authorization: Bearer`; anything else is `401 {"message":"Unauthenticated."}`.
 * - Resources come wrapped in Laravel's `{ "data": … }`; lists of projects,
 *   tasks and members page by `page` with `meta.last_page`; time entries page
 *   by `limit` (1–500, default 100) and `offset`, with `meta.total`, ordered
 *   by `start` descending.
 * - A time entry is `id, start, end, duration, description, task_id,
 *   project_id, organization_id, user_id, tags, billable` — `user_id`, never
 *   `member_id`, and no `updated_at`. Times are `Y-m-d\TH:i:s\Z`, UTC.
 * - `start` and `end` filters both apply to the entry's **start**.
 * - Creating needs `member_id`, `start` and `billable`; `end: null` starts a
 *   timer, refused `time_entry_still_running` while one runs. Stopping is a
 *   `PUT` with `end`. Deletes are hard.
 * - An employee sees and writes their own entries only, and cannot list
 *   members (`403`); a manager or above sees everyone.
 * - API exceptions answer `400 { "error": true, "key", "message" }`.
 *
 * No idempotency key, no external id, no webhook: exactly what the bridge has
 * to work around.
 */

export type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'placeholder';

export interface FakeMember {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: Role;
  is_placeholder: boolean;
}

export interface FakeProject {
  id: string;
  name: string;
  is_billable: boolean;
  client_id: string | null;
  is_archived: boolean;
}

export interface FakeTask {
  id: string;
  name: string;
  project_id: string;
  is_done: boolean;
}

export interface FakeEntry {
  id: string;
  start: string;
  end: string | null;
  description: string | null;
  task_id: string | null;
  project_id: string | null;
  user_id: string;
  billable: boolean;
  tags: string[];
}

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly auth: string | undefined;
  readonly body: string;
}

export interface FakeSolidtime {
  readonly url: string;
  readonly token: string;
  readonly org: { id: string; name: string };
  /** The token's own person, a member of `org`. */
  readonly me: FakeMember & { timezone: string };
  readonly members: FakeMember[];
  readonly projects: FakeProject[];
  readonly tasks: FakeTask[];
  readonly entries: FakeEntry[];
  readonly requests: Recorded[];
  /** The organisation's `prevent_overlapping_time_entries`. */
  preventOverlap: boolean;
  /** The entry listing answers 500 at this offset — a page that failed. */
  failAtOffset: number | undefined;
  /** Projects, tasks and members per page; Solidtime's default is 15. */
  pageSize: number;
  add(entry: Partial<FakeEntry> & { start: string }): FakeEntry;
  close(): Promise<void>;
}

/** `Y-m-d\TH:i:s\Z` for a unix-ms instant, as Solidtime writes times. */
export function solidtimeTime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const durationOf = (e: FakeEntry): number | null =>
  e.end === null ? null : Math.round((Date.parse(e.end) - Date.parse(e.start)) / 1000);

function resource(e: FakeEntry, orgId: string): Record<string, unknown> {
  return {
    id: e.id,
    start: e.start,
    end: e.end,
    duration: durationOf(e),
    description: e.description,
    task_id: e.task_id,
    project_id: e.project_id,
    organization_id: orgId,
    user_id: e.user_id,
    tags: e.tags,
    billable: e.billable,
  };
}

export async function fakeSolidtime(
  options: { role?: Role; email?: string; token?: string } = {},
): Promise<FakeSolidtime> {
  const token = options.token ?? 'st-pat-for-tests-only';
  const org = { id: randomUUID(), name: 'Kvell' };
  const me: FakeMember & { timezone: string } = {
    id: randomUUID(),
    user_id: randomUUID(),
    name: 'Ada Lovelace',
    email: options.email ?? 'ada@example.test',
    role: options.role ?? 'employee',
    is_placeholder: false,
    timezone: 'Africa/Johannesburg',
  };

  const fake: FakeSolidtime = {
    url: '',
    token,
    org,
    me,
    members: [me],
    projects: [],
    tasks: [],
    entries: [],
    requests: [],
    preventOverlap: false,
    failAtOffset: undefined,
    pageSize: 15,
    add(entry) {
      const full: FakeEntry = {
        id: randomUUID(),
        end: null,
        description: null,
        task_id: null,
        project_id: null,
        user_id: me.user_id,
        billable: false,
        tags: [],
        ...entry,
      };
      fake.entries.push(full);
      return full;
    },
    close: () => Promise.resolve(),
  };

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const apiError = (res: ServerResponse, key: string, message: string) =>
    send(res, 400, { error: true, key, message });
  const paged = <T>(res: ServerResponse, items: T[], query: URLSearchParams) => {
    const page = Math.max(1, Number(query.get('page') ?? '1'));
    const per = fake.pageSize;
    const last = Math.max(1, Math.ceil(items.length / per));
    send(res, 200, {
      data: items.slice((page - 1) * per, page * per),
      links: {},
      meta: { current_page: page, last_page: last, per_page: per, total: items.length },
    });
  };
  const canSeeAll = () => me.role !== 'employee' && me.role !== 'placeholder';
  const overlaps = (userId: string, start: string, end: string | null, except?: string) =>
    fake.entries.some(
      (e) =>
        e.id !== except &&
        e.user_id === userId &&
        Date.parse(e.start) < (end === null ? Infinity : Date.parse(end)) &&
        (e.end === null ? Infinity : Date.parse(e.end)) > Date.parse(start),
    );

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += String(chunk)));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      fake.requests.push({
        method: req.method ?? '',
        path: url.pathname,
        query: url.searchParams,
        auth: req.headers.authorization,
        body,
      });
      if (req.headers.authorization !== `Bearer ${token}`) {
        send(res, 401, { message: 'Unauthenticated.' });
        return;
      }
      const path = url.pathname;
      const method = req.method ?? 'GET';
      const json = (): Record<string, unknown> => {
        try {
          return JSON.parse(body) as Record<string, unknown>;
        } catch {
          return {};
        }
      };

      if (method === 'GET' && path === '/api/v1/users/me') {
        send(res, 200, {
          data: {
            id: me.user_id,
            name: me.name,
            email: me.email,
            profile_photo_url: '',
            timezone: me.timezone,
            week_start: 'monday',
          },
        });
        return;
      }
      if (method === 'GET' && path === '/api/v1/users/me/memberships') {
        send(res, 200, {
          data: [
            {
              id: me.id,
              organization: { id: org.id, name: org.name, currency: 'EUR' },
              role: me.role,
            },
          ],
        });
        return;
      }
      if (method === 'GET' && path === '/api/v1/users/me/time-entries/active') {
        const running = fake.entries.find((e) => e.user_id === me.user_id && e.end === null);
        if (running === undefined) send(res, 404, { message: 'No active time entry' });
        else send(res, 200, { data: resource(running, org.id) });
        return;
      }

      const base = `/api/v1/organizations/${org.id}`;
      if (!path.startsWith(base)) {
        send(res, 404, { message: 'Not found' });
        return;
      }
      const rest = path.slice(base.length);

      if (method === 'GET' && rest === '/members') {
        if (!canSeeAll()) {
          send(res, 403, { message: 'This action is unauthorized.' });
          return;
        }
        paged(
          res,
          fake.members.map((m) => ({ ...m, billable_rate: null })),
          url.searchParams,
        );
        return;
      }
      if (method === 'GET' && rest === '/projects') {
        paged(
          res,
          fake.projects.map((p) => ({
            ...p,
            color: '#ef5350',
            billable_rate: null,
            estimated_time: null,
            spent_time: 0,
            is_public: true,
          })),
          url.searchParams,
        );
        return;
      }
      if (method === 'GET' && rest === '/tasks') {
        paged(
          res,
          fake.tasks.map((t) => ({ ...t, estimated_time: null, spent_time: 0 })),
          url.searchParams,
        );
        return;
      }

      if (method === 'GET' && rest === '/time-entries') {
        const q = url.searchParams;
        const memberId = q.get('member_id');
        if (!canSeeAll() && memberId !== me.id) {
          send(res, 403, { message: 'This action is unauthorized.' });
          return;
        }
        const limit = Math.min(500, Math.max(1, Number(q.get('limit') ?? '100')));
        const offset = Math.max(0, Number(q.get('offset') ?? '0'));
        if (fake.failAtOffset !== undefined && offset >= fake.failAtOffset) {
          send(res, 500, { message: 'Server Error' });
          return;
        }
        const member = memberId === null ? undefined : fake.members.find((m) => m.id === memberId);
        const start = q.get('start');
        const end = q.get('end');
        const all = fake.entries
          .filter((e) => member === undefined || e.user_id === member.user_id)
          .filter((e) => start === null || Date.parse(e.start) >= Date.parse(start))
          .filter((e) => end === null || Date.parse(e.start) <= Date.parse(end))
          .filter((e) => q.get('active') !== 'true' || e.end === null)
          .sort((a, b) => Date.parse(b.start) - Date.parse(a.start) || a.id.localeCompare(b.id));
        send(res, 200, {
          data: all.slice(offset, offset + limit).map((e) => resource(e, org.id)),
          meta: { total: all.length },
        });
        return;
      }

      if (method === 'POST' && rest === '/time-entries') {
        const b = json();
        const member = fake.members.find((m) => m.id === b.member_id);
        if (
          member === undefined ||
          typeof b.start !== 'string' ||
          typeof b.billable !== 'boolean'
        ) {
          send(res, 422, {
            message: 'The given data was invalid.',
            errors: { member_id: ['The member id field is required.'] },
          });
          return;
        }
        if (!canSeeAll() && member.id !== me.id) {
          send(res, 403, { message: 'This action is unauthorized.' });
          return;
        }
        const end = typeof b.end === 'string' ? b.end : null;
        if (
          end === null &&
          fake.entries.some((e) => e.user_id === member.user_id && e.end === null)
        ) {
          apiError(res, 'time_entry_still_running', 'Time entry is still running');
          return;
        }
        if (fake.preventOverlap && overlaps(member.user_id, b.start, end)) {
          apiError(res, 'overlapping_time_entry', 'Overlapping time entries are not allowed');
          return;
        }
        const created = fake.add({
          start: b.start,
          end,
          description: typeof b.description === 'string' ? b.description : null,
          project_id: typeof b.project_id === 'string' ? b.project_id : null,
          task_id: typeof b.task_id === 'string' ? b.task_id : null,
          user_id: member.user_id,
          billable: b.billable,
          tags: Array.isArray(b.tags) ? (b.tags as string[]) : [],
        });
        send(res, 201, { data: resource(created, org.id) });
        return;
      }

      const one = /^\/time-entries\/([^/]+)$/.exec(rest);
      if (one !== null) {
        const found = fake.entries.find((e) => e.id === one[1]);
        if (found === undefined) {
          send(res, 404, { message: 'Not found' });
          return;
        }
        if (!canSeeAll() && found.user_id !== me.user_id) {
          send(res, 403, { message: 'This action is unauthorized.' });
          return;
        }
        if (method === 'DELETE') {
          fake.entries.splice(fake.entries.indexOf(found), 1);
          send(res, 204);
          return;
        }
        if (method === 'PUT') {
          const b = json();
          if (found.end !== null && 'end' in b && b.end === null) {
            apiError(res, 'time_entry_can_not_be_restarted', 'Time entry can not be restarted');
            return;
          }
          const next = {
            start: typeof b.start === 'string' ? b.start : found.start,
            end: 'end' in b ? (typeof b.end === 'string' ? b.end : null) : found.end,
          };
          if (fake.preventOverlap && overlaps(found.user_id, next.start, next.end, found.id)) {
            apiError(res, 'overlapping_time_entry', 'Overlapping time entries are not allowed');
            return;
          }
          found.start = next.start;
          found.end = next.end;
          if ('description' in b) {
            found.description = typeof b.description === 'string' ? b.description : null;
          }
          if ('project_id' in b) {
            found.project_id = typeof b.project_id === 'string' ? b.project_id : null;
          }
          if ('task_id' in b) found.task_id = typeof b.task_id === 'string' ? b.task_id : null;
          if (typeof b.billable === 'boolean') found.billable = b.billable;
          if (Array.isArray(b.tags)) found.tags = b.tags as string[];
          send(res, 200, { data: resource(found, org.id) });
          return;
        }
      }

      send(res, 404, { message: 'Not found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  (fake as { url: string }).url = `http://127.0.0.1:${String(address.port)}`;
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}
