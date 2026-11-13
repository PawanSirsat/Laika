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
 * **`GET`s, plus the one sign-in that makes a token** (D-149 item 1): a
 * dedicated HR account is either signed in with once — `POST /auth/login`
 * and, when Clan asks, `POST /auth/two-factor`, the password and code used
 * for those calls and nothing else — or a token made for it is pasted.
 * Laika never writes to Clan, and **never calls `/auth/refresh`**, which
 * answers a token good for an hour and revokes the year-long one it was
 * given.
 *
 * **Lists are paged until a short page**, never by `meta.paging.total`:
 * measured against a live Clan, `/employee` answered `total: 2` with 25 rows
 * (LAI-1180's log). A total that undercounts would end a read early, and the
 * sync removes by absence.
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

/**
 * Clan refused the token (`401`), or the account it belongs to may not read
 * this (`403`). Its words are not passed on. `answered` is which.
 */
export class ClanAuthError extends ApiError {
  readonly answered: number;
  /**
   * The `403` said `TWO_FACTOR_REQUIRED`: a sign-in's restricted token, which
   * reads nothing until its code is given (LAI-1180's live login). That is the
   * token refused, never "this role may not read it".
   */
  readonly twoFactorRequired: boolean;

  constructor(answered: number, twoFactorRequired = false) {
    super('unprocessable', 'Clan refused that token', {
      reason: 'clan_token_refused',
      why: twoFactorRequired ? 'two-factor required' : `answered ${String(answered)}`,
    });
    this.name = 'ClanAuthError';
    this.answered = answered;
    this.twoFactorRequired = twoFactorRequired;
  }
}

/** Clan's machine code on a refusal, when it sent one — read, never passed on. */
function innerCode(body: unknown): string | null {
  const code = (body as { error?: { innererror?: { code?: unknown } } } | undefined)?.error
    ?.innererror?.code;
  return typeof code === 'string' ? code : null;
}

/** Clan did not accept the email, password or two-factor code. Its words are not passed on. */
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
 * sign-in's password in the first. No
 * credentials, query or fragment in the URL either — each is somewhere a
 * secret could hide, or a request Laika did not mean.
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
  /**
   * The token. With a second factor on, it is a **restricted** one — Clan
   * answers every read `403` until the code is given — and the code's answer
   * carries the token to keep (LAI-1180's live login).
   */
  token: string;
  /** Unix ms, or null when Clan did not say. */
  expiresAt: number | null;
  /** Null when the account has no second factor; else the methods Clan offers. */
  twoFactor: { methods: string[] } | null;
}

/** What `POST /auth/two-factor` answers: the token to keep, when Clan sends one. */
export interface ClanTwoFactor {
  token: string | null;
  expiresAt: number | null;
}

/**
 * What a token can read, checked when it is connected (D-149 item 1): whose it
 * is, and whether it sees everyone's leave and people's departments.
 */
export interface ClanTokenCheck {
  /** The HR account the token belongs to, as Clan names it. */
  accountName: string;
  /** A page of leave named more than one person. */
  seesEveryone: boolean;
  /** A page of employees had a department filled in. */
  seesDepartments: boolean;
}

/** One employee, as Laika keeps them: never their email past the match. */
export interface ClanEmployee {
  id: string;
  name: string;
  /** Lowercased and trimmed, for the match only; null when Clan has none. */
  email: string | null;
  departmentRef: string | null;
  designationRef: string | null;
  /** `full_time`, `part_time`, … as Clan has it. */
  employmentType: string | null;
}

export interface ClanHoliday {
  id: string;
  /** `YYYY-MM-DD`. */
  day: string;
  label: string;
  /** Empty for all three is everyone Clan lists. */
  departments: string[];
  designations: string[];
  employmentTypes: string[];
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
  /** Whose the token is and what it reads, from `/auth/me` and a page each of leave and people. */
  check(token: string, from: string, to: string): Promise<ClanTokenCheck>;
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

