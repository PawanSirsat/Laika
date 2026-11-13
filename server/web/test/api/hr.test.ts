/**
 * `src/api/hr.ts` — the HR connection and the holidays (D-149, LAI-1182):
 * each call's method, path and body, and a refusal in words.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, NetworkError } from '../../src/api/errors.ts';
import {
  addHoliday,
  connectHr,
  disconnectHr,
  getHrSource,
  hrRefusal,
  listHolidays,
  mapHrPeople,
  refusedFor,
  removeHoliday,
  syncErrorWords,
  syncHr,
  verifyHr,
} from '../../src/api/hr.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  const empty = init?.method === 'DELETE';
  return Promise.resolve(
    new Response(empty ? null : '{"status":"off","people":[],"holidays":[]}', {
      status: empty ? 204 : 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

void describe('the calls (§6.4, LAI-1181)', () => {
  void test('each path written out whole, with its method and body', async () => {
    sent.length = 0;
    await getHrSource();
    await connectHr({
      base_url: 'https://codesage.clan.biz',
      email: 'forge@codesage.test',
      password: 'pw-1',
    });
    await connectHr({
      base_url: 'https://codesage.clan.biz',
      token: '1|t',
      expires_on: '2027-06-30',
    });
    await connectHr({ base_url: 'https://codesage.clan.biz', token: '1|t' });
    await verifyHr({ method: 'email', code: '123456' });
    await syncHr();
    await mapHrPeople([
      { external_id: '7', user_id: 'u2' },
      { external_id: '9', user_id: null },
    ]);
    await disconnectHr();
    await listHolidays('2026-01-01', '2027-12-31');
    await addHoliday({ day: '2026-09-24', label: 'Heritage Day' });
    await removeHoliday('h 1');
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/org/hr', undefined],
        [
          'POST',
          '/api/v1/org/hr/connect',
          { base_url: 'https://codesage.clan.biz', email: 'forge@codesage.test', password: 'pw-1' },
        ],
        [
          'POST',
          '/api/v1/org/hr/connect',
          { base_url: 'https://codesage.clan.biz', token: '1|t', expires_on: '2027-06-30' },
        ],
        ['POST', '/api/v1/org/hr/connect', { base_url: 'https://codesage.clan.biz', token: '1|t' }],
        ['POST', '/api/v1/org/hr/connect/verify', { method: 'email', code: '123456' }],
        ['POST', '/api/v1/org/hr/sync', undefined],
        [
          'PUT',
          '/api/v1/org/hr/people',
          {
            people: [
              { external_id: '7', user_id: 'u2' },
              { external_id: '9', user_id: null },
            ],
          },
        ],
        ['DELETE', '/api/v1/org/hr', undefined],
        ['GET', '/api/v1/org/holidays?from=2026-01-01&to=2027-12-31', undefined],
        ['POST', '/api/v1/org/holidays', { day: '2026-09-24', label: 'Heritage Day' }],
        ['DELETE', '/api/v1/org/holidays/h%201', undefined],
      ],
    );
  });
});

void describe('a refusal, in words', () => {
  const refused = (
    status: number,
    code: 'unprocessable' | 'conflict' | 'internal',
    reason?: string,
  ) =>
    new ApiError(
      code,
      'The server’s own sentence.',
      status,
      reason === undefined ? null : { reason },
    );

  void test('each reason the endpoints name has its own words', () => {
    assert.equal(
      hrRefusal(refused(422, 'unprocessable', 'clan_login_failed')),
      'Clan did not accept that email and password.',
    );
    assert.match(hrRefusal(refused(502, 'internal', 'clan_unreachable')), /could not reach Clan/);
    assert.match(hrRefusal(refused(409, 'conflict', 'two_factor_expired')), /code expired/);
    assert.match(hrRefusal(refused(409, 'conflict', 'hr_not_connected')), /not connected/);
    assert.match(hrRefusal(refused(409, 'conflict', 'holiday_exists')), /already a holiday/);
    assert.match(hrRefusal(refused(409, 'conflict', 'holiday_from_clan')), /comes from Clan/);
    assert.match(
      hrRefusal(refused(422, 'unprocessable', 'duplicate_user')),
      /Pick each member once/,
    );
    assert.match(hrRefusal(refused(422, 'unprocessable', 'unknown_person')), /no longer lists/);
    assert.match(hrRefusal(refused(422, 'unprocessable', 'unknown_user')), /no longer active/);
    assert.match(
      hrRefusal(refused(409, 'conflict', 'user_mapped_elsewhere')),
      /already picked for another Clan person/,
    );
    assert.match(hrRefusal(refused(422, 'unprocessable', 'base_url_not_https')), /https:\/\//);
    assert.match(hrRefusal(refused(422, 'unprocessable', 'base_url_invalid')), /not a company/);
    assert.match(hrRefusal(refused(503, 'internal', 'clan_bad_answer')), /could not read/);
    assert.match(
      hrRefusal(refused(422, 'unprocessable', 'clan_token_refused')),
      /^Clan refused this token — check it was copied whole/,
    );
  });

  void test('a reason it does not know, or none, is the server’s message', () => {
    assert.equal(
      hrRefusal(refused(422, 'unprocessable', 'something_new')),
      'The server’s own sentence.',
    );
    assert.equal(hrRefusal(refused(422, 'unprocessable')), 'The server’s own sentence.');
  });

  void test('a rate limit says to wait; no answer at all says it never arrived', () => {
    assert.match(
      hrRefusal(new ApiError('rate_limited', 'Too Many Requests', 429)),
      /Wait a moment/,
    );
    assert.equal(
      hrRefusal(new NetworkError(new Error('offline'))),
      'The request did not reach Laika.',
    );
  });

  void test('refusedFor names one reason and nothing else', () => {
    assert.equal(
      refusedFor(refused(409, 'conflict', 'two_factor_expired'), 'two_factor_expired'),
      true,
    );
    assert.equal(
      refusedFor(refused(409, 'conflict', 'hr_not_connected'), 'two_factor_expired'),
      false,
    );
    assert.equal(refusedFor(refused(409, 'conflict'), 'two_factor_expired'), false);
    assert.equal(refusedFor(new Error('x'), 'two_factor_expired'), false);
  });
});

void describe('a failed sync, in words', () => {
  void test('the three codes the sync records, and anything else as sent', () => {
    assert.equal(
      syncErrorWords({ code: 'token_rejected', message: 'x' }),
      'Clan refused the token — connect again',
    );
    assert.equal(
      syncErrorWords({ code: 'unreachable', message: 'x' }),
      'Laika could not reach Clan',
    );
    assert.match(syncErrorWords({ code: 'bad_answer', message: 'x' }), /could not read/);
    assert.equal(
      syncErrorWords({ code: 'new_code', message: 'As the server said.' }),
      'As the server said.',
    );
  });
});
