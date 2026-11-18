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
 * refuses (`401`) is dropped from the cache, and so is one the caller finds
 * without `Calendars.Read` ({@link GraphClient.forget}): one minted before an
 * admin granted it does not carry the role, and the next run must ask for a
 * new one rather than wait out the old.
 *
 * **One mailbox is one person, not the run** (LAI-1316 review F1). A calendar
 * Graph will not open (`403` — an application access policy, a mailbox in
 * another tenant), will not look up (`400`) or does not have (`404`) is
 * answered as that person skipped, by reason; the caller retires nothing of
 * theirs and carries on with everyone else.
 *
 * **Ids are immutable** (`Prefer: IdType="ImmutableId"`): an event keeps its
 * id when it moves between folders, so a meeting moved is never logged twice.
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
 * A week of one person's calendar that has not ended after this many pages of
 * a hundred is not an answer Laika can use: the regular read of three days
 * gets twenty, a backfill's twenty for each week it spans (LAI-1335) — so a
 * backfill of 90 days reads at most 28,000 events of one person, under
 * SQLite's 32,766 bound variables when the sync looks their links up at once.
 */
const MAX_PAGES = 20;

const WEEK_MS = 7 * 86_400_000;

function pagesFor(from: number, to: number): number {
  return MAX_PAGES * Math.max(1, Math.ceil((to - from) / WEEK_MS));
}

/**
 * The most events one read of `from`–`to` may return before it is refused —
 * what the sync's links lookup may bind at once (LAI-1335 review F4).
 */
export function calendarViewMaxEvents(from: number, to: number): number {
  return pagesFor(from, to) * PAGE_SIZE;
}

const LOGIN_ORIGIN = 'https://login.microsoftonline.com';
const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_ROOT = `${GRAPH_ORIGIN}/v1.0`;

/** The application permission the sync needs, as Entra names it in a token's `roles`. */
export const CALENDARS_READ = 'Calendars.Read';

/**
 * The application permission the people sync needs (D-161, LAI-1330): a
 * person's profile, manager, account state and photo.
 */
export const USER_READ_ALL = 'User.Read.All';

/** What a person read asks for — their id, the two names they go by, and the three fields kept. */
const USER_FIELDS = [
  'id',
  'mail',
  'userPrincipalName',
  'jobTitle',
  'department',
  'accountEnabled',
].join(',');

/** A manager is matched to a Laika user by address, and nothing else of theirs is read. */
const MANAGER_FIELDS = ['id', 'mail', 'userPrincipalName'].join(',');

/**
 * The photo size the people sync asks for first (D-161): big enough for every
 * avatar Laika draws. A person with no photo at that size may still have one
 * at its default size (`/photo`), which is asked for next.
 */
const PHOTO_SIZE = '240x240';

/** Which of a person's photos a tag is for: the 240px one, or the default one. */
export type PhotoSize = 'sized' | 'default';

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
  // A boolean: whether it is a Teams meeting. Never `onlineMeeting` or
  // `onlineMeetingUrl`, which carry the join link (D-157 item 3).
  'isOnlineMeeting',
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
 * The app's token does not carry `Calendars.Read`: an admin has not granted
 * it yet. Raised by the caller that read the token's roles, before any
 * calendar is asked for.
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
  /**
   * The token's claims could be read — so an empty `roles` is *no roles*, not
   * *could not tell*. A token Microsoft one day makes opaque reads `false`,
   * and the sync then learns from each mailbox instead.
   */
  rolesKnown: boolean;
}

/** Why one person's calendar was not read: a `404`, a `403` or a `400` for their mailbox. */
export type MailboxSkip = 'no_mailbox' | 'denied' | 'refused';

/** One person's calendar: every event in the window, or why it was not read. */
export type CalendarRead = { events: GraphEvent[] } | { skipped: MailboxSkip };

/**
 * Why one person was not read from the directory: Graph does not have them
 * (`404`, by address and by `mail`), will not show them (`403`), or will not
 * look them up (`400`, or an address two people answer to).
 */
export type DirectorySkip = 'not_found' | 'denied' | 'refused';

/** One person as the directory describes them. Addresses lowercased. */
export interface GraphUser {
  id: string;
  mail: string | null;
  userPrincipalName: string | null;
  jobTitle: string | null;
  department: string | null;
  /** Null when the answer did not say. */
  accountEnabled: boolean | null;
}

/** One person's directory entry, or why it was not read. */
export type UserRead = { user: GraphUser } | { skipped: DirectorySkip };

