/**
 * `src/api/calendar.ts` — the Outlook calendar connection (D-157, LAI-1316):
 * each call's method, path and body, a refusal in words, and a failed sync in
 * words.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError, NetworkError } from '../../src/api/errors.ts';
import {
  CALENDAR_REFUSAL_WORDS,
  calendarRefusal,
  calendarSyncErrorWords,
  disconnectCalendarSource,
  getCalendarSource,
  refusedField,
  saveCalendarSource,
  syncCalendarSource,
  testCalendarSource,
  type CalendarSyncErrorCode,
} from '../../src/api/calendar.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  const empty = init?.method === 'DELETE';
  return Promise.resolve(
    new Response(empty ? null : '{"configured":false,"enabled":false,"rules":[]}', {
      status: empty ? 204 : 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as unknown as typeof fetch;

void describe('the calls (§6.4, LAI-1316)', () => {
  void test('each path written out whole, with its method and body', async () => {
    sent.length = 0;
    await getCalendarSource();
    await saveCalendarSource({
      tenant_id: '5abd4f6b-f235-4d86-a90c-08f2e5f56fbb',
      client_id: 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd',
      client_secret: 'fixture-secret-never-real',
      enabled: false,
      rules: [{ kind: 'title', text: 'standup', project: 'laika' }],
    });
    // The secret left out keeps the stored one.
    await saveCalendarSource({
      tenant_id: 'contoso.onmicrosoft.com',
      client_id: 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd',
      enabled: true,
      rules: [],
    });
    await testCalendarSource();
    await syncCalendarSource();
    await disconnectCalendarSource();
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/org/calendar', undefined],
        [
          'PUT',
          '/api/v1/org/calendar',
          {
            tenant_id: '5abd4f6b-f235-4d86-a90c-08f2e5f56fbb',
            client_id: 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd',
            client_secret: 'fixture-secret-never-real',
            enabled: false,
            rules: [{ kind: 'title', text: 'standup', project: 'laika' }],
          },
        ],
        [
          'PUT',
          '/api/v1/org/calendar',
          {
            tenant_id: 'contoso.onmicrosoft.com',
            client_id: 'ae9ce6ed-ef7a-45ff-9a05-6db164d947bd',
            enabled: true,
            rules: [],
          },
        ],
        ['POST', '/api/v1/org/calendar/test', undefined],
        ['POST', '/api/v1/org/calendar/sync', undefined],
        ['DELETE', '/api/v1/org/calendar', undefined],
      ],
    );
  });
});

void describe('a refusal, in words', () => {
  const refused = (
    status: number,
    code: 'unprocessable' | 'conflict' | 'internal',
    details?: Record<string, unknown>,
  ) => new ApiError(code, 'The server’s own sentence.', status, details ?? null);

  void test('each reason the contract names has its own words', () => {
    const reasons = [
      'tenant_invalid',
      'client_invalid',
      'secret_required',
      'unknown_project',
      'calendar_not_configured',
      'graph_credentials_refused',
      'graph_unreachable',
      'calendar_off',
    ];
    // Both sides of the list, so a reason added to one and not the other fails here.
    assert.deepEqual(Object.keys(CALENDAR_REFUSAL_WORDS).sort(), [...reasons].sort());
    for (const reason of reasons) {
      const words = calendarRefusal(refused(422, 'unprocessable', { reason }));
      assert.notEqual(words, 'The server’s own sentence.', reason);
    }
    assert.match(
      calendarRefusal(refused(422, 'unprocessable', { reason: 'graph_credentials_refused' })),
      /Microsoft refused that tenant, client ID or secret/,
    );
    assert.match(
      calendarRefusal(refused(503, 'internal', { reason: 'graph_unreachable' })),
      /could not reach Microsoft/,
    );
    assert.match(calendarRefusal(refused(409, 'conflict', { reason: 'calendar_off' })), /switch/);
  });

  void test('a reason it does not know, or none, is the server’s message', () => {
    assert.equal(
      calendarRefusal(refused(422, 'unprocessable', { reason: 'something_new' })),
      'The server’s own sentence.',
    );
    assert.equal(calendarRefusal(refused(422, 'unprocessable')), 'The server’s own sentence.');
  });

  void test('a rate limit says to wait; no answer at all says it never arrived', () => {
    assert.match(
      calendarRefusal(new ApiError('rate_limited', 'Too Many Requests', 429)),
      /Wait a moment/,
    );
    assert.equal(
      calendarRefusal(new NetworkError(new Error('offline'))),
      'The request did not reach Laika.',
    );
  });

  void test('refusedField names the field a refusal named, and nothing else', () => {
    assert.equal(
      refusedField(refused(422, 'unprocessable', { field: 'tenant_id', reason: 'tenant_invalid' })),
      'tenant_id',
    );
    assert.equal(
      refusedField(refused(422, 'unprocessable', { field: 'rules', reason: 'unknown_project' })),
      'rules',
    );
    assert.equal(refusedField(refused(409, 'conflict', { reason: 'calendar_off' })), undefined);
    assert.equal(refusedField(new Error('x')), undefined);
  });
});

void describe('a failed sync, in words', () => {
  void test('the four codes the sync records, and anything else as sent', () => {
    const codes: CalendarSyncErrorCode[] = [
      'credentials_rejected',
      'not_granted',
      'unreachable',
      'bad_answer',
    ];
    for (const code of codes) {
      assert.notEqual(calendarSyncErrorWords({ code, message: 'x' }), 'x', code);
    }
    assert.match(
      calendarSyncErrorWords({ code: 'not_granted', message: 'x' }),
      /not granted Calendars\.Read/,
    );
    assert.equal(
      calendarSyncErrorWords({
        code: 'new_code' as CalendarSyncErrorCode,
        message: 'As the server said.',
      }),
      'As the server said.',
    );
  });
});