  /** A token-carrying read: `2xx` is the body, anything else a named failure. */
  async function read(path: string, token: string): Promise<unknown> {
    const answer = await send(path, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (answer.status >= 200 && answer.status < 300) return answer.body;
    if (answer.status === 401 || answer.status === 403) {
      throw new ClanAuthError(answer.status, innerCode(answer.body) === 'TWO_FACTOR_REQUIRED');
    }
    if (answer.status === 429 || answer.status >= 500) {
      throw new ClanUnavailableError(`answered ${String(answer.status)}`, true);
    }
    throw new ClanAnswerError(`answered ${String(answer.status)}`);
  }

  /** One page of a list's rows, or a bad answer when there is no list. */
  async function page(
    resource: string,
    token: string,
    params: Record<string, string>,
    offset: number,
  ): Promise<unknown[]> {
    const query = new URLSearchParams({
      ...params,
      limit: String(CLAN_PAGE_LIMIT),
      offset: String(offset),
    });
    const body = await read(`/${resource}?${query.toString()}`, token);
    const data = (body as { data?: unknown } | undefined)?.data;
    if (!Array.isArray(data)) throw new ClanAnswerError(`${resource}: no data list`);
    return data as unknown[];
  }

  /**
   * Every row of a list, page by page by `offset`, **until a page comes back
   * shorter than asked for**. `meta.paging.total` is not read: a live Clan
   * has been measured getting it wrong.
   *
   * **All of it or a throw.** A page that fails fails the whole read — the
   * sync removes by absence, so a read missing a page must never look
   * complete.
   */
  async function list(
    resource: string,
    token: string,
    params: Record<string, string>,
  ): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let n = 0; n < MAX_PAGES; n += 1) {
      const data = await page(resource, token, params, rows.length);
      rows.push(...data);
      if (data.length < CLAN_PAGE_LIMIT) return rows;
    }
    throw new ClanAnswerError(`${resource}: more than ${String(MAX_PAGES)} pages`);
  }

  /** A first page that a `403` leaves empty: the token may not read it, which is the answer. */
  async function firstPageOrNone(
    resource: string,
    token: string,
    params: Record<string, string>,
  ): Promise<unknown[]> {
    try {
      return await page(resource, token, params, 0);
    } catch (err) {
      if (err instanceof ClanAuthError && err.answered === 403 && !err.twoFactorRequired) {
        return [];
      }
      throw err;
    }
  }

  /** A sign-in call: `2xx` is `data`, a refusal `ClanLoginError`, never Clan's words. */
  async function signIn(
    path: string,
    body: unknown,
    token: string | null,
  ): Promise<Record<string, unknown> | undefined> {
    const answer = await send(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
    if (answer.status >= 500 || answer.status === 429) {
      throw new ClanUnavailableError(`answered ${String(answer.status)}`, true);
    }
    // Wrong password, unknown email, a wrong code, a company address Clan
    // does not know: all refusals, and none of Clan's wording goes further.
    if (answer.status >= 400) throw new ClanLoginError();
    if (answer.status < 200 || answer.status >= 300) {
      throw new ClanAnswerError(`answered ${String(answer.status)}`);
    }
    return (answer.body as { data?: Record<string, unknown> } | undefined)?.data;
  }

  return {
    async login(email, password) {
      const data = await signIn('/auth/login', { email, password }, null);
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
      const data = await signIn('/auth/two-factor', { method, code }, token);
      const next = data?.token;
      return {
        token: typeof next === 'string' && next !== '' ? next : null,
        expiresAt: instantOf(data?.expires),
      };
    },

    async check(token, from, to) {
      // Whose it is. A `401` here is the token refused — the caller's answer.
      const me = await read('/auth/me', token);
      const data = (me as { data?: unknown } | undefined)?.data;
      if (typeof data !== 'object' || data === null) throw new ClanAnswerError('auth/me: no data');
      const user = data as { name?: unknown; email?: unknown; user?: unknown };
      const nested = (user.user ?? {}) as { name?: unknown; email?: unknown };
      const accountName =
        textOf(user.name, 200) ??
        textOf(nested.name, 200) ??
        textOf(user.email, 200) ??
        textOf(nested.email, 200) ??
        'Clan account';

      // What it reads: one page each is enough to say so. A `403` is a role
      // that may not read the list, which is what the check reports.
      const leave = await firstPageOrNone('leave', token, {
        fields: 'id,user_id',
        filters: `leave_date ge "${from}" and leave_date le "${to}"`,
      });
      const people = await firstPageOrNone('employee', token, { fields: EMPLOYEE_FIELDS });
      const persons = new Set(
        leave.flatMap((row) => {
          const ref = refOf((row as { user_id?: unknown } | null)?.user_id);
          return ref === null ? [] : [ref];
        }),
      );
      return {
        accountName,
        seesEveryone: persons.size > 1,
        seesDepartments: people.some((row) => employeeOf(row).departmentRef !== null),
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

/**
 * The two-factor methods Clan offers. Measured on a live Clan as an object of
 * switches — `{ email: false, google_authenticator: true }` — so the methods
 * are the keys switched on; a list of names, or of objects carrying one, is
 * read as well.
 */
function methodsOf(value: unknown): string[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([name, on]) =>
      on === true || on === 1 ? [name.slice(0, 40)] : [],
    );
  }
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
    employmentType: textOf(detail.employment_type, 80) ?? textOf(r.employment_type, 80),
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
    // Measured on a live Clan: `department_id_json`, `designation_id_json`
    // and `employment_type_json`, each a JSON string. The other spellings are
    // Worksuite's elsewhere, read in case a build sends them.
    departments: unique([
      ...refsOf(r.department_id_json),
      ...refsOf(r.department_id),
      ...refsOf(r.department_ids),
      ...refsOf(r.departments),
    ]),
    designations: unique([
      ...refsOf(r.designation_id_json),
      ...refsOf(r.designation_id),
      ...refsOf(r.designation_ids),
      ...refsOf(r.designations),
    ]),
    employmentTypes: unique([
      ...refsOf(r.employment_type_json),
      ...refsOf(r.employment_type),
      ...refsOf(r.employment_types),
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
