/**
 * `src/api/plan-limit.ts` — the developer's own plan limit (LAI-773, D-087):
 * their limit, their rate, and when they reach it — always an estimate, and
 * never a vendor's token figure, because no vendor states one.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import {
  clearPlanLimit,
  clockLabel,
  forecastLine,
  getPlanLimit,
  minuteLabel,
  parseMinute,
  planFact,
  PLAN_KINDS,
  PLAN_WINDOWS,
  setPlanLimit,
  usedLine,
  type PlanLimit,
} from '../../src/api/plan-limit.ts';

const sent: { url: string; method: string; body: unknown }[] = [];
globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
  sent.push({
    url: input instanceof URL ? input.href : input,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  });
  return Promise.resolve(
    init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}) as unknown as typeof fetch;

const NOW = new Date(2026, 9, 17, 12, 0).getTime();
const view = (over: Partial<PlanLimit>): PlanLimit => ({
  plan: 'claude-max-5x',
  window: '5h',
  limit_tokens: 1_000_000,
  week_reset: null,
  tz: 'UTC',
  used: 400_000,
  rate_per_hour: 200_000,
  window_start: NOW - 5 * 3_600_000,
  window_end: null,
  reaches_limit_at: null,
  reached: false,
  estimate: true,
  ...over,
});

void describe('the calls — the caller’s own, and nothing names anybody else', () => {
  void test('GET, PUT and DELETE /me/plan-limit', async () => {
    await getPlanLimit();
    await setPlanLimit({
      plan: 'other',
      window: 'week',
      limit_tokens: 9,
      tz: 'UTC',
      week_reset: { weekday: 1, minute: 540 },
    });
    await clearPlanLimit();
    assert.deepEqual(
      sent.map((s) => [s.method, s.url]),
      [
        ['GET', '/api/v1/me/plan-limit'],
        ['PUT', '/api/v1/me/plan-limit'],
        ['DELETE', '/api/v1/me/plan-limit'],
      ],
    );
    assert.deepEqual(sent[1]?.body, {
      plan: 'other',
      window: 'week',
      limit_tokens: 9,
      tz: 'UTC',
      week_reset: { weekday: 1, minute: 540 },
    });
  });

  void test('offers exactly the plans and windows the server takes', async () => {
    const enums = await readFile(new URL('../../../src/db/enums.ts', import.meta.url), 'utf8');
    const list = (name: string) =>
      [
        ...(new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(enums)?.[1] ?? '').matchAll(/'([^']+)'/g),
      ].map((m) => m[1]);
    assert.deepEqual([...PLAN_KINDS], list('PLAN_KINDS'));
    assert.deepEqual([...PLAN_WINDOWS], list('PLAN_WINDOWS'));
  });
});

void describe('what a plan is said to be', () => {
  void test('never a token figure: the vendor states sessions and weeks, not tokens', () => {
    for (const plan of PLAN_KINDS) {
      const fact = planFact(plan);
      assert.doesNotMatch(fact, /\d[\d,.]*\s*(k|m|b)?\s*tokens/i, plan);
    }
    assert.match(planFact('claude-max-20x'), /Twenty times Pro’s per-session usage/);
  });
});

void describe('the forecast, always an estimate', () => {
  void test('a time when there is one, in the reader’s clock', () => {
    assert.equal(
      forecastLine(view({ reaches_limit_at: NOW + 3 * 3_600_000 }), NOW),
      'At this rate you reach your limit around 15:00.',
    );
    assert.match(clockLabel(NOW + 30 * 3_600_000, NOW), /^[A-Z][a-z]{2} 18:00$/);
  });

  void test('reached, no rate, or not before the reset — each said', () => {
    assert.match(forecastLine(view({ reached: true }), NOW), /reached the limit/);
    assert.match(forecastLine(view({ rate_per_hour: 0 }), NOW), /Nothing arrived in the last hour/);
    assert.match(forecastLine(view({}), NOW), /before the window resets/);
    assert.match(forecastLine(view({ limit_tokens: null }), NOW), /Set your limit/);
  });

  void test('what it was made from', () => {
    assert.equal(usedLine(view({})), '400K of 1M used · 200K an hour');
  });

  void test('a reset time, written and read', () => {
    assert.equal(minuteLabel(540), '09:00');
    assert.equal(parseMinute('09:30'), 570);
    assert.equal(parseMinute('24:00'), undefined);
    assert.equal(parseMinute('nine'), undefined);
  });
});
