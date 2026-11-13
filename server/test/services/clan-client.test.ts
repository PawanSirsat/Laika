import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/errors.ts';
import {
  CLAN_PAGE_LIMIT,
  ClanAnswerError,
  ClanAuthError,
  clanClient,
  ClanLoginError,
  ClanUnavailableError,
  normaliseClanBaseUrl,
} from '../../src/services/clan-client.ts';
import {
  CLAN_ACCOUNT,
  CLAN_BASE,
  CLAN_EMAIL,
  CLAN_PASSWORD,
  CLAN_RESTRICTED_TOKEN,
  CLAN_TOKEN,
  employee,
  fakeClan,
  type FakeClan,
  leaveRow,
} from '../helpers/fake-clan.ts';

/**
 * The Clan client (D-149, LAI-1181), against a fake Clan behind an injected
 * `fetch` — **no test here, or anywhere, calls a real HR system**.
 */

function client(fake: FakeClan, waits: number[] = [], timeoutMs = 2_000) {
  return clanClient({
    baseUrl: CLAN_BASE,
    fetchImpl: fake.fetchImpl,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    timeoutMs,
  });
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a failure, and the call succeeded');
}

function reasonOf(err: ApiError): string | undefined {
  return (err.details as { reason?: string } | null)?.reason;
}

describe('the base URL', () => {
  it('normalises what a person pastes to the API root, with no trailing slash', () => {
    expect(normaliseClanBaseUrl('https://kvell.clan.biz')).toBe(CLAN_BASE);
    expect(normaliseClanBaseUrl('  https://kvell.clan.biz/  ')).toBe(CLAN_BASE);
    expect(normaliseClanBaseUrl('https://kvell.clan.biz/api/v1/')).toBe(CLAN_BASE);
    expect(normaliseClanBaseUrl('https://KVELL.clan.biz/api/v1')).toBe(CLAN_BASE);
  });

  it('refuses anything but https, naming the field', () => {
    let err: unknown;
    try {
      normaliseClanBaseUrl('http://kvell.clan.biz');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).details).toEqual({
      field: 'base_url',
      reason: 'base_url_not_https',
    });
  });

  it('refuses a URL carrying credentials, a query or a fragment, and one that is not a URL', () => {
    for (const bad of [
      'https://user:pw@kvell.clan.biz',
      'https://kvell.clan.biz/?x=1',
      'https://kvell.clan.biz/#a',
      'kvell.clan.biz',
    ]) {
      let err: unknown;
      try {
        normaliseClanBaseUrl(bad);
      } catch (e) {
        err = e;
      }
      expect((err as ApiError).details, bad).toEqual({
        field: 'base_url',
        reason: 'base_url_invalid',
      });
    }
  });
});

