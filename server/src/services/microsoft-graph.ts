import { ApiError } from '../errors.ts';

/**
 * Microsoft Graph, read as an Entra application (D-157, LAI-1316) — each
 * member's Outlook calendar, through the client-credentials grant an admin
 * consents to once (`Calendars.Read`, an application permission).
 *
 * **One of the few places data leaves the instance**, so this follows
 * `services/clan-client.ts`: no SDK, an injectable `fetchImpl` so **no test
 * makes a real call**, a timeout on every request cleared in `finally`, and
 * Microsoft's own response text never echoed — it is a third party's words
 * on their way to a Laika user (§13.1).
 *
 * **Two hosts and no other.** The token comes from
 * `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, and every
 * read goes to `https://graph.microsoft.com/v1.0`. A tenant is a GUID or a
 * domain, checked before it is put in a URL, and an `@odata.nextLink` that
 * names any other origin is a bad answer, never a request: the secret's token
 * travels in its header.
 *
 * **The token is kept until five minutes before it lapses**, in the cache the
 * caller hands in — the sync keeps one per database, so a run every 15
 * minutes asks Microsoft for a token about once an hour. A token Graph
 * refuses (`401`, `403`) is dropped from the cache: one minted before an
 * admin granted `Calendars.Read` does not carry the role, and the next run
 * must ask for a new one rather than wait out the old.
 *
 * **One retry, bounded**, as Clan's: a `429` or a `503` is asked once more
 * after the `Retry-After` it names (a second when it names none), unless it
 * asks for more than {@link GRAPH_RETRY_AFTER_MAX_MS}.
 */

/** Long enough for a page of a busy calendar, short enough that a hung Microsoft frees the sync. */
export const GRAPH_TIMEOUT_MS = 20_000;

/** The longest `Retry-After` the one retry waits for. */
export const GRAPH_RETRY_AFTER_MAX_MS = 30_000;

/** The wait when a `429` or `503` names none. */
const DEFAULT_RETRY_MS = 1_000;

/** A cached token this close to its end is not used; a new one is asked for. */
export const GRAPH_TOKEN_EARLY_MS = 5 * 60 * 1000;

/** Events a page asks for. */
const PAGE_SIZE = 100;

/**
 * Three days of one person's calendar that has not ended after this many
 * pages of a hundred is not an answer Laika can use.
 */
const MAX_PAGES = 20;

const LOGIN_ORIGIN = 'https://login.microsoftonline.com';
const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_ROOT = `${GRAPH_ORIGIN}/v1.0`;

/** The application permission the sync needs, as Entra names it in a token's `roles`. */
export const CALENDARS_READ = 'Calendars.Read';

/** What a calendar read asks for, so the answer carries only what Laika reads. */
const EVENT_FIELDS = [
  'id',
  'iCalUId',
  'subject',
  'start',
  'end',
  'isAllDay',
  'isCancelled',
  'showAs',
  'sensitivity',
  'responseStatus',
  'isOrganizer',
  'location',
].join(',');

/**
 * Microsoft could not be reached, or would not answer (§6.3's
 * `unavailable`). `reached` says whether the request got there.
 */
export class GraphUnavailableError extends ApiError {
  readonly reached: boolean;

  constructor(why: string, reached = false) {
    super('unavailable', 'Microsoft could not be reached', { reason: 'graph_unreachable', why });
    this.name = 'GraphUnavailableError';
    this.reached = reached;
  }
}

/** Microsoft refused the tenant, the client id or the secret. Its words are not passed on. */
export class GraphCredentialsError extends ApiError {
  readonly answered: number;

  constructor(answered: number) {
    super('unprocessable', 'Microsoft refused those app credentials', {
      reason: 'graph_credentials_refused',
      why: `answered ${String(answered)}`,
    });
    this.name = 'GraphCredentialsError';
    this.answered = answered;
  }
}

/**
 * Graph refused a read with the token (`401`/`403`): the app has not been
 * granted `Calendars.Read`, or an application access policy keeps it from
 * this mailbox.
 */
