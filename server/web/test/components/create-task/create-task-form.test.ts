import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiError } from '../../../src/api/errors.ts';
import type { ProjectStatus } from '../../../src/api/statuses.ts';
import {
  defaultStatusId,
  emptyDraft,
  errorsByField,
  FIELD_OF_PATH,
  keepForAnother,
  toCreateBody,
  type CreateTaskDraft,
} from '../../../src/components/create-task/create-task-form.ts';

/**
 * The Create task dialog's mapping to the create body (LAI-1167, D-145):
 * what is omitted, how the dates and lists are shaped, and which field a
 * refusal lands on. Each assertion was run against a mutant of the rule it
 * names before it was kept.
 */

const full: CreateTaskDraft = {
  ...emptyDraft(),
  title: '  Ship the dialog  ',
  description: 'Why.',
  acceptance: '- [ ] it opens',
  statusId: 'st-todo',
  priority: 'p1',
  assigneeId: 'u2',
  agentId: 'ag-1',
  sprintId: 's1',
  dueOn: '2026-11-20',
  plannedStart: '2026-11-12',
  tags: ['UI ', 'ui', 'Backend'],
  deliverables: [
    { key: 'a', title: ' The dialog ', detail: '' },
    { key: 'b', title: '   ', detail: 'blank title, dropped' },
    { key: 'c', title: 'Tests', detail: ' browser and unit ' },
  ],
  solves: 'one\n\n  two  \n',
  unlocks: 'three',
  size: 'M',
  parentId: 't-parent',
  blockedBy: ['t2', 't3'],
  externalRef: ' JIRA-9 ',
};

void describe('toCreateBody', () => {
  void test('an empty draft sends the title, the priority and nothing else', () => {
    assert.deepEqual(toCreateBody({ ...emptyDraft(), title: 'Only this' }), {
      title: 'Only this',
      priority: 'p2',
    });
  });

  void test('every field maps to its body key; the sprint and the blockers are not in it', () => {
    const body = toCreateBody(full);
    assert.deepEqual(body, {
      title: 'Ship the dialog',
      priority: 'p1',
      status_id: 'st-todo',
      description_md: 'Why.',
      acceptance_md: '- [ ] it opens',
      assignee_id: 'u2',
      selected_agent_id: 'ag-1',
      due_on: Date.UTC(2026, 10, 20),
      planned_start: Date.UTC(2026, 10, 12),
      tags: ['ui', 'backend'],
      deliverables: [{ title: 'The dialog' }, { title: 'Tests', detail: 'browser and unit' }],
      solves: ['one', 'two'],
      unlocks: ['three'],
      size: 'M',
      parent_task_id: 't-parent',
      external_ref: 'JIRA-9',
    });
    assert.equal('sprint_id' in body, false);
    assert.equal('blocked_by' in body, false);
  });

  void test('status_id only — never `status`, so the pair cannot disagree (LAI-738)', () => {
    const body = toCreateBody(full) as unknown as Record<string, unknown>;
    assert.equal(body.status, undefined);
    assert.equal(body.status_id, 'st-todo');
    const none = toCreateBody({ ...full, statusId: undefined }) as unknown as Record<
      string,
      unknown
    >;
    assert.equal('status_id' in none, false);
    assert.equal('status' in none, false);
  });

  void test('a date is UTC midnight of the day typed; a blank or broken one is left out', () => {
    assert.equal(toCreateBody({ ...full, dueOn: '2026-01-01' }).due_on, Date.UTC(2026, 0, 1));
    assert.equal('due_on' in toCreateBody({ ...full, dueOn: '' }), false);
    assert.equal('due_on' in toCreateBody({ ...full, dueOn: 'next week' }), false);
  });

  void test('tags are trimmed, lower-cased and deduplicated; none means no key', () => {
    assert.deepEqual(toCreateBody({ ...full, tags: [' A', 'a', 'B'] }).tags, ['a', 'b']);
    assert.equal('tags' in toCreateBody({ ...full, tags: ['  '] }), false);
  });

  void test('a description of only whitespace is not sent; one with text is sent as typed', () => {
    assert.equal('description_md' in toCreateBody({ ...full, description: ' \n ' }), false);
    assert.equal(toCreateBody({ ...full, description: 'a\n' }).description_md, 'a\n');
  });
});

