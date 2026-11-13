/**
 * A fake Clan (D-149, LAI-1181), served through an injected `fetch` — **no
 * test makes a real call** to an HR system.
 *
 * It answers the calls `services/clan-client.ts` makes: `GET /auth/me`, and
 * `GET /employee`, `/holiday` and `/leave` as `{data, meta: {paging:
 * {total}}}`, paged by `limit` (at most 1000) and `offset`. A request
 * without the token is `401`; a path in `forbidden` is `403`, as for a role
 * that may not read it. `total` can be made to lie, as a live Clan's did
 * (LAI-1180's log: `total: 2` for 25 rows).
 *
 * `intercept` answers a request before the fake does — a `429`, a `500` on
 * the second page, a hang until the client gives up — and `hold` keeps every
 * list read waiting until released, so a test can start a second sync while
 * the first is still reading.
 */

export const CLAN_BASE = 'https://kvell.clan.biz/api/v1';
/** The HR account the fixture token belongs to. */
export const CLAN_ACCOUNT = 'Forge';
/** A fixture string, never a real credential: Sanctum's `{id}|{plain}`. */
export const CLAN_TOKEN = '42|fixtureTokenPlainPart0123456789abcdWXYZ';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | null;
  body: string;
}

/** What `intercept` may answer: a response, a hang until the client aborts, or nothing — the fake answers. */
export type Intercepted = Response | 'hang' | undefined;

export interface FakeClanOptions {
  employees?: Record<string, unknown>[];
  holidays?: Record<string, unknown>[];
  leave?: Record<string, unknown>[];
  /** What `/auth/me` answers as `data`. */
  me?: Record<string, unknown>;
}

export interface FakeClan {
  fetchImpl: typeof fetch;
  requests: FakeRequest[];
  employees: Record<string, unknown>[];
  holidays: Record<string, unknown>[];
  leave: Record<string, unknown>[];
  /** The token every read requires. */
  token: string;
  /** Paths answered `403`, as for a role that may not read them. */
  forbidden: Set<string>;
  /** What `meta.paging.total` says: the true count, a fixed number, or nothing. */
  total: 'rows' | number | 'absent';
  /** Answer a request before the fake does; return undefined to let it. */
  intercept: ((req: FakeRequest) => Intercepted) | null;
  /** Keep every `GET` waiting until the returned function is called. */
  hold(): () => void;
  /** The requests to one path, in order. */
  to(path: string): FakeRequest[];
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function page(
  rows: Record<string, unknown>[],
  query: URLSearchParams,
  total: FakeClan['total'],
): Response {
  const limit = Math.min(Number(query.get('limit') ?? '1000'), 1000);
  const offset = Number(query.get('offset') ?? '0');
  const data = rows.slice(offset, offset + limit);
  if (total === 'absent') return json(200, { data });
  return json(200, {
    data,
    meta: { paging: { total: total === 'rows' ? rows.length : total } },
  });
}

/** A promise that settles only when the request's signal aborts — Clan hung. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

export function fakeClan(options: FakeClanOptions = {}): FakeClan {
  let gate: Promise<void> | null = null;

  const fake: FakeClan = {
    requests: [],
    employees: options.employees ?? [],
    holidays: options.holidays ?? [],
    leave: options.leave ?? [],
    token: CLAN_TOKEN,
    forbidden: new Set(),
    total: 'rows',
    intercept: null,
    hold() {
      let release = () => undefined as void;
      gate = new Promise<void>((done) => {
        release = () => {
          gate = null;
          done();
        };
      });
      return () => {
        release();
      };
    },
    to(path) {
      return fake.requests.filter((r) => r.path === path);
    },
    fetchImpl: async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (!url.href.startsWith(CLAN_BASE)) {
        throw new TypeError(`fetch failed: the fake Clan has no ${url.origin}`);
      }
      const headers = new Headers(init?.headers);
      const req: FakeRequest = {
        method: init?.method ?? 'GET',
        path: url.pathname.slice(new URL(CLAN_BASE).pathname.length),
        query: url.searchParams,
        authorization: headers.get('authorization'),
        body: typeof init?.body === 'string' ? init.body : '',
      };
      fake.requests.push(req);

      const early = fake.intercept?.(req);
      if (early === 'hang') return hang(init?.signal);
      if (early !== undefined) return early;

      if (req.authorization !== `Bearer ${fake.token}`) {
        // Clan's own words, which Laika must never pass on.
        return json(401, { error: { code: 401, message: 'CLAN-SECRET-WORDS unauthenticated' } });
      }
      if (fake.forbidden.has(req.path)) {
        return json(403, { error: { code: 403, message: 'CLAN-SECRET-WORDS forbidden' } });
      }
      if (req.method === 'GET' && req.path === '/auth/me') {
        return json(200, {
          data: options.me ?? { id: 9, name: CLAN_ACCOUNT, email: 'forge@kvelld.example' },
        });
      }
      if (req.method === 'GET') {
        if (gate !== null) await gate;
        if (req.path === '/employee') return page(fake.employees, req.query, fake.total);
        if (req.path === '/holiday') return page(fake.holidays, req.query, fake.total);
        if (req.path === '/leave') return page(fake.leave, req.query, fake.total);
      }
      return json(404, { error: { code: 404 } });
    },
  };
  return fake;
}

/** An employee row as Clan sends it. */
export function employee(
  id: number,
  name: string,
  email: string | null,
  detail: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    email,
    employee_detail: {
      department_id: 3,
      designation_id: 7,
      employment_type: 'full_time',
      ...detail,
    },
  };
}

/** A day of leave as Clan sends it: one row per day. */
export function leaveRow(
  id: number,
  userId: number,
  day: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    unique_id: `app-${String(id)}`,
    leave_date: `${day}T00:00:00.000000Z`,
    duration: 'single',
    half_day_type: null,
    status: 'approved',
    user_id: userId,
    type: { id: 1, type_name: 'Annual' },
    ...extra,
  };
}