export class GraphNotGrantedError extends ApiError {
  readonly answered: number;

  constructor(answered: number) {
    super('unprocessable', 'The app may not read calendars', {
      reason: 'graph_not_granted',
      why: `answered ${String(answered)}`,
    });
    this.name = 'GraphNotGrantedError';
    this.answered = answered;
  }
}

/** Microsoft answered, with something Laika cannot read as the documented shape. */
export class GraphAnswerError extends ApiError {
  constructor(why: string) {
    super('unavailable', 'Microsoft answered something Laika could not read', {
      reason: 'graph_bad_answer',
      why,
    });
    this.name = 'GraphAnswerError';
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A domain of at least two DNS labels, as an Entra tenant's verified one is. */
const DOMAIN =
  /^(?=.{4,100}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** An Entra tenant: a GUID, or a domain such as `contoso.onmicrosoft.com`. Lowercase. */
export function isTenantId(value: string): boolean {
  return GUID.test(value) || DOMAIN.test(value);
}

/** An app's client id: a GUID, lowercase. */
export function isClientId(value: string): boolean {
  return GUID.test(value);
}

/** An app-only token, and the application roles it carries. */
export interface GraphToken {
  accessToken: string;
  /** Unix ms. */
  expiresAt: number;
  /** The token's `roles` claim, A–Z; empty when it has none or cannot be read. */
  roles: string[];
}

/**
 * One event, as the sync reads it. **Nothing here is stored but the ids, the
 * subject and the times** — `location` is read only to match a channel rule,
 * and no link, body or attendee is ever asked for.
 */
export interface GraphEvent {
  id: string;
  icalUid: string | null;
  subject: string | null;
  /** Unix ms. */
  start: number;
  end: number;
  isAllDay: boolean;
  isCancelled: boolean;
  /** Lowercased: `free`, `tentative`, `busy`, `oof`, `workingelsewhere`, `unknown`. */
  showAs: string;
  /** Lowercased: `normal`, `personal`, `private`, `confidential`. */
  sensitivity: string;
  /** Lowercased `responseStatus.response`: `organizer`, `accepted`, `tentativelyaccepted`, … */
  response: string;
  isOrganizer: boolean;
  /** The location's name — a channel meeting's is its channel. */
  location: string | null;
}

export interface GraphClient {
  /**
   * A token for the app: the cached one while it has more than five minutes
   * left, else a new one. `fresh` always asks — *Test connection*'s, which
   * must see a grant made since the last.
   */
  token(options?: { fresh?: boolean }): Promise<GraphToken>;
  /**
   * Every event on `user`'s calendar that overlaps `from`–`to` (unix ms),
   * occurrences of a series each their own, or **null when Microsoft has no
   * calendar for them** (`404`: no such user in the tenant, or no mailbox).
   */
  calendarView(user: string, from: number, to: number): Promise<GraphEvent[] | null>;
}

export interface GraphClientOptions {
  /** Already checked with {@link isTenantId}. */
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch | undefined;
  /** How the one retry waits — injected by the tests, which never wait. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
  /**
   * Where a token is kept between clients, keyed by tenant and client id.
   * Absent, a client keeps its own for its lifetime.
   */
  cache?: Map<string, GraphToken> | undefined;
}

interface Answer {
  status: number;
  /** The parsed JSON body, or undefined when there was none or it was not JSON. */
  body: unknown;
  retryAfter: string | null;
}

/** `Retry-After` in milliseconds: its seconds, or a second when it names none. */
function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1_000
    : DEFAULT_RETRY_MS;
}

/**
 * The `roles` claim of an access token, read and never verified: it is the
 * answer Microsoft just gave over TLS to the secret's holder, and it is only
 * shown to them. A token that is not a readable JWT has none.
 */
export function rolesOf(accessToken: string): string[] {
  const payload = accessToken.split('.')[1];
  if (payload === undefined || payload === '') return [];
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      roles?: unknown;
    };
    if (!Array.isArray(claims.roles)) return [];
    const roles = (claims.roles as unknown[]).flatMap((r) =>
      typeof r === 'string' && r.trim() !== '' ? [r.trim().slice(0, 100)] : [],
    );
    return [...new Set(roles)].sort().slice(0, 100);
  } catch {
    return [];
  }
}

