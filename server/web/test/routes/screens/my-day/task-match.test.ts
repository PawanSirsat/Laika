import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { TaskSummary } from '../../../../src/api/tasks.ts';
import { matchTasks } from '../../../../src/routes/screens/my-day/task-match.ts';

/** The task search's matching (LAI-504): a key prefix first, then a title, eight at most. */

void describe('matchTasks', () => {
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
