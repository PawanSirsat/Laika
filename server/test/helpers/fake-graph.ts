/**
 * A fake Microsoft identity platform and Graph (D-157, LAI-1316), served
 * through an injected `fetch` — **no test makes a real call** to Microsoft.
 *
 * It answers the two calls `services/microsoft-graph.ts` makes:
 *
 * - `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, the
 *   client-credentials grant. The tenant, client id and secret must be the
 *   fixture's, or it answers `400`/`401` with AADSTS words Laika must never
 *   pass on. The token is a JWT whose `roles` claim is `fake.roles` at the
 *   moment it is minted — so a grant made later is in the next token, not in
 *   one already handed out, as Entra's are.
 * - `GET https://graph.microsoft.com/v1.0/users/{user}/calendarView`, every
 *   event of that user overlapping `startDateTime`–`endDateTime`, paged by
 *   `$top` with an `@odata.nextLink` carrying `$skiptoken`. An unknown user
 *   is `404`, one in `denied` `403` and one in `refused` `400`; a token
 *   without `Calendars.Read` is `403`; one not issued here is `401`. **A read
 *   without both `Prefer: outlook.timezone="UTC"` and `IdType="ImmutableId"`
 *   is not answered at all** — the fetch throws, as a request the real Graph
 *   would answer in another zone and with other ids must not pass quietly.
 *
 * And the directory the people sync reads (D-161, LAI-1330), from
 * `directory` — each person by their user principal name:
 *
 * - `GET /users/{id or upn}` and `GET /users?$filter=mail eq '…'`, which
 *   need `User.Read.All` (`403` without) and answer `404` for no one, `403`
 *   for a person in `denied` and `400` for one in `refused`;
 * - `GET /users/{id}/manager`, `404` when they have none;
 * - `GET /users/{id}/photos/240x240` (`@odata.mediaEtag`) and its `$value`,
 *   and the default size's `GET /users/{id}/photo` and its `$value` — `404`
 *   when they have no photo, and the 240px pair `404` for someone whose
 *   photo is `defaultOnly`. **A directory read carrying the
 *   calendar's `Prefer` headers is not answered** — the fetch throws.
 *
 * `intercept` answers a request before the fake does — a `429`, a `500`, a
 * hang until the client gives up — and `hold` keeps every calendar read
 * waiting until released, so a test can start a second sync while the first
 * is still reading.
 */

export const GRAPH_TENANT = '5abd4f6b-f235-4d86-a90c-08f2e5f56fbb';
export const GRAPH_CLIENT = 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd';
/** A fixture string, never a real credential. */
export const GRAPH_SECRET = 'fixture~secret.Never-Real_0000Wxyz';

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface FakeGraphRequest {
  method: string;
  url: URL;
  /**
   * `token`, `calendarView`, or a directory read: `user` (by id or user
   * principal name), `users` (by `mail`), `manager`, `photo` (its tag) or
   * `photoValue` (its bytes). Anything else is `other`.
   */
  kind: 'token' | 'calendarView' | 'user' | 'users' | 'manager' | 'photo' | 'photoValue' | 'other';
  /** The user a calendar read names, decoded. */
  user: string | null;
  authorization: string | null;
  prefer: string | null;
  /** What the client asked fetch to do with a redirect. */
  redirect: RequestInit['redirect'];
  body: string;
}

/** One person in the fake directory. Unset fields are absent from its answers. */
export interface FakeDirectoryUser {
  id: string;
  /** The user principal name, which `/users/{x}` answers to. */
  upn: string;
  mail?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  accountEnabled?: boolean;
  /** Their manager's user principal name. */
  manager?: string;
  photo?: { etag: string; bytes: Uint8Array; contentType?: string; defaultOnly?: boolean };
}

/** What `intercept` may answer: a response, a hang until the client aborts, or nothing — the fake answers. */
export type GraphIntercepted = Response | 'hang' | undefined;

