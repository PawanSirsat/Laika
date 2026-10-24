import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clockMinute,
  lengthMinutes,
  whenFrom,
} from '../../../../src/routes/screens/my-day/when-parse.ts';
import { PRESETS } from '../../../../src/routes/screens/my-day/presets.ts';
import { ENTRY_KINDS } from '../../../../src/api/time.ts';
import { matchTasks } from '../../../../src/routes/screens/my-day/task-match.ts';
import type { TaskSummary } from '../../../../src/api/tasks.ts';

/** The WHEN fields' maths (LAI-504), the presets' kinds, the task search's matching. */

void describe('clockMinute', () => {
  void test('reads 14:15 and 2:15pm; a bare 2:15 lands on the side of noon nearest the block', () => {
    assert.equal(clockMinute('14:15', 0), 14 * 60 + 15);
    assert.equal(clockMinute('2:15pm', 0), 14 * 60 + 15);
    assert.equal(clockMinute('2:15 PM', 0), 14 * 60 + 15);
    assert.equal(clockMinute('2:15', 13 * 60), 14 * 60 + 15);
    assert.equal(clockMinute('2:15', 3 * 60), 2 * 60 + 15);
    assert.equal(clockMinute('soon', 0), undefined);
  });
});

void describe('lengthMinutes and whenFrom', () => {
  void test('45, 45m, 1h 15 and 1:15 read; a change keeps the other end; refusals are named', () => {
    assert.equal(lengthMinutes('45'), 45);
    assert.equal(lengthMinutes('45m'), 45);
    assert.equal(lengthMinutes('1h 15'), 75);
    assert.equal(lengthMinutes('1:15'), 75);
    const limits = { lo: 9 * 60, hi: 17 * 60 };
    const now = { start: 10 * 60, end: 11 * 60 };
    assert.deepEqual(whenFrom(now, { start: 10 * 60 + 30 }, limits), {
      span: { start: 10 * 60 + 30, end: 11 * 60 },
    });
    assert.deepEqual(whenFrom(now, { end: 12 * 60 }, limits), {
      span: { start: 10 * 60, end: 12 * 60 },
    });
    assert.deepEqual(whenFrom(now, { length: 90 }, limits), {
      span: { start: 10 * 60, end: 11 * 60 + 30 },
    });
    assert.deepEqual(whenFrom(now, { end: 10 * 60 + 2 }, limits), { refused: 'short' });
    assert.deepEqual(whenFrom(now, { length: 15 * 60 }, limits), { refused: 'midnight' });
    assert.deepEqual(whenFrom(now, { start: 8 * 60 }, limits), { refused: 'before' });
    assert.deepEqual(whenFrom(now, { end: 18 * 60 }, limits), { refused: 'after' });
  });
});

void describe('the presets and the search', () => {
  void test('every preset names one of the eight kinds', () => {
    for (const preset of PRESETS)
      assert.ok((ENTRY_KINDS as readonly string[]).includes(preset.kind));
  });

  void test('a key prefix wins over a title match; eight at most; nothing for nothing', () => {
    const task = (key: string, title: string): TaskSummary =>
      ({ id: key, key, title, project_id: 'p', number: 1 }) as TaskSummary;
    const all = [
      task('LAI-1', 'Search matches keys'),
      task('LAI-12', 'Twelve'),
      task('SEC-9', 'Keys for lai'),
      ...Array.from({ length: 10 }, (_, i) => task(`LAI-2${String(i)}`, 'Filler')),
    ];
    assert.deepEqual(
      matchTasks(all, 'lai-1').map((t) => t.key),
      ['LAI-1', 'LAI-12'],
    );
    assert.deepEqual(
      matchTasks(all, 'keys').map((t) => t.key),
      ['LAI-1', 'SEC-9'],
    );
    assert.equal(matchTasks(all, 'lai').length, 8);
    assert.deepEqual(matchTasks(all, '  '), []);
  });
});
