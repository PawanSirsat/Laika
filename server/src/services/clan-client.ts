import { type LeavePart } from '../db/enums.ts';
import { ApiError } from '../errors.ts';

/**
 * Clan, the organisation's HR system (D-149, LAI-1181) — a Worksuite build
 * whose REST API is documented at `https://app.clan.biz/docs`.
 *
 * **One of the few places data leaves the instance**, so this follows
 * `services/provider.ts`: no SDK, an injectable `fetchImpl` so **no test makes
 * a real call**, a timeout on every request cleared in `finally`, and Clan's
 * own response text never echoed — it is a third party's words on their way
 * to a Laika user (§13.1).
 *
 * **Reads only**, plus the one sign-in: `POST /auth/login` and, when the
 * account has a second factor, `POST /auth/two-factor`. Laika never writes to
 * Clan, and **never calls `/auth/refresh`**, which answers a token good for an
 * hour and revokes the year-long one it was given.
 *
 * **One retry, bounded.** A `429` or a `503` is asked once more after the
 * `Retry-After` it names (a second when it names none) — the pattern of
 * `scripts/backfill-external-ref.ts` — unless it asks for more than
 * {@link CLAN_RETRY_AFTER_MAX_MS}, when the read gives up and says Clan could
 * not be reached. A sync every 30 minutes is the next attempt; waiting minutes
 * inside one buys nothing.
 */

/** Long enough for a page of a thousand rows, short enough that a hung Clan frees the sync. */
export const CLAN_TIMEOUT_MS = 20_000;

/** Clan's largest page. */
export const CLAN_PAGE_LIMIT = 1_000;

/** The longest `Retry-After` the one retry waits for. */
export const CLAN_RETRY_AFTER_MAX_MS = 30_000;

/** The wait when a `429` or `503` names none. */
const DEFAULT_RETRY_MS = 1_000;

/**
 * A list that has not ended after this many pages is not an answer Laika can
 * use: two hundred thousand rows is far past any organisation's leave in the
 * sync's three years, and a Clan that keeps answering full pages would
 * otherwise keep the sync reading for ever.
 */
const MAX_PAGES = 200;

/** What a list endpoint asks for, so the answer carries only what Laika keeps. */
const EMPLOYEE_FIELDS = 'id,name,email,employee_detail';
const LEAVE_FIELDS =
  'id,unique_id,leave_date,duration,half_day_type,status,user_id,type{id,type_name}';

/**
 * Clan could not be reached, or would not answer (§6.3's `unavailable`).
 *
 * `reached` says whether the request got to Clan — a timeout or an error
 * status did, a refused connection did not — `ProviderUnavailableError`'s
 * property, kept as a property rather than a prose reason to branch on.
 */
export class ClanUnavailableError extends ApiError {
  readonly reached: boolean;

  constructor(why: string, reached = false) {
    super('unavailable', 'Clan could not be reached', { reason: 'clan_unreachable', why });
    this.name = 'ClanUnavailableError';
    this.reached = reached;
  }
}

/** Clan refused the token (`401`), or the account it belongs to may not read this (`403`). */
export class ClanAuthError extends ApiError {
  constructor(why: string) {
    super('unprocessable', 'Clan refused the stored token', {
      reason: 'clan_token_rejected',
      why,
    });
    this.name = 'ClanAuthError';
  }
}

/** Clan did not accept the email, password or second-factor code. Its words are not passed on. */
export class ClanLoginError extends ApiError {
  constructor() {
    super('unprocessable', 'Clan did not accept that sign-in', { reason: 'clan_login_failed' });
    this.name = 'ClanLoginError';
  }
}

/** Clan answered, with something Laika cannot read as the documented shape. */
export class ClanAnswerError extends ApiError {
  constructor(why: string) {
    super('unavailable', 'Clan answered something Laika could not read', {
      reason: 'clan_bad_answer',
      why,
    });
    this.name = 'ClanAnswerError';
  }
}

/**
 * `https://<company>.clan.biz` in any of the ways a person pastes it → the
 * API root, `https://<company>.clan.biz/api/v1`, with no trailing slash.
 *
 * **`https:` only**: the token travels in a header on every request, and a
 * password on the first. No credentials, query or fragment in the URL either
 * — each is somewhere a secret could hide, or a request Laika did not mean.
 */