/** The real client. */
export function graphClient(options: GraphClientOptions): GraphClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const timeoutMs = options.timeoutMs ?? GRAPH_TIMEOUT_MS;
  const clock = options.now ?? Date.now;
  const cache = options.cache ?? new Map<string, GraphToken>();
  const cacheKey = `${options.tenantId}/${options.clientId}`;
  // Asked once here: a tenant that is not one is never put in a URL.
  const allowed = isTenantId(options.tenantId) && isClientId(options.clientId);

  /** One request, body read inside the same timeout. */
  async function once(url: string, init: RequestInit): Promise<Answer> {
    if (!allowed) throw new GraphUnavailableError('not a tenant and client id', false);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
      const text = await res.text();
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { status: res.status, body, retryAfter: res.headers.get('retry-after') };
    } catch (err) {
      // `AbortError`, DNS failure, a refused connection or a redirect: none of
      // them Microsoft's words. An abort gave up on a request it had.
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new GraphUnavailableError(timedOut ? 'timed out' : 'could not connect', timedOut);
    } finally {
      clearTimeout(timer);
    }
  }

  /** {@link once}, and once more after a `429` or `503` that asks for a short wait. */
  async function send(url: string, init: RequestInit): Promise<Answer> {
    const first = await once(url, init);
    if (first.status !== 429 && first.status !== 503) return first;
    const wait = retryAfterMs(first.retryAfter);
    if (wait > GRAPH_RETRY_AFTER_MAX_MS) {
      throw new GraphUnavailableError(
        `answered ${String(first.status)}, retry after too long`,
        true,
      );
    }
    await sleep(wait);
    return once(url, init);
  }

  async function newToken(): Promise<GraphToken> {
    const form = new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      scope: `${GRAPH_ORIGIN}/.default`,
      grant_type: 'client_credentials',
    });
    const answer = await send(
      `${LOGIN_ORIGIN}/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    if (answer.status === 429 || answer.status >= 500) {
      throw new GraphUnavailableError(`answered ${String(answer.status)}`, true);
    }
    // An unknown tenant, an unknown app, a wrong or expired secret: all
    // refusals, and none of Microsoft's wording goes further.
    if (answer.status >= 400) throw new GraphCredentialsError(answer.status);
    if (answer.status < 200 || answer.status >= 300) {
      throw new GraphAnswerError(`token answered ${String(answer.status)}`);
    }
    const body = (answer.body ?? {}) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || body.access_token === '') {
      throw new GraphAnswerError('token: no access_token');
    }
    const seconds = Number(body.expires_in);
    const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60 * 60 * 1000;
    return {
      accessToken: body.access_token,
      expiresAt: clock() + lifetime,
      roles: rolesOf(body.access_token),
    };
  }

  async function token(opts: { fresh?: boolean } = {}): Promise<GraphToken> {
    const held = cache.get(cacheKey);
    if (
      opts.fresh !== true &&
      held !== undefined &&
      held.expiresAt - clock() > GRAPH_TOKEN_EARLY_MS
    ) {
      return held;
    }
    const made = await newToken();
    cache.set(cacheKey, made);
    return made;
  }

  /** A token-carrying read of a Graph URL: `2xx` is the body, `404` null, anything else a named failure. */
  async function read(url: string, access: GraphToken): Promise<unknown> {
    const answer = await send(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${access.accessToken}`,
        // Every start and end in UTC, whatever the mailbox's own zone.
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    if (answer.status >= 200 && answer.status < 300) return answer.body;
    if (answer.status === 404) return null;
    if (answer.status === 401 || answer.status === 403) {
      // A token minted before the grant does not carry it: the next ask is new.
      if (cache.get(cacheKey) === access) cache.delete(cacheKey);
      throw new GraphNotGrantedError(answer.status);
    }
    if (answer.status === 429 || answer.status >= 500) {
      throw new GraphUnavailableError(`answered ${String(answer.status)}`, true);
    }
    throw new GraphAnswerError(`answered ${String(answer.status)}`);
  }

  return {
    token,

    async calendarView(user, from, to) {
      const access = await token();
      const query = new URLSearchParams({
        startDateTime: new Date(from).toISOString(),
        endDateTime: new Date(to).toISOString(),
        $select: EVENT_FIELDS,
        $top: String(PAGE_SIZE),
      });
      let url: string | null =
        `${GRAPH_ROOT}/users/${encodeURIComponent(user)}/calendarView?${query.toString()}`;
      const events: GraphEvent[] = [];
      for (let n = 0; n < MAX_PAGES; n += 1) {
        if (url === null) return events;
        const body = await read(url, access);
        // Only the first page can be "no such calendar"; a later page that is
        // gone is the read failing part-way.
        if (body === null) {
          if (n === 0) return null;
          throw new GraphAnswerError('calendarView: a later page is gone');
        }
        const page = (body ?? {}) as { value?: unknown; '@odata.nextLink'?: unknown };
        if (!Array.isArray(page.value)) throw new GraphAnswerError('calendarView: no value list');
        events.push(...(page.value as unknown[]).map(eventOf));
        url = nextLinkOf(page['@odata.nextLink']);
      }
      if (url === null) return events;
      throw new GraphAnswerError(`calendarView: more than ${String(MAX_PAGES)} pages`);
    },
  };
}

