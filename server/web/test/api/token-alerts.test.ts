/**
 * `src/api/token-alerts.ts` — a person's own token alerts (LAI-773): budgets
 * crossed on work they hold or lead, and the runaway alert, in words.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  alertHref,
  alertLine,
  dismissTokenAlert,
  getTokenAlerts,
  type TokenAlert,
} from '../../src/api/token-alerts.ts';

function stub(status: number, answer: unknown): { url: string; method: string }[] {
  const sent: { url: string; method: string }[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({ url: input instanceof URL ? input.href : input, method: init?.method ?? 'GET' });
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(answer), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

const base: TokenAlert = {
  id: 'a1',
  kind: 'budget',
  scope: 'task',
  threshold: 80,
  tokens: 2_100_000,
  limit_tokens: 2_500_000,
  created_at: 1,
  project: { slug: 'laika', name: 'Laika' },
  task: { id: 't1', key: 'LAI-42', title: 'Build it' },
  sprint: null,
};

void describe('the calls', () => {
  void test('GET /me/token-alerts, and POST …/:id/dismiss answering 204', async () => {
    const sent = stub(200, { alerts: [base] });
    const answer = await getTokenAlerts();
    assert.equal(answer.alerts.length, 1);
    const put = stub(204, null);
    await dismissTokenAlert('a 1');
    assert.deepEqual(sent, [{ url: '/api/v1/me/token-alerts', method: 'GET' }]);
    assert.deepEqual(put, [{ url: '/api/v1/me/token-alerts/a%201/dismiss', method: 'POST' }]);
  });
});

void describe('an alert in words', () => {
  void test('a task’s budget, a sprint’s and a project’s month', () => {
    assert.equal(alertLine(base), 'LAI-42 reached 80% of its budget — 2.1M of 2.5M.');
    assert.equal(
      alertLine({
        ...base,
        scope: 'sprint',
        threshold: 100,
        task: null,
        sprint: { id: 's', name: 'S1' },
      }),
      'S1 in Laika reached 100% of its budget — 2.1M of 2.5M.',
    );
    assert.equal(
      alertLine({ ...base, scope: 'project', task: null }),
      'Laika this month reached 80% of its budget — 2.1M of 2.5M.',
    );
  });

  void test('a runaway, as protecting the person’s quota — never a report on them', () => {
    const line = alertLine({
      ...base,
      kind: 'runaway',
      threshold: 95,
      tokens: 7e6,
      limit_tokens: 5_994_000,
    });
    assert.equal(
      line,
      'LAI-42: your agent passed the task’s p95 of 5.99M at 7M with nothing landed for an hour.',
    );
  });

  void test('links to the task it is about, else to Usage', () => {
    assert.equal(alertHref(base), '/board?project=laika&task=t1');
    assert.equal(alertHref({ ...base, task: null }), '/usage');
  });
});