export function normaliseClanBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ApiError('unprocessable', 'base_url is not a URL', {
      field: 'base_url',
      reason: 'base_url_invalid',
    });
  }
  if (url.protocol !== 'https:') {
    throw new ApiError('unprocessable', 'base_url must be an https address', {
      field: 'base_url',
      reason: 'base_url_not_https',
    });
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new ApiError('unprocessable', 'base_url carries more than an address', {
      field: 'base_url',
      reason: 'base_url_invalid',
    });
  }
  const path = url.pathname.replace(/\/+$/, '');
  const root = path.endsWith('/api/v1') ? path : `${path}/api/v1`;
  return `${url.origin}${root}`;
}

/** What `POST /auth/login` answers. */
export interface ClanLogin {
  token: string;
  /** Unix ms, or null when Clan did not say. */
  expiresAt: number | null;
  /** Null when the account has no second factor; else the methods Clan offers. */
  twoFactor: { methods: string[] } | null;
}

/** What `POST /auth/two-factor` answers: a new token when Clan sends one. */
export interface ClanTwoFactor {
  token: string | null;
  expiresAt: number | null;
}

/** One employee, as Laika keeps them: never their email past the match. */
export interface ClanEmployee {
  id: string;
  name: string;
  /** Lowercased and trimmed, for the match only; null when Clan has none. */
  email: string | null;
  departmentRef: string | null;
  designationRef: string | null;
}

export interface ClanHoliday {
  id: string;
  /** `YYYY-MM-DD`. */
  day: string;
  label: string;
  /** Empty for both is everyone. */
  departments: string[];
  designations: string[];
}

/** One day of leave — Clan keeps a row per day. */
export interface ClanLeaveDay {
  id: string;
  /** Clan's `unique_id`, the application the day belongs to. */
  applicationRef: string | null;
  /** `YYYY-MM-DD`. */
  day: string;
  part: LeavePart;
  /** Lowercased: `pending`, `approved`, `rejected`, `cancelled`, or whatever Clan says. */
  status: string;
  /** The employee's id. */
  personRef: string;
  typeName: string | null;
}

export interface ClanClient {
  login(email: string, password: string): Promise<ClanLogin>;
  twoFactor(token: string, method: string, code: string): Promise<ClanTwoFactor>;
  employees(token: string): Promise<ClanEmployee[]>;
  /** Every holiday whose day falls in `from`–`to`, inclusive. */
  holidays(token: string, from: string, to: string): Promise<ClanHoliday[]>;
  /** Every leave day in `from`–`to`, inclusive, whatever its status. */
  leave(token: string, from: string, to: string): Promise<ClanLeaveDay[]>;
}

export interface ClanClientOptions {
  /** Already normalised by {@link normaliseClanBaseUrl}. */
  baseUrl: string;
  fetchImpl?: typeof fetch | undefined;
  /** How the one retry waits — injected by the tests, which never wait. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
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

/** The real client. */
export function clanClient(options: ClanClientOptions): ClanClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const timeoutMs = options.timeoutMs ?? CLAN_TIMEOUT_MS;
  const base = options.baseUrl;

