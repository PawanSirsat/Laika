/**
 * The Work page's derivations (LAI-952): the filters as they live in the URL,
 * what they ask the server for, and how a served row reads.
 *
 * **Nothing here decides which tasks a reader may see.** That is the server's
 * answer (`GET /tasks`, LAI-887); the rows are drawn from the page as served,
 * so the test that matters is that none is added, dropped or reordered.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALL_TASKS_PAGE,
  allTasksFilter,
  personMode,
  readWorkFilter,
  STATUS_FILTERS,
  withWorkFilter,
  workRows,
} from '../../../../src/routes/screens/work/work-derive.ts';
import type { TaskSummary } from '../../../../src/api/tasks.ts';

function task(over: Partial<TaskSummary> & { id: string }): TaskSummary {
  return {
    key: `LAI-${over.id}`,
    project_id: 'p1',
    number: 1,
    title: `Task ${over.id}`,
    status: 'todo',
    status_id: 'st-todo',
    status_name: 'To do',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    updated_at: 1,
    ...over,
  } as TaskSummary;
}

void describe('the filters in the URL', () => {
  void test('absent means everyone, every status, every space, every sprint', () => {
    assert.deepEqual(readWorkFilter(new URLSearchParams()), {});
  });

  void test('each is read back from its own param', () => {
    const params = new URLSearchParams(
      'person=none&status=review&space=onroute&sprint=s1&project=ignored',
    );
    assert.deepEqual(readWorkFilter(params), {
      person: 'none',
      status: 'review',
      space: 'onroute',
      sprint: 's1',
    });
  });

  void test('a status the server does not know is dropped, not sent to be refused', () => {
    assert.deepEqual(readWorkFilter(new URLSearchParams('status=doing')), {});
  });

  void test('setting one keeps the others, and an empty value removes it', () => {
    const before = new URLSearchParams('person=u1&status=todo&tab=x');
    const after = withWorkFilter(before, { status: '' });
    assert.equal(after.toString(), 'person=u1&tab=x');
    assert.equal(before.toString(), 'person=u1&status=todo&tab=x', 'the input was changed');
  });

  void test('a different space clears the sprint, which belonged to the old one', () => {
    const params = new URLSearchParams('space=laika&sprint=s1');
    assert.equal(withWorkFilter(params, { space: 'onroute' }).get('sprint'), null);
    // Choosing the same space again is not a change of space.
    assert.equal(withWorkFilter(params, { space: 'laika' }).get('sprint'), 's1');
    // "No sprint" means the same thing in every space, so it survives.
    const none = new URLSearchParams('space=laika&sprint=none');
    assert.equal(withWorkFilter(none, { space: 'onroute' }).get('sprint'), 'none');
  });

  void test('what the server is asked for: person is assignee, space is project', () => {
    assert.deepEqual(
      allTasksFilter({ person: 'none', status: 'done', space: 'laika', sprint: 's1' }),
      { assignee: 'none', status: 'done', project: 'laika', sprint: 's1', limit: ALL_TASKS_PAGE },
    );
    assert.deepEqual(allTasksFilter({}), { limit: ALL_TASKS_PAGE });
  });

  void test('every status filter is a category the server takes', () => {
    assert.deepEqual(
      STATUS_FILTERS.map((s) => s.value),
      ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'],
    );
  });
});

void describe('Me / Everyone', () => {
  void test('Me is the reader’s own id, Everyone is no person, anything else is neither', () => {
    assert.equal(personMode({ person: 'u1' }, 'u1'), 'me');
    assert.equal(personMode({}, 'u1'), 'everyone');
    assert.equal(personMode({ person: 'u2' }, 'u1'), 'other');
    assert.equal(personMode({ person: 'none' }, 'u1'), 'other');
    // Before the reader is known, a person filter cannot be "me".
    assert.equal(personMode({ person: 'u1' }, undefined), 'other');
  });
});

void describe('the rows', () => {
  const lookups = {
    spaces: new Map([
      ['p1', { slug: 'laika', name: 'Laika' }],
      ['p2', { slug: 'onroute', name: 'Onroute' }],
    ]),
    people: new Map([['u1', 'Pawan Sirsat']]),
    sprints: new Map([['s1', 'Sprint 14']]),
  };

  void test('exactly the served rows, in the served order', () => {
    const served = [task({ id: '3' }), task({ id: '1', project_id: 'p2' }), task({ id: '2' })];
    assert.deepEqual(
      workRows(served, lookups).map((r) => r.id),
      ['3', '1', '2'],
    );
  });

  void test('each column says what the server sent, by name', () => {
    const [row] = workRows(
      [
        task({
          id: '9',
          key: 'ONR-9',
          title: 'Offline queue',
          project_id: 'p2',
          status: 'review',
          status_name: 'QA',
          assignee_id: 'u1',
          sprint_id: 's1',
          updated_at: 42,
        }),
      ],
      lookups,
    );
    assert.deepEqual(row, {
      id: '9',
      key: 'ONR-9',
      title: 'Offline queue',
      space: { slug: 'onroute', name: 'Onroute' },
      status: 'review',
      statusName: 'QA',
      assignee: 'Pawan Sirsat',
      // Whose profile the name links to, for a reader who may open it (LAI-959).
      assigneeId: 'u1',
      sprint: 'Sprint 14',
      updatedAt: 42,
    });
  });

  void test('nobody, no sprint, and what cannot be named yet each say so', () => {
    const [bare, unknown] = workRows(
      [task({ id: '1' }), task({ id: '2', project_id: 'p9', assignee_id: 'u9', sprint_id: 's9' })],
      lookups,
    );
    assert.equal(bare?.assignee, 'Unassigned');
    assert.equal(bare?.assigneeId, null);
    assert.equal(bare?.sprint, null);
    assert.equal(unknown?.space, undefined);
    assert.equal(unknown?.assignee, 'Someone');
    assert.equal(unknown?.sprint, 'A sprint');
  });
});
