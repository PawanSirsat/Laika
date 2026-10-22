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
  allTasksFilter,
  DEFAULT_PAGE_SIZE,
  pageRange,
  pageTotal,
  personMode,
  readPageSize,
  readWorkFilter,
  STATUS_FILTERS,
  STATUS_TILES,
  summaryFilter,
  topPeople,
  withPageSize,
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
      { assignee: 'none', status: 'done', project: 'laika', sprint: 's1', limit: 25 },
    );
    assert.deepEqual(allTasksFilter({}), { limit: DEFAULT_PAGE_SIZE });
    assert.deepEqual(allTasksFilter({}, 100), { limit: 100 });
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

void describe('the summary strip (LAI-975)', () => {
  const SUMMARY = {
    total: 142,
    by_status: { backlog: 40, todo: 30, in_progress: 25, review: 12, done: 33, cancelled: 2 },
    by_assignee: [
      { user_id: 'u2', name: 'Bea', count: 9 },
      { user_id: null, name: 'Unassigned', count: 50 },
      { user_id: 'u1', name: 'Pawan', count: 83 },
    ],
    overdue: 3,
    blocked: 0,
    unassigned: 50,
  };

  void test('asks for every filter but the status: the tiles are the status breakdown', () => {
    assert.deepEqual(
      summaryFilter({ person: 'u1', status: 'done', space: 'laika', sprint: 's1' }),
      {
        assignee: 'u1',
        project: 'laika',
        sprint: 's1',
      },
    );
    assert.deepEqual(summaryFilter({}), {});
  });

  void test('the tiles, in the order the page names them', () => {
    assert.deepEqual(
      STATUS_TILES.map((s) => s.value),
      ['in_progress', 'review', 'todo', 'backlog', 'done'],
    );
  });

  void test('the pager’s total is the served total, or the chosen status’s count', () => {
    assert.equal(pageTotal(SUMMARY, undefined), 142);
    assert.equal(pageTotal(SUMMARY, 'review'), 12);
    assert.equal(pageTotal(undefined, 'review'), undefined);
  });

  void test('top people are the served figures, largest first, no more than asked', () => {
    assert.deepEqual(
      topPeople(SUMMARY.by_assignee, 2).map((p) => p.name),
      ['Pawan', 'Unassigned'],
    );
    // The served array is not reordered in place.
    assert.equal(SUMMARY.by_assignee[0]?.name, 'Bea');
  });
});

void describe('pages (LAI-975)', () => {
  void test('the page size lives in the URL: 25, 50 or 100, 25 otherwise', () => {
    assert.equal(readPageSize(new URLSearchParams('')), 25);
    assert.equal(readPageSize(new URLSearchParams('size=50')), 50);
    assert.equal(readPageSize(new URLSearchParams('size=100')), 100);
    assert.equal(readPageSize(new URLSearchParams('size=7')), 25);
    assert.equal(
      withPageSize(new URLSearchParams('status=todo'), 50).toString(),
      'status=todo&size=50',
    );
    assert.equal(withPageSize(new URLSearchParams('size=50'), 25).toString(), '');
  });

  void test('the size survives a filter change', () => {
    assert.equal(
      withWorkFilter(new URLSearchParams('size=50'), { status: 'todo' }).get('size'),
      '50',
    );
  });

  void test('the range reads first–last of total', () => {
    assert.equal(pageRange(0, 25, 25, 142), '1–25 of 142');
    assert.equal(pageRange(5, 25, 17, 142), '126–142 of 142');
    assert.equal(pageRange(1, 50, 50, undefined), '51–100');
    assert.equal(pageRange(0, 25, 0, 0), '0 of 0');
  });
});