/**
 * A person's photo: its bytes, at most the cap, or `too_large` past it.
 * `none` is a `404` — they have no photo — and `skipped` a `403`, a `400` or
 * an empty answer, none of which says whether they do, so nothing stored is
 * removed.
 */
export type PhotoRead =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'too_large' }
  | { kind: 'none' }
  | { kind: 'skipped' };

/**
 * A photo's tag (`@odata.mediaEtag`, `''` when the answer has none) and which
 * photo it is for, or `none` / `skipped` as {@link PhotoRead}'s.
 */
export type PhotoTagRead =
  { kind: 'tag'; tag: string; size: PhotoSize } | { kind: 'none' } | { kind: 'skipped' };

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
  /** A Teams meeting — what tells an organised meeting from an organised lunch (D-157 item 3). */
  isOnlineMeeting: boolean;
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
  /** Drop the cached token, so the next ask is a new one. */
  forget(): void;
  /**
   * Every event on `user`'s calendar that overlaps `from`–`to` (unix ms),
   * occurrences of a series each their own — or **that person skipped**, when
   * Graph has no calendar for them (`404`), will not open it (`403`) or will
   * not look them up (`400`), on any page.
   */
  calendarView(user: string, from: number, to: number): Promise<CalendarRead>;
  /**
   * One person by address (D-161): `/users/{address}`, which answers to a
   * user principal name, and when that is a `404` the one person whose
   * `mail` it is — or **that person skipped**, by reason.
   */
  user(address: string): Promise<UserRead>;
  /**
   * One person by their Entra object id (D-161 review M1): once the sync has
   * matched someone, this is how they are read — a rename does not lose them,
   * and an address given to someone else does not become them. A `404` is
   * the one signal that they are gone.
   */
  userById(objectId: string): Promise<UserRead>;
  /** Their manager, or null when they have none or Graph will not say. */
  manager(userId: string): Promise<GraphUser | null>;
  /**
   * Their photo's tag (`@odata.mediaEtag`), which changes when the photo does:
   * the 240px photo's, or — when that is a `404` — the default one's.
   */
  photoTag(userId: string): Promise<PhotoTagRead>;
  /** That photo's bytes, read no further than `maxBytes` (`readBinary`). */
  photo(userId: string, size: PhotoSize, maxBytes: number): Promise<PhotoRead>;
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
  /**
   * A binary read's bytes (`readBinary`), only on a `2xx`: what arrived, or
   * `too_large` once it ran past the cap — the rest never read.
   */
  bytes?: Uint8Array | 'too_large';
  retryAfter: string | null;
}

/** A body read no further than `maxBytes`, by what arrives — never a declared length. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | 'too_large'> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) return 'too_large';
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
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
 * shown to them. `known` is whether the claims could be read at all — a
 * readable token with no `roles` has none; one that is not a readable JWT
 * cannot say.
 */
export function readRoles(accessToken: string): { roles: string[]; known: boolean } {
  const payload = accessToken.split('.')[1];
  if (payload === undefined || payload === '') return { roles: [], known: false };
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    if (typeof claims !== 'object' || claims === null) return { roles: [], known: false };
    const raw = (claims as { roles?: unknown }).roles;
    if (!Array.isArray(raw)) return { roles: [], known: true };
    const roles = (raw as unknown[]).flatMap((r) =>
      typeof r === 'string' && r.trim() !== '' ? [r.trim().slice(0, 100)] : [],
    );
    return { roles: [...new Set(roles)].sort().slice(0, 100), known: true };
  } catch {
    return { roles: [], known: false };
  }
}

