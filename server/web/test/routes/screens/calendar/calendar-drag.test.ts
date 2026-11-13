import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { TaskSummary } from '../../../../src/api/tasks.ts';
import { DRAG_TYPE, moveDue } from '../../../../src/routes/screens/calendar/calendar-drag.ts';

/**
 * Moving a task to another day (LAI-1178): one `PATCH /tasks/:id` carrying
 * only `due_on`, nothing sent for a drop on the day it already has, and a
 * refusal handed back in the server's own words for the page to say.
 */

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function stub(status: number, answer: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

const task = { id: 't1', key: 'LC-1', due_on: Date.UTC(2026, 10, 12) } as unknown as TaskSummary;

void describe('moveDue', () => {
  void test('a drop on the day it already has sends nothing', async () => {
    const calls = stub(200, {});
    assert.equal(await moveDue('core', task, Date.UTC(2026, 10, 12)), undefined);
    assert.equal(calls.length, 0);
  });

  void test('one PATCH with the new date only', async () => {
    const to = Date.UTC(2026, 10, 14);
    const calls = stub(200, { ...task, due_on: to });
    assert.equal(await moveDue('core', task, to), undefined);
    assert.deepEqual(calls, [{ url: '/api/v1/tasks/t1', method: 'PATCH', body: { due_on: to } }]);
  });

  void test('a refusal comes back in the server’s words', async () => {
    stub(403, { error: { code: 'forbidden', message: 'You may not edit tasks here.' } });
    assert.equal(
      await moveDue('core', task, Date.UTC(2026, 10, 20)),
      'You may not edit tasks here.',
    );
  });

  void test('a drag says what it carries', () => {
    assert.equal(DRAG_TYPE, 'application/x-laika-task');
  });
});