export interface FakeGraph {
  fetchImpl: typeof fetch;
  requests: FakeGraphRequest[];
  /** Each user's events, by lowercased email, as Graph sends them. */
  calendars: Map<string, Record<string, unknown>[]>;
  /** The roles the next token minted carries. */
  roles: string[];
  /** Tokens minted so far, newest last. */
  tokens: string[];
  /** Users whose mailbox answers `403`, as an application access policy would. */
  denied: Set<string>;
  /** Users Graph will not look up: `400`. */
  refused: Set<string>;
  /** The directory, by lowercased user principal name. */
  directory: Map<string, FakeDirectoryUser>;
  /** How long each token lives, in seconds. */
  expiresIn: number;
  /** Answer a request before the fake does; return undefined to let it. */
  intercept: ((req: FakeGraphRequest) => GraphIntercepted) | null;
  /** Keep every calendar read waiting until the returned function is called. */
  hold(): () => void;
  /** The requests of one kind, in order. */
  of(kind: FakeGraphRequest['kind']): FakeGraphRequest[];
}

export interface FakeGraphOptions {
  calendars?: Record<string, Record<string, unknown>[]>;
  roles?: string[];
  directory?: FakeDirectoryUser[];
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A promise that settles only when the request's signal aborts — Microsoft hung. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

/** A JWT-shaped token: Laika reads its payload's `roles` and never verifies it. */
export function accessToken(roles: string[], n: number): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ aud: 'https://graph.microsoft.com', roles, n })}.fixture-signature-${String(n)}`;
}

/** Graph's `{dateTime, timeZone}` for a unix-ms instant, in UTC with seven decimals. */
export function graphTime(at: number): { dateTime: string; timeZone: string } {
  return { dateTime: new Date(at).toISOString().replace('Z', '0000'), timeZone: 'UTC' };
}

function instant(v: unknown): number {
  const t = (v ?? {}) as { dateTime?: string };
  return Date.parse(`${(t.dateTime ?? '').slice(0, 23)}Z`);
}

export function fakeGraph(options: FakeGraphOptions = {}): FakeGraph {
  let gate: Promise<void> | null = null;

  const fake: FakeGraph = {
    requests: [],
    calendars: new Map(
      Object.entries(options.calendars ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    roles: options.roles ?? ['Calendars.Read'],
    tokens: [],
    denied: new Set(),
    refused: new Set(),
    directory: new Map((options.directory ?? []).map((u) => [u.upn.toLowerCase(), u])),
    expiresIn: 3599,
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
    of(kind) {
      return fake.requests.filter((r) => r.kind === kind);
    },
    fetchImpl: async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.origin !== LOGIN && url.origin !== new URL(GRAPH).origin) {
        throw new TypeError(`fetch failed: the fake Microsoft has no ${url.origin}`);
      }
      const headers = new Headers(init?.headers);
      const view = /^\/v1\.0\/users\/([^/]+)\/calendarView$/.exec(url.pathname);
      const dir =
        /^\/v1\.0\/users(?:\/([^/]+)(?:\/(manager|photos\/240x240(?:\/\$value)?|photo(?:\/\$value)?))?)?$/.exec(
          url.pathname,
        );
      const dirKind: FakeGraphRequest['kind'] | null =
        dir === null
          ? null
          : dir[1] === undefined
            ? 'users'
            : dir[2] === undefined
              ? 'user'
              : dir[2] === 'manager'
                ? 'manager'
                : dir[2].endsWith('$value')
                  ? 'photoValue'
                  : 'photo';
      const req: FakeGraphRequest = {
        method: init?.method ?? 'GET',
        url,
        kind: url.pathname.endsWith('/oauth2/v2.0/token')
          ? 'token'
          : view !== null
            ? 'calendarView'
            : (dirKind ?? 'other'),
        user:
          view !== null
            ? decodeURIComponent(view[1] ?? '')
            : dir?.[1] === undefined
              ? null
              : decodeURIComponent(dir[1]),
        authorization: headers.get('authorization'),
        prefer: headers.get('prefer'),
        redirect: init?.redirect,
        body: typeof init?.body === 'string' ? init.body : '',
      };
      fake.requests.push(req);

      const early = fake.intercept?.(req);
      if (early === 'hang') return hang(init?.signal);
      if (early !== undefined) return early;

      if (req.kind === 'token' && req.method === 'POST') {
        if (url.pathname !== `/${GRAPH_TENANT}/oauth2/v2.0/token`) {
          return json(400, {
            error: 'invalid_request',
            error_description: 'AADSTS90002: MS-SECRET-WORDS tenant not found',
          });
        }
        const form = new URLSearchParams(req.body);
        if (
          form.get('grant_type') !== 'client_credentials' ||
          form.get('scope') !== 'https://graph.microsoft.com/.default'
        ) {
          return json(400, { error: 'invalid_request', error_description: 'MS-SECRET-WORDS' });
        }
        if (form.get('client_id') !== GRAPH_CLIENT || form.get('client_secret') !== GRAPH_SECRET) {
          return json(401, {
            error: 'invalid_client',
            error_description: 'AADSTS7000215: MS-SECRET-WORDS invalid client secret',
          });
        }
        const token = accessToken([...fake.roles], fake.tokens.length + 1);
        fake.tokens.push(token);
        return json(200, {
          token_type: 'Bearer',
          expires_in: fake.expiresIn,
          access_token: token,
        });
      }

      if (req.kind === 'calendarView' && req.method === 'GET') {
        const bearer = req.authorization?.replace(/^Bearer /, '') ?? '';
        if (!fake.tokens.includes(bearer)) {
          return json(401, {
            error: { code: 'InvalidAuthenticationToken', message: 'MS-SECRET-WORDS' },
          });
        }
        const payload = JSON.parse(
          Buffer.from(bearer.split('.')[1] ?? '', 'base64url').toString('utf8'),
        ) as { roles?: string[] };
        if (!(payload.roles ?? []).includes('Calendars.Read')) {
          return json(403, {
            error: { code: 'ErrorAccessDenied', message: 'MS-SECRET-WORDS Access is denied.' },
          });
        }
        const prefer = req.prefer ?? '';
        if (
          !prefer.includes('outlook.timezone="UTC"') ||
          !prefer.includes('IdType="ImmutableId"')
        ) {
          throw new TypeError(`the fake Graph refuses a read without both preferences: ${prefer}`);
        }
        if (gate !== null) await gate;
        const who = (req.user ?? '').toLowerCase();
        if (fake.denied.has(who)) {
          return json(403, {
            error: { code: 'ErrorAccessDenied', message: 'MS-SECRET-WORDS access policy' },
          });
        }
        if (fake.refused.has(who)) {
          return json(400, {
            error: { code: 'ErrorInvalidUser', message: 'MS-SECRET-WORDS bad user' },
          });
        }
        const events = fake.calendars.get(who);
        if (events === undefined) {
          return json(404, {
            error: { code: 'ErrorInvalidUser', message: 'MS-SECRET-WORDS no such user' },
          });
        }
        const from = Date.parse(url.searchParams.get('startDateTime') ?? '');
        const to = Date.parse(url.searchParams.get('endDateTime') ?? '');
        const top = Number(url.searchParams.get('$top') ?? '10');
        const skip = Number(url.searchParams.get('$skiptoken') ?? '0');
        const inWindow = events.filter((e) => instant(e.start) < to && instant(e.end) > from);
        const value = inWindow.slice(skip, skip + top);
        const next = new URL(url.href);
        next.searchParams.set('$skiptoken', String(skip + top));
        return json(200, {
          value,
          ...(skip + top < inWindow.length ? { '@odata.nextLink': next.href } : {}),
        });
      }

      if (dirKind !== null && req.method === 'GET') return directoryAnswer(fake, req, dirKind);

      return json(404, { error: { code: 'NotFound' } });
    },
  };
  return fake;
}

/** A directory object as Graph answers a `$select` of it. */
function userJson(u: FakeDirectoryUser): Record<string, unknown> {
  return {
    id: u.id,
    userPrincipalName: u.upn,
    ...(u.mail === undefined ? {} : { mail: u.mail }),
    ...(u.jobTitle === undefined ? {} : { jobTitle: u.jobTitle }),
    ...(u.department === undefined ? {} : { department: u.department }),
    ...(u.accountEnabled === undefined ? {} : { accountEnabled: u.accountEnabled }),
  };
}

function directoryAnswer(
  fake: FakeGraph,
  req: FakeGraphRequest,
  kind: FakeGraphRequest['kind'],
): Response {
  const bearer = req.authorization?.replace(/^Bearer /, '') ?? '';
  if (!fake.tokens.includes(bearer)) {
    return json(401, { error: { code: 'InvalidAuthenticationToken', message: 'MS-SECRET-WORDS' } });
  }
  const payload = JSON.parse(
    Buffer.from(bearer.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { roles?: string[] };
  if (!(payload.roles ?? []).includes('User.Read.All')) {
    return json(403, {
      error: { code: 'Authorization_RequestDenied', message: 'MS-SECRET-WORDS insufficient' },
    });
  }
  if (req.prefer !== null) {
    throw new TypeError(`the fake Graph refuses a directory read with Prefer: ${req.prefer}`);
  }
  const notFound = () =>
    json(404, { error: { code: 'Request_ResourceNotFound', message: 'MS-SECRET-WORDS gone' } });

  if (kind === 'users') {
    const filter = /^mail eq '(.*)'$/.exec(req.url.searchParams.get('$filter') ?? '');
    if (filter === null) return json(400, { error: { code: 'BadRequest' } });
    const address = (filter[1] ?? '').replace(/''/g, "'").toLowerCase();
    const value = [...fake.directory.values()]
      .filter((u) => (u.mail ?? '').toLowerCase() === address)
      .map(userJson);
    return json(200, { value });
  }

  const key = (req.user ?? '').toLowerCase();
  if (fake.denied.has(key)) {
    return json(403, {
      error: { code: 'Authorization_RequestDenied', message: 'MS-SECRET-WORDS' },
    });
  }
  if (fake.refused.has(key)) {
    return json(400, { error: { code: 'Request_BadRequest', message: 'MS-SECRET-WORDS' } });
  }
  const who =
    fake.directory.get(key) ?? [...fake.directory.values()].find((u) => u.id === req.user);
  if (who === undefined) return notFound();

  if (kind === 'user') return json(200, userJson(who));
  if (kind === 'manager') {
    const boss = who.manager === undefined ? undefined : fake.directory.get(who.manager);
    return boss === undefined ? notFound() : json(200, userJson(boss));
  }
  const sized = req.url.pathname.includes('/photos/240x240');
  if (who.photo === undefined || (sized && who.photo.defaultOnly === true)) {
    return json(404, { error: { code: 'ImageNotFound', message: 'MS-SECRET-WORDS no photo' } });
  }
  if (kind === 'photo') {
    return json(200, {
      '@odata.mediaContentType': who.photo.contentType ?? 'image/jpeg',
      '@odata.mediaEtag': who.photo.etag,
      id: '240X240',
      width: 240,
      height: 240,
    });
  }
  return new Response(who.photo.bytes, {
    status: 200,
    headers: { 'content-type': who.photo.contentType ?? 'image/jpeg' },
  });
}

let counter = 0;

/**
 * An event as Graph sends it with the `$select` Laika asks for: an
 * invitation accepted, in person, busy, normal, an hour from `start` (unix
 * ms) unless said otherwise.
 */
export function graphEvent(
  start: number,
  extra: Record<string, unknown> & { minutes?: number } = {},
): Record<string, unknown> {
  counter += 1;
  const { minutes = 60, ...rest } = extra;
  return {
    id: `AAMkAG-event-${String(counter)}`,
    iCalUId: `040000008200E00074C5B7101A82E008-${String(counter)}`,
    subject: 'Sprint planning',
    start: graphTime(start),
    end: graphTime(start + minutes * 60_000),
    isAllDay: false,
    isCancelled: false,
    showAs: 'busy',
    sensitivity: 'normal',
    responseStatus: { response: 'accepted', time: '2026-11-01T08:00:00Z' },
    isOrganizer: false,
    isOnlineMeeting: false,
    location: { displayName: 'Room 4' },
    ...rest,
  };
}
