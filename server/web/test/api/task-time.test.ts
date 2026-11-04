/**
 * `src/api/task-time.ts` — the confirmed time on a task (LAI-1122): the line
 * the Estimate card draws, and the client type against the server's.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { timeLoggedLine, type TaskTime } from '../../src/api/task-time.ts';
import { fieldsOf } from '../helpers/interfaces.ts';

const view = (patch: Partial<TaskTime>): TaskTime => ({
  total_minutes: 130,
  people: 2,
  entries: 3,
  ...patch,
});

void describe('timeLoggedLine', () => {
  void test('says the total and how many people, in hours and minutes', () => {
    assert.equal(timeLoggedLine(view({})), '2 h 10 min by 2 people');
    assert.equal(timeLoggedLine(view({ total_minutes: 45, people: 1 })), '45 min by 1 person');
    assert.equal(timeLoggedLine(view({ total_minutes: 120 })), '2 h by 2 people');
  });

  void test('keeps hours past a day: a task’s time is working time, not calendar days', () => {
    assert.equal(timeLoggedLine(view({ total_minutes: 30 * 60 })), '30 h by 2 people');
  });

  void test('is nothing for no time, never 0 min', () => {
    assert.equal(timeLoggedLine(view({ total_minutes: 0, people: 0, entries: 0 })), null);
  });
});

void describe('TaskTime against the server’s TaskTimeView', () => {
  void test('declares the same fields, and no name of a person', async () => {
    const server = await readFile(
      fileURLToPath(new URL('../../../src/services/task-time.ts', import.meta.url)),
      'utf8',
    );
    const client = await readFile(
      fileURLToPath(new URL('../../src/api/task-time.ts', import.meta.url)),
      'utf8',
    );
    const served = fieldsOf(server, 'TaskTimeView');
    const declared = fieldsOf(client, 'TaskTime');
    assert.ok(served !== undefined && served.length > 0, 'TaskTimeView not found');
    assert.deepEqual([...(declared ?? [])].sort(), [...served].sort());
  });
});