describe('checking a pasted token', () => {
  const WINDOW = ['2025-01-01', '2027-12-31'] as const;

  it('says whose it is and that it sees everyone and their departments', async () => {
    const fake = fakeClan({
      employees: [employee(1, 'Ada', 'ada@example.test')],
      leave: [leaveRow(100, 1, '2026-03-02'), leaveRow(101, 2, '2026-03-03')],
    });
    expect(await client(fake).check(CLAN_TOKEN, ...WINDOW)).toEqual({
      accountName: CLAN_ACCOUNT,
      seesEveryone: true,
      seesDepartments: true,
    });
    // GETs only, with the token, and one page of each list.
    expect(fake.requests.map((r) => [r.method, r.path, r.authorization])).toEqual([
      ['GET', '/auth/me', `Bearer ${CLAN_TOKEN}`],
      ['GET', '/leave', `Bearer ${CLAN_TOKEN}`],
      ['GET', '/employee', `Bearer ${CLAN_TOKEN}`],
    ]);
    expect(fake.to('/leave')[0]?.query.get('offset')).toBe('0');
  });

  it('says an employee-role token sees one person and no departments', async () => {
    // LAI-1180's live measurement: an `employee` role reads its own leave and
    // nobody's department.
    const fake = fakeClan({
      employees: [employee(1, 'Ada', 'ada@example.test', { department_id: null })],
      leave: [leaveRow(100, 1, '2026-03-02'), leaveRow(101, 1, '2026-03-03')],
    });
    expect(await client(fake).check(CLAN_TOKEN, ...WINDOW)).toMatchObject({
      seesEveryone: false,
      seesDepartments: false,
    });
  });

  it('reads a 403 on a list as “sees none of it”, not as a refusal', async () => {
    const fake = fakeClan({ employees: [employee(1, 'Ada', 'ada@example.test')] });
    fake.forbidden.add('/leave');
    fake.forbidden.add('/employee');
    expect(await client(fake).check(CLAN_TOKEN, ...WINDOW)).toEqual({
      accountName: CLAN_ACCOUNT,
      seesEveryone: false,
      seesDepartments: false,
    });
  });

  it('names the account from a nested user, or its email, when Clan sends no name', async () => {
    const nested = fakeClan({ me: { user: { name: 'Forge Sync' } } });
    expect((await client(nested).check(CLAN_TOKEN, ...WINDOW)).accountName).toBe('Forge Sync');
    const email = fakeClan({ me: { email: 'forge@kvelld.example' } });
    expect((await client(email).check(CLAN_TOKEN, ...WINDOW)).accountName).toBe(
      'forge@kvelld.example',
    );
  });

  it('refuses a sign-in’s restricted token, even where a 403 would otherwise mean “sees none”', async () => {
    // LAI-1180's live login: every read of a pre-code token is 403
    // TWO_FACTOR_REQUIRED, `/auth/me` included.
    const restricted = await caught(client(fakeClan()).check(CLAN_RESTRICTED_TOKEN, ...WINDOW));
    expect(reasonOf(restricted)).toBe('clan_token_refused');
    expect((restricted as ClanAuthError).twoFactorRequired).toBe(true);
    expect(JSON.stringify(restricted.toBody())).not.toContain('CLAN-SECRET-WORDS');

    // And on a list, where a plain 403 reads as "sees none of it".
    const fake = fakeClan();
    fake.intercept = (req) =>
      req.path === '/leave'
        ? new Response(JSON.stringify({ error: { innererror: { code: 'TWO_FACTOR_REQUIRED' } } }), {
            status: 403,
          })
        : undefined;
    const onList = await caught(client(fake).check(CLAN_TOKEN, ...WINDOW));
    expect(reasonOf(onList)).toBe('clan_token_refused');
  });

  it('reads an employee as a live Clan sends one: department an object, designation null', async () => {
    const fake = fakeClan({
      employees: [
        {
          id: 1,
          name: 'Ada',
          email: 'ada@example.test',
          employee_detail: {
            id: 77,
            company: { id: 575 },
            department: { id: 3004, team_name: 'Engineering' },
            designation: null,
            shift: null,
          },
        },
      ],
    });
    expect(await client(fake).employees(CLAN_TOKEN)).toEqual([
      {
        id: '1',
        name: 'Ada',
        email: 'ada@example.test',
        departmentRef: '3004',
        designationRef: null,
        employmentType: null,
      },
    ]);
  });

  it('refuses a token Clan refuses: 422 clan_token_refused, without Clan’s words', async () => {
    const err = await caught(client(fakeClan()).check('not-the-token', ...WINDOW));

    expect(err).toBeInstanceOf(ClanAuthError);
    expect(err.status).toBe(422);
    expect(reasonOf(err)).toBe('clan_token_refused');
    expect((err as ClanAuthError).answered).toBe(401);
    expect(JSON.stringify(err.toBody())).not.toContain('CLAN-SECRET-WORDS');
  });

  it('reads with GETs only, and never refreshes the token', async () => {
    const fake = fakeClan({ employees: [employee(1, 'Ada', 'ada@example.test')] });
    const c = client(fake);
    await c.check(CLAN_TOKEN, ...WINDOW);
    await c.employees(CLAN_TOKEN);
    await c.holidays(CLAN_TOKEN, ...WINDOW);
    await c.leave(CLAN_TOKEN, ...WINDOW);

    expect(fake.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(fake.requests.map((r) => r.path)).toEqual([
      '/auth/me',
      '/leave',
      '/employee',
      '/employee',
      '/holiday',
      '/leave',
    ]);
  });
});

describe('signing in with the dedicated account', () => {
  it('sends the email and password once, and answers the token, its expiry and no second factor', async () => {
    const fake = fakeClan();
    const login = await client(fake).login(CLAN_EMAIL, CLAN_PASSWORD);

    expect(login).toEqual({
      token: CLAN_TOKEN,
      expiresAt: Date.parse('2027-11-13T12:00:00.000Z'),
      twoFactor: null,
    });
    const [req] = fake.to('/auth/login');
    expect(req?.method).toBe('POST');
    expect(JSON.parse(req?.body ?? '{}')).toEqual({ email: CLAN_EMAIL, password: CLAN_PASSWORD });
    expect(req?.authorization).toBeNull();
    expect(fake.requests).toHaveLength(1);
  });

  it('answers a restricted token and the methods switched on when a second factor is owed', async () => {
    // Measured: `methods` is `{ email: false, google_authenticator: true }`.
    const fake = fakeClan({ twoFactorMethods: ['google_authenticator'] });
    const login = await client(fake).login(CLAN_EMAIL, CLAN_PASSWORD);
    expect(login).toMatchObject({
      token: CLAN_RESTRICTED_TOKEN,
      twoFactor: { methods: ['google_authenticator'] },
    });
    const sent = (await fake
      .fetchImpl(`${CLAN_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: CLAN_EMAIL, password: CLAN_PASSWORD }),
      })
      .then((r) => r.json())) as { data: { two_factor_auth: { methods: unknown } } };
    expect(sent.data.two_factor_auth.methods).toEqual({
      email: false,
      google_authenticator: true,
    });
  });

  it('reads the methods from a list too', async () => {
    const fake = fakeClan();
    fake.intercept = (req) =>
      req.path === '/auth/login'
        ? new Response(
            JSON.stringify({
              data: {
                token: CLAN_RESTRICTED_TOKEN,
                two_factor_auth: { enabled: true, methods: ['email', { method: 'totp' }] },
              },
            }),
            { status: 200 },
          )
        : undefined;
    expect((await client(fake).login(CLAN_EMAIL, CLAN_PASSWORD)).twoFactor).toEqual({
      methods: ['email', 'totp'],
    });
  });

  it('refuses a wrong password as clan_login_failed, without Clan’s words', async () => {
    const err = await caught(client(fakeClan()).login(CLAN_EMAIL, 'wrong'));

    expect(err).toBeInstanceOf(ClanLoginError);
    expect(err.status).toBe(422);
    expect(reasonOf(err)).toBe('clan_login_failed');
    expect(JSON.stringify(err.toBody())).not.toContain('CLAN-SECRET-WORDS');
  });

  it('gives the code with the restricted token, and answers the token to keep', async () => {
    const fake = fakeClan({ twoFactorMethods: ['google_authenticator'], twoFactorCode: '123456' });
    const c = client(fake);

    const wrong = await caught(c.twoFactor(CLAN_RESTRICTED_TOKEN, 'google_authenticator', '0'));
    expect(reasonOf(wrong)).toBe('clan_login_failed');

    expect(await c.twoFactor(CLAN_RESTRICTED_TOKEN, 'google_authenticator', '123456')).toEqual({
      token: CLAN_TOKEN,
      expiresAt: Date.parse('2027-11-13T12:00:00.000Z'),
    });
    const last = fake.to('/auth/two-factor').at(-1);
    expect(last?.authorization).toBe(`Bearer ${CLAN_RESTRICTED_TOKEN}`);
    expect(JSON.parse(last?.body ?? '{}')).toEqual({
      method: 'google_authenticator',
      code: '123456',
    });
  });
});

describe('reading', () => {
  it('reads employees with the token, the fields asked for, and lowercased emails', async () => {
    const fake = fakeClan({
      employees: [
        employee(1, 'Ada Lovelace', '  Ada@Example.TEST '),
        employee(2, '', null, { department_id: null, department: { id: 9 } }),
      ],
    });
    const people = await client(fake).employees(CLAN_TOKEN);

    expect(people).toEqual([
      {
        id: '1',
        name: 'Ada Lovelace',
        email: 'ada@example.test',
        departmentRef: '3',
        designationRef: '7',
        employmentType: 'full_time',
      },
      {
        id: '2',
        name: 'Clan person 2',
        email: null,
        departmentRef: '9',
        designationRef: '7',
        employmentType: 'full_time',
      },
    ]);
    const [req] = fake.to('/employee');
    expect(req?.authorization).toBe(`Bearer ${CLAN_TOKEN}`);
    expect(req?.query.get('fields')).toBe('id,name,email,employee_detail');
  });

  it('pages past a thousand rows by offset until the total', async () => {
    const rows = Array.from({ length: 2_500 }, (_, i) =>
      leaveRow(i + 1, 1, `2026-0${String((i % 9) + 1)}-1${String(i % 9)}`),
    );
    const fake = fakeClan({ leave: rows });
    const days = await client(fake).leave(CLAN_TOKEN, '2025-01-01', '2027-12-31');

    expect(days).toHaveLength(2_500);
    expect(new Set(days.map((d) => d.id)).size).toBe(2_500);
    expect(fake.to('/leave').map((r) => [r.query.get('limit'), r.query.get('offset')])).toEqual([
      [String(CLAN_PAGE_LIMIT), '0'],
      [String(CLAN_PAGE_LIMIT), '1000'],
      [String(CLAN_PAGE_LIMIT), '2000'],
    ]);
  });

  it('asks for leave with its fields and the window as Clan’s filter', async () => {
    const fake = fakeClan();
    await client(fake).leave(CLAN_TOKEN, '2025-01-01', '2027-12-31');
    const [req] = fake.to('/leave');

    expect(req?.query.get('fields')).toBe(
      'id,unique_id,leave_date,duration,half_day_type,status,user_id,type{id,type_name}',
    );
    expect(req?.query.get('filters')).toBe(
      'leave_date ge "2025-01-01" and leave_date le "2027-12-31"',
    );
  });

  it('pages until a short page, whatever meta.paging.total says', async () => {
    // A live Clan answered `total: 2` with 25 rows (LAI-1180's log).
    const fake = fakeClan({
      leave: Array.from({ length: 2_500 }, (_, i) => leaveRow(i + 1, 1, '2026-03-02')),
    });
    fake.total = 2;
    expect(await client(fake).leave(CLAN_TOKEN, '2025-01-01', '2027-12-31')).toHaveLength(2_500);
    expect(fake.to('/leave')).toHaveLength(3);

    // And one that overcounts does not send it looking for rows that are not there.
    const over = fakeClan({
      leave: Array.from({ length: 1_500 }, (_, i) => leaveRow(i + 1, 1, '2026-03-02')),
    });
    over.total = 9_000;
    expect(await client(over).leave(CLAN_TOKEN, '2025-01-01', '2027-12-31')).toHaveLength(1_500);
    expect(over.to('/leave')).toHaveLength(2);

    const none = fakeClan({ employees: [employee(1, 'Ada', 'ada@example.test')] });
    none.total = 'absent';
    expect(await client(none).employees(CLAN_TOKEN)).toHaveLength(1);
  });

  it('fails the whole read when a later page fails — it never answers part of a list', async () => {
    const fake = fakeClan({
      leave: Array.from({ length: 1_500 }, (_, i) => leaveRow(i + 1, 1, '2026-03-02')),
    });
    fake.intercept = (req) =>
      req.path === '/leave' && req.query.get('offset') === '1000'
        ? new Response(JSON.stringify({ data: 'not a list' }), { status: 200 })
        : undefined;
    const err = await caught(client(fake).leave(CLAN_TOKEN, '2025-01-01', '2027-12-31'));

    expect(err).toBeInstanceOf(ClanAnswerError);
    expect(reasonOf(err)).toBe('clan_bad_answer');
    expect((err.details as { why: string }).why).toBe('leave: no data list');
  });

  it('reads a half day each way, and anything else as a whole day', async () => {
    const fake = fakeClan({
      leave: [
        leaveRow(1, 1, '2026-03-02', { duration: 'half day', half_day_type: 'first_half' }),
        leaveRow(2, 1, '2026-03-03', { duration: 'half day', half_day_type: 'second_half' }),
        leaveRow(3, 1, '2026-03-04', { duration: 'multiple' }),
        leaveRow(4, 1, '2026-03-05', { duration: 'Half Day', half_day_type: null }),
      ],
    });
    const days = await client(fake).leave(CLAN_TOKEN, '2025-01-01', '2027-12-31');

    expect(days.map((d) => [d.id, d.day, d.part])).toEqual([
      ['1', '2026-03-02', 'first_half'],
      ['2', '2026-03-03', 'second_half'],
      ['3', '2026-03-04', 'full'],
      ['4', '2026-03-05', 'first_half'],
    ]);
    expect(days[0]).toMatchObject({
      status: 'approved',
      personRef: '1',
      typeName: 'Annual',
      applicationRef: 'app-1',
    });
  });

  it('reads holidays defensively — label, day and scope — and keeps the window', async () => {
    const fake = fakeClan({
      holidays: [
        // As a live Clan sends them (LAI-1180's log): JSON strings.
        {
          id: 10,
          date: '2026-09-24T00:00:00.000000Z',
          occassion: 'Heritage Day',
          department_id_json: '[3004,3023]',
          designation_id_json: null,
          employment_type_json: '["full_time"]',
        },
        { id: 11, date: '2026-08-15', occasion: 'Independence Day', department_ids: [4, '5'] },
        { id: 12, date: '2026-12-25', name: 'Christmas', designation_id: 7 },
        { id: 13, date: '2026-01-01', title: 'New Year', department_id_json: '[]' },
        { id: 14, date: '2028-01-01', occassion: 'Outside the window' },
      ],
    });
    const holidays = await client(fake).holidays(CLAN_TOKEN, '2025-01-01', '2027-12-31');

    expect(holidays).toEqual([
      {
        id: '10',
        day: '2026-09-24',
        label: 'Heritage Day',
        departments: ['3004', '3023'],
        designations: [],
        employmentTypes: ['full_time'],
      },
      {
        id: '11',
        day: '2026-08-15',
        label: 'Independence Day',
        departments: ['4', '5'],
        designations: [],
        employmentTypes: [],
      },
      {
        id: '12',
        day: '2026-12-25',
        label: 'Christmas',
        departments: [],
        designations: ['7'],
        employmentTypes: [],
      },
      {
        id: '13',
        day: '2026-01-01',
        label: 'New Year',
        departments: [],
        designations: [],
        employmentTypes: [],
      },
    ]);
    // No filter is sent for holidays: their fields are undocumented.
    expect(fake.to('/holiday')[0]?.query.get('filters')).toBeNull();
  });

  it('calls a row with no id or no date a bad answer, not a row to skip', async () => {
    const fake = fakeClan({ holidays: [{ id: 10, occassion: 'No date' }] });
    const err = await caught(client(fake).holidays(CLAN_TOKEN, '2025-01-01', '2027-12-31'));
    expect(reasonOf(err)).toBe('clan_bad_answer');
    expect((err.details as { why: string }).why).toBe('holiday: no date');

    const noList = fakeClan();
    noList.intercept = () => new Response(JSON.stringify({ data: 'nope' }), { status: 200 });
    expect(reasonOf(await caught(client(noList).employees(CLAN_TOKEN)))).toBe('clan_bad_answer');
  });
});

describe('failures', () => {
  it('retries a 429 once, after the Retry-After it names', async () => {
    const fake = fakeClan({ employees: [employee(1, 'Ada', 'ada@example.test')] });
    let first = true;
    fake.intercept = () => {
      if (!first) return undefined;
      first = false;
      return new Response('{}', { status: 429, headers: { 'retry-after': '2' } });
    };
    const waits: number[] = [];
    const people = await client(fake, waits).employees(CLAN_TOKEN);

    expect(people).toHaveLength(1);
    expect(waits).toEqual([2_000]);
    expect(fake.to('/employee')).toHaveLength(2);
  });

  it('retries only once: a second 429 is unreachable, reached', async () => {
    const fake = fakeClan();
    fake.intercept = () => new Response('{}', { status: 503 });
    const waits: number[] = [];
    const err = await caught(client(fake, waits).employees(CLAN_TOKEN));

    expect(err).toBeInstanceOf(ClanUnavailableError);
    expect((err as ClanUnavailableError).reached).toBe(true);
    expect(reasonOf(err)).toBe('clan_unreachable');
    expect(waits).toEqual([1_000]);
    expect(fake.to('/employee')).toHaveLength(2);
  });

  it('does not wait past 30 seconds for a Retry-After', async () => {
    const fake = fakeClan();
    fake.intercept = () => new Response('{}', { status: 429, headers: { 'retry-after': '31' } });
    const waits: number[] = [];
    const err = await caught(client(fake, waits).employees(CLAN_TOKEN));

    expect(reasonOf(err)).toBe('clan_unreachable');
    expect(waits).toEqual([]);
    expect(fake.to('/employee')).toHaveLength(1);
  });

  it('gives up on a hung Clan at the timeout, as unreachable', async () => {
    const fake = fakeClan();
    fake.intercept = () => 'hang';
    const err = await caught(client(fake, [], 20).employees(CLAN_TOKEN));

    expect(err).toBeInstanceOf(ClanUnavailableError);
    expect((err.details as { why: string }).why).toBe('timed out');
    expect((err as ClanUnavailableError).reached).toBe(true);
  });

  it('says a refused connection never reached Clan', async () => {
    const err = await caught(
      clanClient({
        baseUrl: 'https://elsewhere.clan.biz/api/v1',
        fetchImpl: fakeClan().fetchImpl,
      }).employees(CLAN_TOKEN),
    );
    expect((err.details as { why: string }).why).toBe('could not connect');
    expect((err as ClanUnavailableError).reached).toBe(false);
  });

  it('calls a 401 the token’s refusal, and passes on none of Clan’s words', async () => {
    const fake = fakeClan();
    const err = await caught(client(fake).employees('not-the-token'));

    expect(err).toBeInstanceOf(ClanAuthError);
    expect(reasonOf(err)).toBe('clan_token_refused');
    expect(JSON.stringify(err.toBody())).not.toContain('CLAN-SECRET-WORDS');
  });
});