/**
 * The next page, **only on Graph's own host**: a link anywhere else would
 * carry the token there. Absent is the last page.
 */
function nextLinkOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new GraphAnswerError('calendarView: nextLink not a string');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GraphAnswerError('calendarView: nextLink not a URL');
  }
  if (url.origin !== GRAPH_ORIGIN || url.username !== '' || url.password !== '') {
    throw new GraphAnswerError('calendarView: nextLink off Graph');
  }
  return url.toString();
}

// ------------------------------------------------------------------ parsing
//
// Strict where it matters: an event without an id or a time is a bad answer
// for the whole read, because the sync retires what a complete read does not
// return, and an event it cannot place would look gone.

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

/**
 * `{ dateTime: "2026-11-18T09:00:00.0000000", timeZone: "UTC" }` → unix ms.
 * The read asks for UTC (`Prefer: outlook.timezone`); any other zone is a
 * bad answer rather than a guess.
 */
function instantOf(value: unknown, what: string): number {
  const v = (value ?? {}) as { dateTime?: unknown; timeZone?: unknown };
  if (typeof v.dateTime !== 'string' || v.timeZone !== 'UTC') {
    throw new GraphAnswerError(`event: no UTC ${what}`);
  }
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z?$/.exec(v.dateTime);
  const at =
    m === null
      ? Number.NaN
      : Date.parse(`${m[1] ?? ''}.${(m[2] ?? '').padEnd(3, '0').slice(0, 3)}Z`);
  if (Number.isNaN(at)) throw new GraphAnswerError(`event: unreadable ${what}`);
  return at;
}

function eventOf(row: unknown): GraphEvent {
  const r = (row ?? {}) as Record<string, unknown>;
  const id = textOf(r.id, 512);
  if (id === null) throw new GraphAnswerError('event: no id');
  const status = (r.responseStatus ?? {}) as { response?: unknown };
  const location = (r.location ?? {}) as { displayName?: unknown };
  return {
    id,
    icalUid: textOf(r.iCalUId, 512),
    subject: textOf(r.subject, 400),
    start: instantOf(r.start, 'start'),
    end: instantOf(r.end, 'end'),
    isAllDay: r.isAllDay === true,
    isCancelled: r.isCancelled === true,
    showAs: (textOf(r.showAs, 40) ?? 'unknown').toLowerCase(),
    sensitivity: (textOf(r.sensitivity, 40) ?? 'normal').toLowerCase(),
    response: (textOf(status.response, 40) ?? 'none').toLowerCase(),
    isOrganizer: r.isOrganizer === true,
    location: textOf(location.displayName, 200),
  };
}