  /** One request, body read inside the same timeout. */
  async function once(url: string, init: RequestInit): Promise<Answer> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { status: res.status, body, retryAfter: res.headers.get('retry-after') };
    } catch (err) {
      // `AbortError`, DNS failure, connection refused: none of them our bug,
      // and none of them Clan's words. An abort gave up on a request Clan had.
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new ClanUnavailableError(timedOut ? 'timed out' : 'could not connect', timedOut);
    } finally {
      clearTimeout(timer);
    }
  }

  /** {@link once}, and once more after a `429` or `503` that asks for a short wait. */
  async function send(path: string, init: RequestInit): Promise<Answer> {
    const url = `${base}${path}`;
    const first = await once(url, init);
    if (first.status !== 429 && first.status !== 503) return first;
    const wait = retryAfterMs(first.retryAfter);
    if (wait > CLAN_RETRY_AFTER_MAX_MS) {
      throw new ClanUnavailableError(
        `answered ${String(first.status)}, retry after too long`,
        true,
      );
    }
    await sleep(wait);
    return once(url, init);
  }

  function headers(token: string | null, json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    if (token !== null) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /** A token-carrying read: `2xx` is the body, anything else a named failure. */
  async function read(path: string, token: string): Promise<unknown> {
    const answer = await send(path, { method: 'GET', headers: headers(token, false) });
    if (answer.status >= 200 && answer.status < 300) return answer.body;
    if (answer.status === 401 || answer.status === 403) {
      throw new ClanAuthError(`answered ${String(answer.status)}`);
    }
    if (answer.status === 429 || answer.status >= 500) {
      throw new ClanUnavailableError(`answered ${String(answer.status)}`, true);
    }
    throw new ClanAnswerError(`answered ${String(answer.status)}`);
  }

  /**
   * Every row of a list, page by page, by `offset` until `meta.paging.total`.
   *
   * **All of it or a throw.** A list that ends short of the total it named is
   * not a smaller list — it is an incomplete read, and the sync reconciles by
   * absence, so treating it as complete would remove whatever the missing
   * pages held.
   */
  async function list(
    resource: string,
    token: string,
    params: Record<string, string>,
  ): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        ...params,
        limit: String(CLAN_PAGE_LIMIT),
        offset: String(rows.length),
      });
      const body = await read(`/${resource}?${query.toString()}`, token);
      const root = body as { data?: unknown; meta?: { paging?: { total?: unknown } } } | undefined;
      const data = root?.data;
      if (!Array.isArray(data)) throw new ClanAnswerError(`${resource}: no data list`);
      rows.push(...(data as unknown[]));

      const totalRaw = root?.meta?.paging?.total;
      const total =
        typeof totalRaw === 'number' || typeof totalRaw === 'string' ? Number(totalRaw) : NaN;
      if (Number.isFinite(total)) {
        if (rows.length >= total) return rows;
        if (data.length === 0) {
          throw new ClanAnswerError(
            `${resource}: ended at ${String(rows.length)} of ${String(total)}`,
          );
        }
      } else if (data.length < CLAN_PAGE_LIMIT) {
        return rows;
      }
    }
    throw new ClanAnswerError(`${resource}: more than ${String(MAX_PAGES)} pages`);
  }

  return {
    async login(email, password) {
      const answer = await send('/auth/login', {
        method: 'POST',
        headers: headers(null, true),
        body: JSON.stringify({ email, password }),
      });
      if (answer.status >= 500 || answer.status === 429) {
        throw new ClanUnavailableError(`answered ${String(answer.status)}`, true);
      }
      // Wrong password, unknown email, a company URL Clan does not know: all
      // refusals of the sign-in, and none of Clan's wording reaches the person.
      if (answer.status >= 400) throw new ClanLoginError();
      if (answer.status < 200 || answer.status >= 300) {
        throw new ClanAnswerError(`answered ${String(answer.status)}`);
      }
      const data = (answer.body as { data?: Record<string, unknown> } | undefined)?.data;
      const token = data?.token;
      if (typeof token !== 'string' || token === '') {
        throw new ClanAnswerError('login: no token');
      }
      const factor = data?.two_factor_auth as { enabled?: unknown; methods?: unknown } | undefined;
      const enabled = factor?.enabled === true || factor?.enabled === 1;
      return {
        token,
        expiresAt: instantOf(data?.expires),
        twoFactor: enabled ? { methods: methodsOf(factor?.methods) } : null,
      };
    },

    async twoFactor(token, method, code) {
      const answer = await send('/auth/two-factor', {
        method: 'POST',
        headers: headers(token, true),
        body: JSON.stringify({ method, code }),
      });
      if (answer.status >= 500 || answer.status === 429) {
        throw new ClanUnavailableError(`answered ${String(answer.status)}`, true);
      }
      if (answer.status >= 400) throw new ClanLoginError();
      if (answer.status < 200 || answer.status >= 300) {
        throw new ClanAnswerError(`answered ${String(answer.status)}`);
      }
      const data = (answer.body as { data?: Record<string, unknown> } | undefined)?.data;
      const next = data?.token;
      return {
        token: typeof next === 'string' && next !== '' ? next : null,
        expiresAt: instantOf(data?.expires),
      };
    },

    async employees(token) {
      const rows = await list('employee', token, { fields: EMPLOYEE_FIELDS });
      return rows.map(employeeOf);
    },

    async holidays(token, from, to) {
      // **No `filters=` here**: the holiday's shape is undocumented, and a
      // filter naming a field Clan does not have is a `400` for every sync.
      // There are dozens a year, so they are read whole and cut to the window.
      const rows = await list('holiday', token, {});
      return rows.map(holidayOf).filter((h) => h.day >= from && h.day <= to);
    },

    async leave(token, from, to) {
      const rows = await list('leave', token, {
        fields: LEAVE_FIELDS,
        filters: `leave_date ge "${from}" and leave_date le "${to}"`,
      });
      return rows.map(leaveOf).filter((l) => l.day >= from && l.day <= to);
    },
  };
}