/** {@link readRoles}' roles alone. */
export function rolesOf(accessToken: string): string[] {
  return readRoles(accessToken).roles;
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

  /**
   * One request, body read inside the same timeout. With `maxBinary`, a
   * `2xx` body is bytes read no further than it, and any other is JSON.
   */
  async function once(url: string, init: RequestInit, maxBinary?: number): Promise<Answer> {
    if (!allowed) throw new GraphUnavailableError('not a tenant and client id', false);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
      if (maxBinary !== undefined && res.status >= 200 && res.status < 300) {
        const bytes = await readCapped(res, maxBinary);
        return { status: res.status, body: undefined, bytes, retryAfter: null };
      }
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
  async function send(url: string, init: RequestInit, maxBinary?: number): Promise<Answer> {
    const first = await once(url, init, maxBinary);
    if (first.status !== 429 && first.status !== 503) return first;
    const wait = retryAfterMs(first.retryAfter);
    if (wait > GRAPH_RETRY_AFTER_MAX_MS) {
      throw new GraphUnavailableError(
        `answered ${String(first.status)}, retry after too long`,
        true,
      );
    }
    await sleep(wait);
    return once(url, init, maxBinary);
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
    const { roles, known } = readRoles(body.access_token);
    return {
      accessToken: body.access_token,
      expiresAt: clock() + lifetime,
      roles,
      rolesKnown: known,
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

  /** The status that skips one person's mailbox, and why. */
  const SKIPS: Readonly<Record<number, MailboxSkip>> = {
    404: 'no_mailbox',
    403: 'denied',
    400: 'refused',
  };

  /**
   * A token-carrying read of a Graph URL: `2xx` is the body, a `404`, `403`
   * or `400` is that mailbox skipped, a `401` the token refused, anything else
   * a named failure. `outlook` asks for the calendar's UTC times and
   * immutable ids; `maxBinary` reads a `2xx` body as bytes ({@link readBinary}).
   */
  async function readAnswer(
    url: string,
    access: GraphToken,
    options: { outlook: boolean; maxBinary?: number },
  ): Promise<Answer | MailboxSkip> {
    const headers = new Headers({
      Accept: options.maxBinary === undefined ? 'application/json' : 'image/*',
      Authorization: `Bearer ${access.accessToken}`,
    });
    if (options.outlook) {
      // Every start and end in UTC, whatever the mailbox's own zone; and ids
      // that survive a move between folders (LAI-1316 review F5).
      headers.append('Prefer', 'outlook.timezone="UTC"');
      headers.append('Prefer', 'IdType="ImmutableId"');
    }
    const answer = await send(url, { method: 'GET', headers }, options.maxBinary);
    if (answer.status >= 200 && answer.status < 300) return answer;
    const skip = SKIPS[answer.status];
    if (skip !== undefined) return skip;
    if (answer.status === 401) {
      // The token itself refused: the next ask is a new one.
      if (cache.get(cacheKey) === access) cache.delete(cacheKey);
      throw new GraphCredentialsError(answer.status);
    }
    if (answer.status === 429 || answer.status >= 500) {
      throw new GraphUnavailableError(`answered ${String(answer.status)}`, true);
    }
    throw new GraphAnswerError(`answered ${String(answer.status)}`);
  }

  /** {@link readAnswer} of the calendar's JSON. */
  async function read(url: string, access: GraphToken): Promise<{ body: unknown } | MailboxSkip> {
    const answer = await readAnswer(url, access, { outlook: true });
    return typeof answer === 'string' ? answer : { body: answer.body };
  }

  /** {@link readAnswer} of a directory resource's JSON. */
  async function readDirectory(
    url: string,
    access: GraphToken,
  ): Promise<{ body: unknown } | MailboxSkip> {
    const answer = await readAnswer(url, access, { outlook: false });
    return typeof answer === 'string' ? answer : { body: answer.body };
  }

  /**
   * A resource's bytes rather than its JSON — a photo's `$value` (D-161) —
   * read no further than `maxBytes`. The status rules are {@link read}'s.
   */
  async function readBinary(
    url: string,
    access: GraphToken,
    maxBytes: number,
  ): Promise<Uint8Array | 'too_large' | MailboxSkip> {
    const answer = await readAnswer(url, access, { outlook: false, maxBinary: maxBytes });
    if (typeof answer === 'string') return answer;
    return answer.bytes ?? new Uint8Array();
  }

  const DIRECTORY_SKIPS: Readonly<Record<MailboxSkip, DirectorySkip>> = {
    no_mailbox: 'not_found',
    denied: 'denied',
    refused: 'refused',
  };

  return {
    token,

    forget() {
      cache.delete(cacheKey);
    },

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
      const pages = pagesFor(from, to);
      for (let n = 0; n < pages; n += 1) {
        if (url === null) return { events };
        const answer = await read(url, access);
        // On any page: the person's read is incomplete, so it is theirs
        // skipped — and the caller retires nothing of theirs.
        if (typeof answer === 'string') return { skipped: answer };
        const page = (answer.body ?? {}) as { value?: unknown; '@odata.nextLink'?: unknown };
        if (!Array.isArray(page.value)) throw new GraphAnswerError('calendarView: no value list');
        events.push(...(page.value as unknown[]).map(eventOf));
        url = nextLinkOf(page['@odata.nextLink']);
      }
      if (url === null) return { events };
      throw new GraphAnswerError(`calendarView: more than ${String(pages)} pages`);
    },

    async user(address) {
      const access = await token();
      const select = new URLSearchParams({ $select: USER_FIELDS });
      const direct = await readDirectory(
        `${GRAPH_ROOT}/users/${encodeURIComponent(address)}?${select.toString()}`,
        access,
      );
      if (typeof direct !== 'string') return { user: userOf(direct.body) };
      if (direct !== 'no_mailbox') return { skipped: DIRECTORY_SKIPS[direct] };
      // `/users/{x}` answers to an id or a user principal name; an address
      // that is only someone's `mail` is asked for by that, once, and must
      // name exactly one person.
      const query = new URLSearchParams({
        $filter: `mail eq '${address.replace(/'/g, "''")}'`,
        $select: USER_FIELDS,
        $top: '2',
      });
      const listed = await readDirectory(`${GRAPH_ROOT}/users?${query.toString()}`, access);
      if (typeof listed === 'string') return { skipped: DIRECTORY_SKIPS[listed] };
      const page = (listed.body ?? {}) as { value?: unknown };
      if (!Array.isArray(page.value)) throw new GraphAnswerError('users: no value list');
      const found = page.value as unknown[];
      if (found.length === 0) return { skipped: 'not_found' };
      if (found.length > 1) return { skipped: 'refused' };
      return { user: userOf(found[0]) };
    },

    async userById(objectId) {
      const access = await token();
      const select = new URLSearchParams({ $select: USER_FIELDS });
      const answer = await readDirectory(
        `${GRAPH_ROOT}/users/${encodeURIComponent(objectId)}?${select.toString()}`,
        access,
      );
      return typeof answer === 'string'
        ? { skipped: DIRECTORY_SKIPS[answer] }
        : { user: userOf(answer.body) };
    },

    async manager(userId) {
      const access = await token();
      const select = new URLSearchParams({ $select: MANAGER_FIELDS });
      const answer = await readDirectory(
        `${GRAPH_ROOT}/users/${encodeURIComponent(userId)}/manager?${select.toString()}`,
        access,
      );
      // No manager is a `404`; one Graph will not show is no manager to Laika.
      return typeof answer === 'string' ? null : userOf(answer.body);
    },

    async photoTag(userId) {
      const access = await token();
      const base = `${GRAPH_ROOT}/users/${encodeURIComponent(userId)}`;
      // The 240px photo, and the default one when there is none at that size.
      for (const size of ['sized', 'default'] as const) {
        const answer = await readDirectory(
          size === 'sized' ? `${base}/photos/${PHOTO_SIZE}` : `${base}/photo`,
          access,
        );
        if (answer === 'no_mailbox') continue;
        if (typeof answer === 'string') return { kind: 'skipped' };
        const meta = (answer.body ?? {}) as { '@odata.mediaEtag'?: unknown };
        return { kind: 'tag', tag: textOf(meta['@odata.mediaEtag'], 200) ?? '', size };
      }
      return { kind: 'none' };
    },

    async photo(userId, size, maxBytes) {
      const access = await token();
      const base = `${GRAPH_ROOT}/users/${encodeURIComponent(userId)}`;
      const answer = await readBinary(
        size === 'sized' ? `${base}/photos/${PHOTO_SIZE}/$value` : `${base}/photo/$value`,
        access,
        maxBytes,
      );
      if (answer === 'too_large') return { kind: 'too_large' };
      if (answer === 'no_mailbox') return { kind: 'none' };
      if (typeof answer === 'string') return { kind: 'skipped' };
      // An empty answer says nothing about the photo: nothing stored goes (F5).
      if (answer.length === 0) return { kind: 'skipped' };
      return { kind: 'bytes', bytes: answer };
    },
  };
}

/** A directory object: its id, its two names lowercased, and the three fields the sync keeps. */
function userOf(row: unknown): GraphUser {
  const r = (row ?? {}) as Record<string, unknown>;
  const id = textOf(r.id, 64);
  if (id === null) throw new GraphAnswerError('user: no id');
  return {
    id,
    mail: textOf(r.mail, 320)?.toLowerCase() ?? null,
    userPrincipalName: textOf(r.userPrincipalName, 320)?.toLowerCase() ?? null,
    jobTitle: textOf(r.jobTitle, 200),
    department: textOf(r.department, 200),
    accountEnabled: typeof r.accountEnabled === 'boolean' ? r.accountEnabled : null,
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
    isOnlineMeeting: r.isOnlineMeeting === true,
    location: textOf(location.displayName, 200),
  };
}
