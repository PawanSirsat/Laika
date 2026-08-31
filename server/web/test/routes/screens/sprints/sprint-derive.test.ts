/**
 * `routes/screens/sprints/sprint-derive.ts` (LAI-083).
 *
 * The screen's arithmetic and calendar. This package has no component renderer
 * (CONVENTIONS §4), so everything worth asserting was written as a pure
 * function on purpose — the inclusive end date in particular, which is the one
 * rule a reader is most likely to get silently wrong.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import type { Sprint } from '../../../../src/api/sprints.ts';
import type { Task } from '../../../../src/api/tasks.ts';
import {
  dateInputToMs,
  formatRange,
  groupBySprint,
  inCalendarOrder,
  MIN_SPRINT_DAYS,
  msToDateInput,
  progressFor,
  sprintDays,
  toFormValues,
  toSprintInput,
  validateSprintForm,
  type SprintFormValues,
  daysLeft,
} from '../../../../src/routes/screens/sprints/sprint-derive.ts';

const AUG_1 = Date.parse('2026-08-01T00:00:00.000Z');
const AUG_14 = Date.parse('2026-08-14T00:00:00.000Z');

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LAI-${over.id}`,
    project_id: 'p1',
    number: 1,
    title: 'A task',
    description_md: null,
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    ready: true,
    blocked_by: [],
    tags: [],
    acceptance_md: null,
    blocks: [],
    comment_count: 0,
    started_at: null,
    completed_at: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function sprint(over: Partial<Sprint> & { id: string }): Sprint {
  return {
    name: 'Sprint',
    goal: null,
    starts_on: AUG_1,
    ends_on: AUG_14,
    status: 'planned',
    project_id: 'p',
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

const VALID: SprintFormValues = {
  name: 'Sprint 1',
  goal: '',
  startsOn: '2026-08-01',
  endsOn: '2026-08-14',
};

void describe('dates round-trip through the date input', () => {
  void test('parses and re-renders the same day', () => {
    assert.equal(msToDateInput(dateInputToMs('2026-08-01') ?? 0), '2026-08-01');
  });

  void test('reads the input as UTC midnight, so no timezone shifts the day', () => {
    // Parsing `2026-08-01` as *local* midnight puts it on 31 July for anyone
    // east of UTC, and the sprint silently starts a day early for them.
    assert.equal(dateInputToMs('2026-08-01'), Date.parse('2026-08-01T00:00:00.000Z'));
  });

  void test('rejects anything that is not a full date', () => {
    for (const bad of ['', '2026-08', '01/08/2026', 'yesterday', '2026-13-01']) {
      assert.equal(dateInputToMs(bad), null, bad);
    }
  });
});

void describe('the end date is inclusive (§4.15)', () => {
  void test('1 Aug to 14 Aug is fourteen days, not thirteen', () => {
    // The `+ 1` in `sprintDays`. Without it every sprint reads one short and the
    // two-day minimum looks like a one-day minimum.
    assert.equal(sprintDays(AUG_1, AUG_14), 14);
  });

  void test('the shortest expressible sprint is two days', () => {
    const aug2 = Date.parse('2026-08-02T00:00:00.000Z');
    assert.equal(sprintDays(AUG_1, aug2), MIN_SPRINT_DAYS);
  });

  void test('a same-day range is one day, and the form refuses it', () => {
    // The database refuses `ends_on = starts_on` (`CHECK (ends_on > starts_on)`),
    // so the form must not offer it rather than letting the server say no.
    assert.equal(sprintDays(AUG_1, AUG_1), 1);
    assert.match(
      validateSprintForm({ ...VALID, endsOn: '2026-08-01' }).endsOn ?? '',
      /shortest sprint is 2 days/,
    );
  });

  void test('the range label names the last day, not the day after', () => {
    assert.match(formatRange(AUG_1, AUG_14), /14 Aug 2026$/);
  });

  void test('a range spanning two years shows both', () => {
    const dec = Date.parse('2026-12-28T00:00:00.000Z');
    const jan = Date.parse('2027-01-08T00:00:00.000Z');
    assert.match(formatRange(dec, jan), /2026.*2027/);
  });
});

void describe('validateSprintForm', () => {
  void test('accepts a well-formed sprint', () => {
    assert.deepEqual(validateSprintForm(VALID), {});
  });

  void test('requires a name', () => {
    assert.ok(validateSprintForm({ ...VALID, name: '   ' }).name);
  });

  void test('holds the server’s own length limits', () => {
    assert.ok(validateSprintForm({ ...VALID, name: 'x'.repeat(121) }).name);
    assert.ok(validateSprintForm({ ...VALID, goal: 'x'.repeat(501) }).goal);
    assert.deepEqual(validateSprintForm({ ...VALID, goal: 'x'.repeat(500) }), {});
  });

  void test('requires both dates', () => {
    assert.ok(validateSprintForm({ ...VALID, startsOn: '' }).startsOn);
    assert.ok(validateSprintForm({ ...VALID, endsOn: '' }).endsOn);
  });

  void test('does not attempt to check overlap — the server owns that', () => {
    // Two sprints on identical dates are refused by the server with a 409 that
    // names the collision. Nothing here can see other sprints, so a local rule
    // would be a second opinion that is wrong whenever two people plan at once.
    assert.deepEqual(validateSprintForm(VALID), {});
    assert.deepEqual(validateSprintForm({ ...VALID, name: 'Another' }), {});
  });
});

void describe('toSprintInput', () => {
  void test('trims, and sends null for an empty goal rather than an empty string', () => {
    // `null` clears the column server-side; `''` would be stored as a goal that
    // is present and blank, which reads differently everywhere downstream.
    const input = toSprintInput({ ...VALID, name: '  Sprint 1  ', goal: '   ' });
    assert.equal(input?.name, 'Sprint 1');
    assert.equal(input?.goal, null);
  });

  void test('keeps a real goal', () => {
    assert.equal(toSprintInput({ ...VALID, goal: ' Ship invites ' })?.goal, 'Ship invites');
  });

  void test('round-trips an existing sprint through the form', () => {
    const original = sprint({ id: 's1', name: 'Sprint 1', goal: 'Ship it' });
    const back = toSprintInput(toFormValues(original));

    assert.equal(back?.name, original.name);
    assert.equal(back?.goal, original.goal);
    assert.equal(back?.starts_on, original.starts_on);
    assert.equal(back?.ends_on, original.ends_on);
  });
});

void describe('progressFor', () => {
  void test('counts done against total', () => {
    const p = progressFor([
      task({ id: '1', status: 'done' }),
      task({ id: '2', status: 'todo' }),
      task({ id: '3', status: 'in_progress' }),
      task({ id: '4', status: 'done' }),
    ]);
    assert.deepEqual(p, { done: 2, total: 4, percent: 50 });
  });

  void test('excludes cancelled work from both halves', () => {
    // Work that will not happen must not hold a finished sprint below 100% for
    // ever — that is the one judgement call in this module.
    const p = progressFor([
      task({ id: '1', status: 'done' }),
      task({ id: '2', status: 'cancelled' }),
    ]);
    assert.deepEqual(p, { done: 1, total: 1, percent: 100 });
  });

  void test('an empty sprint is 0%, not NaN', () => {
    assert.deepEqual(progressFor([]), { done: 0, total: 0, percent: 0 });
  });

  void test('a sprint of only cancelled tasks is 0%, not NaN', () => {
    assert.deepEqual(progressFor([task({ id: '1', status: 'cancelled' })]), {
      done: 0,
      total: 0,
      percent: 0,
    });
  });
});

void describe('groupBySprint', () => {
  void test('buckets by sprint, with unassigned under null', () => {
    // No `withSprintIds` boundary any more: `sprint_id` is on `Task` itself
    // since LAI-121, so a task is already the shape this groups.
    const rows = [
      { ...task({ id: '1' }), sprint_id: 's1' },
      { ...task({ id: '2' }), sprint_id: 's1' },
      task({ id: '3' }),
    ];
    const grouped = groupBySprint(rows);

    assert.equal(grouped.get('s1')?.length, 2);
    assert.equal(grouped.get(null)?.length, 1);
  });

  void test('a sprint with no tasks is absent, not empty — callers default it', () => {
    assert.equal(groupBySprint([]).get('s1'), undefined);
  });
});

void describe('inCalendarOrder', () => {
  void test('orders by start date, matching the server’s ORDER BY', () => {
    const later = sprint({ id: 'b', starts_on: AUG_14 });
    const earlier = sprint({ id: 'a', starts_on: AUG_1 });

    assert.deepEqual(
      inCalendarOrder([later, earlier]).map((s) => s.id),
      ['a', 'b'],
    );
  });

  void test('breaks a tie on id, so the order is total', () => {
    const b = sprint({ id: 'b' });
    const a = sprint({ id: 'a' });

    assert.deepEqual(
      inCalendarOrder([b, a]).map((s) => s.id),
      ['a', 'b'],
    );
  });

  void test('does not mutate its argument', () => {
    const input = [sprint({ id: 'b', starts_on: AUG_14 }), sprint({ id: 'a', starts_on: AUG_1 })];
    inCalendarOrder(input);
    assert.equal(input[0]?.id, 'b');
  });
});

void describe('the screen does not re-implement a server rule', () => {
  void test('nothing in the sprints folder mentions overlap or one-active', async () => {
    // §4.15's two rules are enforced under a write lock server-side and refused
    // with a 409 that names the conflict. A client-side copy is wrong exactly
    // when two people plan at once. This is a structural guard, not a style
    // preference: it fails if somebody adds the "helpful" pre-check.
    const files = [
      'sprint-derive.ts',
      'use-sprints.ts',
      'SprintForm.tsx',
      'SprintCard.tsx',
      'SprintsScreen.tsx',
      'AssignTasksPanel.tsx',
    ];

    for (const name of files) {
      const source = await readFile(
        new URL(`../../../../src/routes/screens/sprints/${name}`, import.meta.url),
        'utf8',
      );
      // Comments explain *why* the rules are absent, so strip them first — the
      // same trap `test/helpers/code.ts` exists for.
      const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

      assert.ok(
        !/\boverlaps?\b/i.test(body),
        `${name} appears to check overlap locally — the server owns that rule`,
      );
      assert.ok(
        !/status === 'active'\s*\)\s*\{[\s\S]{0,80}throw/i.test(body),
        `${name} appears to refuse a second activation locally`,
      );
    }
  });
});

void describe('daysLeft counts the last day (LAI-069)', () => {
  const day = 24 * 60 * 60 * 1000;
  const noon = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);
  const midnight = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

  void test('a sprint ending today has one day left, not zero', () => {
    // END_IS_INCLUSIVE: the day you are standing in is still a day you can work.
    assert.equal(daysLeft(midnight('2026-08-25'), noon('2026-08-25')), 1);
  });

  void test('ending tomorrow leaves two', () => {
    assert.equal(daysLeft(midnight('2026-08-26'), noon('2026-08-25')), 2);
  });

  void test('the answer does not depend on the time of day', () => {
    // `ends_on` is a date; `now` is an instant. Subtracting them raw would make
    // the number change over the course of an afternoon.
    const ends = midnight('2026-08-30');
    const early = daysLeft(ends, Date.parse('2026-08-25T00:01:00Z'));
    const late = daysLeft(ends, Date.parse('2026-08-25T23:59:00Z'));
    assert.equal(early, late);
  });

  void test('a finished sprint has none left, never a negative', () => {
    assert.equal(daysLeft(midnight('2026-08-20'), noon('2026-08-25')), 0);
    assert.equal(daysLeft(midnight('2020-01-01'), noon('2026-08-25')), 0);
  });

  void test('agrees with sprintDays over a whole sprint', () => {
    // On the first day, days left should equal the sprint's length.
    const start = midnight('2026-09-01');
    const end = midnight('2026-09-14');
    assert.equal(daysLeft(end, start + day / 2), sprintDays(start, end));
  });
});
