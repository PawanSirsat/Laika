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
  CLAN_BASE,
  CLAN_EMAIL,
  CLAN_PASSWORD,
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

describe('signing in', () => {
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

  it('answers the methods when the account has a second factor', async () => {
    const fake = fakeClan({ twoFactorMethods: ['email', 'google_authenticator'] });
    const login = await client(fake).login(CLAN_EMAIL, CLAN_PASSWORD);
    expect(login.twoFactor).toEqual({ methods: ['email', 'google_authenticator'] });
  });

  it('refuses a wrong password as clan_login_failed, without Clan’s words', async () => {
    const fake = fakeClan();
    const err = await caught(client(fake).login(CLAN_EMAIL, 'wrong'));

    expect(err).toBeInstanceOf(ClanLoginError);
    expect(err.status).toBe(422);
    expect(reasonOf(err)).toBe('clan_login_failed');
    expect(JSON.stringify(err.toBody())).not.toContain('CLAN-SECRET-WORDS');
  });

  it('completes the second factor with the token, and refuses a wrong code', async () => {
    const fake = fakeClan({ twoFactorMethods: ['email'], twoFactorCode: '123456' });
    const c = client(fake);

    const wrong = await caught(c.twoFactor(CLAN_TOKEN, 'email', '000000'));
    expect(reasonOf(wrong)).toBe('clan_login_failed');

    expect(await c.twoFactor(CLAN_TOKEN, 'email', '123456')).toEqual({
      token: null,
      expiresAt: null,
    });
    const last = fake.to('/auth/two-factor').at(-1);
    expect(last?.authorization).toBe(`Bearer ${CLAN_TOKEN}`);
    expect(JSON.parse(last?.body ?? '{}')).toEqual({ method: 'email', code: '123456' });
  });

  it('never calls /auth/refresh', async () => {
    const fake = fakeClan({ employees: [employee(1, 'Ada', 'ada@example.test')] });
    const c = client(fake);
    await c.login(CLAN_EMAIL, CLAN_PASSWORD);
    await c.employees(CLAN_TOKEN);
    await c.holidays(CLAN_TOKEN, '2025-01-01', '2027-12-31');
    await c.leave(CLAN_TOKEN, '2025-01-01', '2027-12-31');

    expect(fake.requests.map((r) => r.path)).toEqual([
      '/auth/login',
      '/employee',
      '/holiday',
      '/leave',
    ]);
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
      },
      {
        id: '2',
        name: 'Clan person 2',
        email: null,
        departmentRef: '9',
        designationRef: '7',
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

  it('refuses a list that ends short of the total it named — an incomplete read', async () => {
    const fake = fakeClan({
      leave: Array.from({ length: 1_500 }, (_, i) => leaveRow(i + 1, 1, '2026-03-02')),
    });
    fake.intercept = (req) =>
      req.path === '/leave' && req.query.get('offset') === '1000'
        ? new Response(JSON.stringify({ data: [], meta: { paging: { total: 1_500 } } }), {
            status: 200,
          })
        : undefined;
    const err = await caught(client(fake).leave(CLAN_TOKEN, '2025-01-01', '2027-12-31'));

    expect(err).toBeInstanceOf(ClanAnswerError);
    expect(reasonOf(err)).toBe('clan_bad_answer');
    expect((err.details as { why: string }).why).toBe('leave: ended at 1000 of 1500');
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
        { id: 10, date: '2026-09-24T00:00:00.000000Z', occassion: 'Heritage Day' },
        { id: 11, date: '2026-08-15', occasion: 'Independence Day', department_ids: [4, '5'] },
        { id: 12, date: '2026-12-25', name: 'Christmas', designation_id: 7 },
        { id: 13, date: '2026-01-01', title: 'New Year', departments: '[6]' },
        { id: 14, date: '2028-01-01', occassion: 'Outside the window' },
      ],
    });
    const holidays = await client(fake).holidays(CLAN_TOKEN, '2025-01-01', '2027-12-31');

    expect(holidays).toEqual([
      { id: '10', day: '2026-09-24', label: 'Heritage Day', departments: [], designations: [] },
      {
        id: '11',
        day: '2026-08-15',
        label: 'Independence Day',
        departments: ['4', '5'],
        designations: [],
      },
      { id: '12', day: '2026-12-25', label: 'Christmas', departments: [], designations: ['7'] },
      { id: '13', day: '2026-01-01', label: 'New Year', departments: ['6'], designations: [] },
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
    expect(reasonOf(err)).toBe('clan_token_rejected');
    expect(JSON.stringify(err.toBody())).not.toContain('CLAN-SECRET-WORDS');
  });
});
