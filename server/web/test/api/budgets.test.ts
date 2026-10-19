/**
 * `src/api/budgets.ts` — soft token budgets and the runaway banner's words
 * (LAI-773, SPEC §6.4). Each call goes to the path and method §6.4 names, and
 * a budget is said the way the page says it: spent of budget, the share, and
 * where the figure came from.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  budgetBadge,
  budgetLine,
  budgetSource,
  estimateAlertLine,
  getProjectBudgets,
  parseTokens,
  runawayLine,
  setProjectBudget,
  setSprintBudget,
  setTaskBudget,
} from '../../src/api/budgets.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(answer: unknown): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return sent;
}

void describe('the calls (§6.4)', () => {
  void test('reads a project’s budgets, and sets each kind with PUT {tokens}', async () => {
    const sent = stub({ budget: null });
    await getProjectBudgets('lai core');
    await setProjectBudget('laika', 4_000_000);
    await setSprintBudget('s 1', null);
    await setTaskBudget('t1', 2_500_000);
    assert.deepEqual(
      sent.map((s) => [s.method, s.url, s.body]),
      [
        ['GET', '/api/v1/projects/lai%20core/budgets', undefined],
        ['PUT', '/api/v1/projects/laika/budget', { tokens: 4_000_000 }],
        ['PUT', '/api/v1/sprints/s%201/budget', { tokens: null }],
        ['PUT', '/api/v1/tasks/t1/budget', { tokens: 2_500_000 }],
      ],
    );
  });
});

void describe('how a budget is said', () => {
  void test('a badge only from 80%: none under it, then the threshold it reached', () => {
    assert.equal(budgetBadge({ state: 'under' }), null);
    assert.equal(budgetBadge({ state: 'warn' }), '80%');
    assert.equal(budgetBadge({ state: 'over' }), '100%');
  });

  void test('spent of budget and the share — past 100% when it is', () => {
    assert.equal(
      budgetLine({ used: 1_200_000, tokens: 2_500_000, share: 0.48 }),
      '1.2M of 2.5M · 48%',
    );
    assert.equal(budgetLine({ used: 5_000, tokens: 2_500, share: 2 }), '5K of 2.5K · 200%');
  });

  void test('where the figure came from', () => {
    assert.equal(
      budgetSource({ scope: 'task', source: 'forecast', period: null }),
      // Plain words since LAI-785: the high end of the token estimate, not "p80".
      'the token estimate’s high end, frozen at claim',
    );
    assert.equal(budgetSource({ scope: 'task', source: 'set', period: null }), 'set by a lead');
    assert.equal(
      budgetSource({
        scope: 'project',
        source: 'set',
        period: { from: '2026-10-01', to: '2026-10-31' },
      }),
      'this month · 2026-10-01 – 2026-10-31',
    );
  });

  void test('reads a budget as a person types one', () => {
    assert.equal(parseTokens('2500000'), 2_500_000);
    assert.equal(parseTokens('2,500,000'), 2_500_000);
    assert.equal(parseTokens('2.5M'), 2_500_000);
    assert.equal(parseTokens('800k'), 800_000);
    assert.equal(parseTokens(' 1b '), 1_000_000_000);
    for (const bad of ['', '0', '-5', 'lots', '1.5x', '2e9']) {
      assert.equal(parseTokens(bad), undefined, bad);
    }
  });
});

void describe('a task’s default budget, in the task panel (LAI-785 review)', () => {
  const frozen = (used: number, tokens: number, state: 'under' | 'warn' | 'over') => ({
    source: 'forecast' as const,
    used,
    tokens,
    share: used / tokens,
    state,
  });

  void test('says nothing under 80%: the estimate is not a budget anybody set', () => {
    assert.equal(estimateAlertLine(frozen(1_000_000, 2_500_000, 'under')), null);
  });

  void test('from 80%, one line: how much of the token estimate is used', () => {
    assert.equal(
      estimateAlertLine(frozen(2_100_000, 2_500_000, 'warn')),
      'Over 80% of its token estimate: 2.1M of 2.5M (84%).',
    );
    assert.equal(
      estimateAlertLine(frozen(4_006_700, 2_500_000, 'over')),
      'Past its token estimate: 4.01M of 2.5M (160%).',
    );
  });

  void test('a budget a lead set is the bar, never this line', () => {
    assert.equal(
      estimateAlertLine({ ...frozen(4_006_700, 2_500_000, 'over'), source: 'set' }),
      null,
    );
  });
});

void describe('the runaway banner (LAI-773)', () => {
  void test('says what was spent, against the p95, and how long nothing landed — to its person', () => {
    const now = Date.UTC(2026, 9, 17, 12);
    const line = runawayLine(
      {
        alert_id: 'a',
        tokens: 7_000_000,
        p95: 5_994_000,
        since: now - 600_000,
        last_progress_at: now - 70 * 60_000,
      },
      now,
    );
    assert.equal(
      line,
      'Your agent has spent 7M on this task, past its p95 of 5.99M, and nothing has landed for 70 min — no commit pushed and no new session on it.',
    );
  });
});