void describe('keepForAnother', () => {
  void test('keeps exactly status, priority, sprint and assignee', () => {
    const kept = keepForAnother(full);
    assert.deepEqual(kept, {
      ...emptyDraft(),
      statusId: 'st-todo',
      priority: 'p1',
      sprintId: 's1',
      assigneeId: 'u2',
    });
    // The four, by name, so a fifth kept field cannot slip in through `...`.
    const differs = (Object.keys(kept) as (keyof CreateTaskDraft)[]).filter(
      (k) => JSON.stringify(kept[k]) !== JSON.stringify(emptyDraft()[k]),
    );
    assert.deepEqual(differs.sort(), ['assigneeId', 'priority', 'sprintId', 'statusId']);
  });
});

void describe('errorsByField', () => {
  const zod = (issues: { path: string; message: string }[]) =>
    new ApiError('unprocessable', 'Invalid request body', 422, {
      issues: issues.map((i) => ({ ...i, code: 'custom' })),
    });

  void test('a zod 422 lands each issue on its field, a list item on its list', () => {
    const out = errorsByField(
      zod([
        { path: 'external_ref', message: 'Too long' },
        { path: 'tags.0', message: 'Not a tag' },
        { path: 'tags.1', message: 'Also not' },
      ]),
    );
    assert.deepEqual(out, { fields: { externalRef: 'Too long', tags: 'Not a tag' } });
  });

  void test('a service 422 with details.field lands on that field, in the server’s words', () => {
    const out = errorsByField(
      new ApiError('unprocessable', 'No such status in this project', 422, {
        field: 'status_id',
      }),
    );
    assert.deepEqual(out, { fields: { status: 'No such status in this project' } });
    // `status` and `status_id` are the same control.
    assert.equal(FIELD_OF_PATH.status, FIELD_OF_PATH.status_id);
  });

  void test('anything no field can carry is the form’s, in the error’s words', () => {
    assert.deepEqual(errorsByField(new ApiError('forbidden', 'Viewers cannot create', 403)), {
      fields: {},
      form: 'Viewers cannot create',
    });
    assert.deepEqual(errorsByField(new TypeError('Failed to fetch')), {
      fields: {},
      form: 'Failed to fetch',
    });
    assert.deepEqual(errorsByField('odd'), {
      fields: {},
      form: 'Could not create the task. Try again.',
    });
  });

  void test('a path the form has no field for falls back to the form', () => {
    assert.deepEqual(errorsByField(zod([{ path: 'created_via', message: 'Bad' }])), {
      fields: {},
      form: 'Invalid request body',
    });
  });
});

void describe('defaultStatusId', () => {
  const status = (
    id: string,
    category: ProjectStatus['category'],
    position: number,
    hidden = false,
  ): ProjectStatus => ({
    id,
    project_id: 'p1',
    name: id,
    category,
    position,
    hidden,
    created_at: 1,
    task_count: 0,
  });

  void test('the lowest-positioned visible Backlog column, whatever order they arrive in', () => {
    assert.equal(
      defaultStatusId([
        status('todo', 'todo', 1),
        status('later', 'backlog', 2),
        status('ideas', 'backlog', 0),
      ]),
      'ideas',
    );
  });

  void test('a hidden Backlog column is skipped', () => {
    assert.equal(
      defaultStatusId([status('hidden', 'backlog', 0, true), status('open', 'backlog', 1)]),
      'open',
    );
  });

  void test('with no Backlog column, the first visible column; with none at all, undefined', () => {
    assert.equal(defaultStatusId([status('done', 'done', 2), status('todo', 'todo', 1)]), 'todo');
    assert.equal(defaultStatusId([]), undefined);
    assert.equal(defaultStatusId([status('x', 'cancelled', 0, true)]), undefined);
  });
});
