/**
 * `src/api/usage.ts` — token usage, read back (D-084, SPEC §6.4, LAI-769).
 *
 * Each read goes to the path §6.4 names with the query the server takes, and
 * the figures are said the way the page says them: compact, a floor, and a
 * share that never claims a precision it does not have.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  agentsNote,
  countedNote,
  compactTokens,
  getPersonUsage,
  getTaskUsage,
  getUsage,
  mayReadOrgUsage,
  mayReadPeopleUsage,
  roundLabel,
  shareOf,
  type TaskUsage,
  USAGE_RANGES,
} from '../../src/api/usage.ts';

function stub(answer: unknown): string[] {
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL) => {
    urls.push(input instanceof URL ? input.href : input);
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return urls;
}

void describe('the reads (§6.4)', () => {
  void test('the organisation: GET /usage with the range and the reader’s zone', async () => {
    const urls = stub({});
    await getUsage({ days: 30, tz: 'Africa/Johannesburg' });
    const url = new URL(urls[0] ?? '', 'http://x');
    assert.equal(url.pathname, '/api/v1/usage');
    assert.equal(url.searchParams.get('days'), '30');
    assert.equal(url.searchParams.get('tz'), 'Africa/Johannesburg');
    assert.equal(url.searchParams.has('project'), false);
  });

  void test('a space: the same, with ?project=', async () => {
    const urls = stub({});
    await getUsage({ days: 7, tz: 'UTC', project: 'laika' });
    assert.equal(new URL(urls[0] ?? '', 'http://x').searchParams.get('project'), 'laika');
  });

  void test('a person: GET /users/:id/usage', async () => {
    const urls = stub({});
    await getPersonUsage('u 2');
    assert.ok((urls[0] ?? '').endsWith('/api/v1/users/u%202/usage'), urls[0]);
  });

  void test('the ranges the page offers are ones the server serves (1–92 days)', () => {
    assert.deepEqual(
      USAGE_RANGES.map((r) => r.days),
      [7, 30, 90],
    );
  });
});

void describe('who sees what (D-084 item 7), mirrored from §3.1', () => {
  void test('the organisation and people: owners and admins', () => {
    for (const role of ['owner', 'admin']) {
      assert.equal(mayReadOrgUsage(role), true);
      assert.equal(mayReadPeopleUsage(role), true);
    }
    for (const role of ['member', 'viewer', undefined]) {
      assert.equal(mayReadOrgUsage(role), false);
      assert.equal(mayReadPeopleUsage(role), false);
    }
  });
});

void describe('how a figure is said', () => {
  void test('compact, to three significant figures', () => {
    assert.deepEqual([0, 950, 12_400, 1_234_567, 254_973_258, 16_346_307_361].map(compactTokens), [
      '0',
      '950',
      '12.4K',
      '1.23M',
      '255M',
      '16.3B',
    ]);
  });

  void test('a share: a dash for nothing of nothing, and “<1%” rather than a false 0%', () => {
    assert.equal(shareOf(0, 0), '—');
    assert.equal(shareOf(0, 100), '0%');
    assert.equal(shareOf(1, 1_000), '<1%');
    assert.equal(shareOf(9, 666), '1%');
    assert.equal(shareOf(100, 100), '100%');
  });
});

void describe('a task’s tokens (LAI-770)', () => {
  const view = (extra: Partial<TaskUsage> = {}): TaskUsage => ({
    task_id: 't1',
    key: 'LAI-7',
    tz: 'UTC',
    first_day: '2026-10-12',
    last_day: '2026-10-16',
    totals: { tokens: 666, input: 111, output: 222, cache_write: 333, cache_read: 1_054 },
    people: 'everyone',
    by_person: [],
    by_round: [],
    attributed: { tokens: 666, of: 706 },
    ...extra,
  });

  void test('GET /tasks/:id/usage, in the reader’s zone', async () => {
    const urls = stub({});
    await getTaskUsage('t 1', 'Asia/Kolkata');
    const url = new URL(urls[0] ?? '', 'http://x');
    assert.equal(url.pathname, '/api/v1/tasks/t%201/usage');
    assert.equal(url.searchParams.get('tz'), 'Asia/Kolkata');
  });

  void test('a round is named by its number and the day it was handed in, or as open', () => {
    assert.equal(
      roundLabel({ number: 1, finished_on: '2026-10-14' }),
      'Round 1 · handed in 14 Oct',
    );
    assert.equal(roundLabel({ number: 3, finished_on: null }), 'Round 3 · open');
  });

  void test('the note says how tokens reach the task, and whose other work is outside it', () => {
    assert.equal(
      countedNote(view()),
      'Tied when an agent marked this task or worked on a branch named LAI-7-…; the rest of its people’s work those days counts for no task.',
    );
    assert.equal(
      countedNote(view({ people: 'own', attributed: { tokens: 66, of: 106 } })),
      'Tied when an agent marked this task or worked on a branch named LAI-7-…; the rest of your work those days counts for no task.',
    );
    for (const people of ['own', 'none'] as const) {
      assert.equal(
        countedNote(view({ people, attributed: null })),
        'Counted only where an agent marked this task or worked on a branch named LAI-7-…; the rest of their work is not in it.',
      );
    }
  });

  void test('a person’s agents, most first, compact', () => {
    assert.equal(
      agentsNote({
        user_id: 'u',
        name: 'Bea',
        tokens: 1_240_000,
        cache_read: 0,
        by_agent: [
          { agent: 'claude-code', tokens: 1_200_000, cache_read: 0 },
          { agent: 'codex', tokens: 40_000, cache_read: 0 },
        ],
      }),
      'Claude Code 1.2M · Codex 40K',
    );
  });
});