// ------------------------------------------------------------------ parsing
//
// Defensive, and strict where it matters: a row without an id or a day is a
// bad answer for the whole read, because the sync removes by absence and a
// row it cannot place would look absent.

function idOf(value: unknown, what: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  throw new ClanAnswerError(`${what}: no id`);
}

function refOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'object' && value !== null && 'id' in value) {
    return refOf(value.id);
  }
  return null;
}

/** The first ten characters of a date or a date-time, when they are a date. */
function dayOf(value: unknown, what: string): string {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ClanAnswerError(`${what}: no date`);
  return day;
}

function textOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function instantOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/** The second-factor methods Clan offers: names, or objects that carry one. */
function methodsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((m) => {
    const named: unknown =
      typeof m === 'object' && m !== null
        ? ((m as { method?: unknown }).method ?? (m as { name?: unknown }).name)
        : m;
    const name = textOf(named, 40);
    return name === null ? [] : [name];
  });
}

/** A scope field Clan may send as one id, a list, a JSON list or a comma list. */
function refsOf(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((v) => refsOf(v));
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('[')) {
      try {
        return refsOf(JSON.parse(text) as unknown);
      } catch {
        return [];
      }
    }
    return text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  }
  const ref = refOf(value);
  return ref === null ? [] : [ref];
}

function employeeOf(row: unknown): ClanEmployee {
  const r = (row ?? {}) as Record<string, unknown>;
  const id = idOf(r.id, 'employee');
  const detail = (r.employee_detail ?? {}) as Record<string, unknown>;
  const email = textOf(r.email, 320);
  return {
    id,
    name: textOf(r.name, 200) ?? `Clan person ${id}`.slice(0, 200),
    email: email === null ? null : email.toLowerCase(),
    departmentRef: refOf(detail.department_id) ?? refOf(detail.department),
    designationRef: refOf(detail.designation_id) ?? refOf(detail.designation),
  };
}

function holidayOf(row: unknown): ClanHoliday {
  const r = (row ?? {}) as Record<string, unknown>;
  const id = idOf(r.id, 'holiday');
  const label =
    textOf(r.occassion, 120) ??
    textOf(r.occasion, 120) ??
    textOf(r.name, 120) ??
    textOf(r.title, 120) ??
    'Holiday';
  const unique = (values: string[]) => [...new Set(values)].sort();
  return {
    id,
    day: dayOf(r.date, 'holiday'),
    label,
    departments: unique([
      ...refsOf(r.department_id),
      ...refsOf(r.department_ids),
      ...refsOf(r.departments),
    ]),
    designations: unique([
      ...refsOf(r.designation_id),
      ...refsOf(r.designation_ids),
      ...refsOf(r.designations),
    ]),
  };
}

/**
 * `duration: "half day"` with `half_day_type` `first_half` or `second_half`;
 * anything else is a whole day. A half day that names no half is taken as the
 * first: which half only changes the words a screen shows, and either half
 * owes half the day (D-149 item 6).
 */
function partOf(duration: unknown, half: unknown): LeavePart {
  const isHalf =
    typeof duration === 'string' &&
    duration.trim().toLowerCase().replace(/[_-]/g, ' ') === 'half day';
  if (!isHalf) return 'full';
  return typeof half === 'string' && half.trim().toLowerCase() === 'second_half'
    ? 'second_half'
    : 'first_half';
}

function leaveOf(row: unknown): ClanLeaveDay {
  const r = (row ?? {}) as Record<string, unknown>;
  const type = (r.type ?? null) as Record<string, unknown> | null;
  const status = textOf(r.status, 40);
  if (status === null) throw new ClanAnswerError('leave: no status');
  return {
    id: idOf(r.id, 'leave'),
    applicationRef: refOf(r.unique_id),
    day: dayOf(r.leave_date, 'leave'),
    part: partOf(r.duration, r.half_day_type),
    status: status.toLowerCase(),
    personRef: idOf(r.user_id, 'leave person'),
    typeName: type === null ? null : textOf(type.type_name, 80),
  };
}
