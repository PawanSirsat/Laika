import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Member } from '../../../../src/api/tasks.ts';
import { assigneeOptions } from '../../../../src/routes/screens/board/assignee-options.ts';

const member = (user_id: string, name: string, email: string): Member => ({
  user_id,
  name,
  email,
  role: 'member',
  created_at: 1,
});

/** The one list the task panel and the Create task dialog both pick from (LAI-1167). */
void describe('assigneeOptions', () => {
  void test('unassigned is pinned first, then every member in the order given', () => {
    const out = assigneeOptions(
      [member('u2', 'Bea Builder', 'bea@example.com'), member('u1', 'Ada', 'ada@example.com')],
      undefined,
    );
    assert.deepEqual(
      out.map((o) => o.value),
      ['', 'u2', 'u1'],
    );
    assert.equal(out[0]?.pinned, true);
    assert.equal(out[0]?.label, 'unassigned');
  });

  void test('the reader is marked (you), and everyone is searchable by email', () => {
    const out = assigneeOptions(
      new Map([
        ['u1', member('u1', 'Ada', 'ada@example.com')],
        ['u2', member('u2', 'Bea', 'bea@example.com')],
      ]).values(),
      'u1',
    );
    assert.equal(out[1]?.label, 'Ada (you)');
    assert.equal(out[2]?.label, 'Bea');
    assert.equal(out[1]?.keywords, 'ada@example.com');
  });
});
