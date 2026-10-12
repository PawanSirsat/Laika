import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { statusOptions } from '../../../../src/routes/screens/board/status-options.ts';
import type { ProjectStatus } from '../../../../src/api/statuses.ts';

/**
 * Every status picker's choices (LAI-739): one builder, so the card, the
 * panel, the subtasks, the List and the Filter cannot disagree about order or
 * about how a hidden column is marked.
 */

function s(id: string, category: ProjectStatus['category'], position: number, hidden = false) {
  return {
    id,
    project_id: 'p',
    name: id,
    category,
    position,
    hidden,
    created_at: 0,
    task_count: 0,
  };
}

void describe('statusOptions', () => {
  void test('the project’s statuses by id, in board order, whatever order they arrive in', () => {
    const options = statusOptions([
      s('Done', 'done', 2),
      s('QA', 'review', 1),
      s('To do', 'todo', 0),
    ]);
    assert.deepEqual(
      options.map((o) => o.value),
      ['To do', 'QA', 'Done'],
    );
    assert.deepEqual(
      options.map((o) => o.label),
      ['To do', 'QA', 'Done'],
    );
  });

  void test('a hidden status is offered, marked by a badge — not by changing its name', () => {
    const [shown, hidden] = statusOptions([
      s('Done', 'done', 0),
      s('Cancelled', 'cancelled', 1, true),
    ]);
    assert.equal(shown?.badge, undefined);
    assert.equal(hidden?.badge, 'Hidden');
    assert.equal(hidden?.label, 'Cancelled', 'the name is what is searched and announced');
  });

  void test('the kind is said beside the name only when asked for', () => {
    const [plain] = statusOptions([s('QA', 'review', 0)]);
    const [kinded] = statusOptions([s('QA', 'review', 0)], { kind: true });
    assert.equal(plain?.detail, undefined);
    assert.equal(kinded?.detail, 'In review');
  });

  void test('each wears its kind’s dot', () => {
    const [option] = statusOptions([s('QA', 'review', 0)]);
    const icon = option?.icon as { props: { className: string } };
    assert.equal(icon.props.className, 'dd-dot dd-dot-review');
  });
});
