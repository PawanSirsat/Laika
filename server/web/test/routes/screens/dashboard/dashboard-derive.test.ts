/**
 * `routes/screens/dashboard/dashboard-derive.ts` (LAI-085).
 *
 * The two things worth getting right: what counts as **blocked**, which must
 * agree with the server's `ready` rule, and that the §4.8 vocabulary is covered
 * so the feed does not render raw type strings.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { readVocabulary } from '../../../helpers/enums.ts';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import type { Task } from '../../../../src/api/tasks.ts';
import {
  blockedTasks,
  byActorKind,
  DEFAULT_RANGE,
  describeProjectEvent,
  RANGES,
  rangeById,
  relativeTime,
  sinceFor,
  statusBreakdown,
  statusChange,
  STATUS_ORDER,
  FEED_SILENT,
  shownInFeed,
} from '../../../../src/routes/screens/dashboard/dashboard-derive.ts';

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
    stale_flagged_at: null,
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

function event(over: Partial<ActivityEvent> & { id: string }): ActivityEvent {
  return {
    seq: 1,
    type: 'task.created',
    project_id: 'p1',
    task_id: null,
    actor_id: 'u1',
    actor_kind: 'user',
    actor_token_id: null,
    payload: null,
    created_at: 0,
    ...over,
  };
}

void describe('statusBreakdown', () => {
  void test('counts every §4.5 status, in board order', () => {
    const b = statusBreakdown([
      task({ id: '1', status: 'todo' }),
      task({ id: '2', status: 'done' }),
      task({ id: '3', status: 'in_progress' }),
    ]);

    assert.deepEqual(
      b.counts.map((c) => c.status),
      [...STATUS_ORDER],
    );
    assert.equal(b.counts.find((c) => c.status === 'todo')?.count, 1);
    assert.equal(b.done, 1);
  });

  void test('a status with no tasks is reported as zero, not omitted', () => {
    // A missing column reads as "we did not measure"; a zero reads as "none".
    const b = statusBreakdown([task({ id: '1', status: 'todo' })]);
    assert.equal(b.counts.length, STATUS_ORDER.length);
    assert.equal(b.counts.find((c) => c.status === 'review')?.count, 0);
  });

  void test('live excludes cancelled but total keeps it', () => {
    // Cancelled work must not hold a finished project below 100% for ever, and
    // the two numbers together still say that cancellations happened.
    const b = statusBreakdown([
      task({ id: '1', status: 'done' }),
      task({ id: '2', status: 'cancelled' }),
    ]);
    assert.equal(b.live, 1);
    assert.equal(b.total, 2);
    assert.equal(b.done, 1);
  });

  void test('an empty project is all zeros, not NaN', () => {
    const b = statusBreakdown([]);
    assert.equal(b.total, 0);
    assert.equal(b.live, 0);
    assert.deepEqual(
      b.counts.map((c) => c.count),
      STATUS_ORDER.map(() => 0),
    );
  });
});

void describe('blockedTasks', () => {
  void test('lists a task whose dependency is not done, and names it', () => {
    const dep = task({ id: 'dep', status: 'in_progress' });
    const blocked = task({ id: 'b', blocked_by: ['dep'], ready: false });

    const rows = blockedTasks([dep, blocked]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.task.id, 'b');
    assert.deepEqual(
      rows[0]?.blockedBy.map((d) => d.id),
      ['dep'],
    );
  });

  void test('a done dependency does not block', () => {
    const dep = task({ id: 'dep', status: 'done' });
    assert.deepEqual(blockedTasks([dep, task({ id: 'b', blocked_by: ['dep'] })]), []);
  });

  void test('a cancelled dependency still blocks — the server says so', () => {
    // `isReady` in task-lifecycle.ts requires every dependency to be `done`, so a
    // cancelled one keeps a task unready for ever. Treating it as satisfied here
    // would make the dashboard disagree with the `ready` flag on the board, and
    // the board is the one the server computes.
    const dep = task({ id: 'dep', status: 'cancelled' });
    const rows = blockedTasks([dep, task({ id: 'b', blocked_by: ['dep'] })]);

    assert.equal(rows.length, 1);
    assert.deepEqual(
      rows[0]?.blockedBy.map((d) => d.status),
      ['cancelled'],
    );
  });

  void test('blocked is narrower than ready === false', () => {
    // Most unready tasks are assigned or already moving, which is "being worked
    // on" rather than "stuck". Only an unmet dependency makes a task something
    // nobody can pick up.
    const assigned = task({ id: 'a', assignee_id: 'u2', ready: false });
    const moving = task({ id: 'm', status: 'in_progress', ready: false });

    assert.deepEqual(blockedTasks([assigned, moving]), []);
  });

  void test('a finished or cancelled task is never listed', () => {
    const dep = task({ id: 'dep', status: 'todo' });
    const done = task({ id: 'd', status: 'done', blocked_by: ['dep'] });
    const cancelled = task({ id: 'c', status: 'cancelled', blocked_by: ['dep'] });

    assert.deepEqual(blockedTasks([dep, done, cancelled]), []);
  });

  void test('a dependency outside the loaded page is reported, not assumed met', () => {
    // Assuming it satisfied would understate the count silently, which is the
    // wrong direction to be wrong in on a screen someone makes decisions from.
    const rows = blockedTasks([task({ id: 'b', blocked_by: ['elsewhere'] })]);

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.unknown, ['elsewhere']);
    assert.deepEqual(rows[0]?.blockedBy, []);
  });
});

void describe('the range control', () => {
  void test('defaults to seven days for an absent or unknown id', () => {
    assert.equal(rangeById(undefined).id, DEFAULT_RANGE);
    assert.equal(rangeById('nonsense').id, DEFAULT_RANGE);
  });

  void test('every range is addressable by its id', () => {
    for (const option of RANGES) assert.equal(rangeById(option.id).id, option.id);
  });

  void test('since is now minus the window', () => {
    const now = 1_700_000_000_000;
    assert.equal(sinceFor(rangeById('24h'), now), now - 24 * 60 * 60 * 1000);
  });

  void test('all time sends no since at all', () => {
    // Not `since: 0`: absent means "no lower bound", and sending a literal zero
    // makes the query say something it does not mean.
    assert.equal(sinceFor(rangeById('all'), 1_700_000_000_000), undefined);
  });
});

void describe('describeProjectEvent', () => {
  void test('reads as a project feed, not a task panel', () => {
    // `api/activity.ts` says "created this task", correct in a detail panel and
    // wrong in a feed where every row names a different task.
    assert.equal(describeProjectEvent(event({ id: '1', type: 'task.created' })), 'created a task');
  });

  void test('covers every verb the server can write', async () => {
    // §4.8's vocabulary is closed and enforced by a CHECK constraint, so this is
    // exact rather than aspirational. A verb added server-side fails here, which
    // is how the feed avoids rendering `sprint.created` raw at a reader.
    // Same parser as the SSE mirror. This one matched the shape already, so an
    // apostrophe could not fool it — but a comment *naming* a type could, and
    // comments inside that array are normal now.
    const enums = await readFile(
      new URL('../../../../../src/db/enums.ts', import.meta.url),
      'utf8',
    );
    const types = readVocabulary(enums, 'ACTIVITY_TYPES');
    assert.ok(types.length > 15, `expected the full vocabulary, got ${String(types.length)}`);

    const unlabelled = types.filter((t) => describeProjectEvent(event({ id: 'x', type: t })) === t);
    assert.deepEqual(unlabelled, [], 'these §4.8 verbs have no wording on the dashboard');
  });

  void test('a verb the feed declines is declined on purpose, with a reason', () => {
    // AC3. A verb silently absent and a verb deliberately declined **look
    // identical to the next reader, and only one of them is a decision.**
    // `FEED_SILENT` is what makes the difference readable.
    assert.ok(Object.keys(FEED_SILENT).length > 0, 'nothing is declined — this proves nothing');

    for (const [type, reason] of Object.entries(FEED_SILENT)) {
      assert.ok(reason.length > 20, `${type} is declined without a reason worth reading`);
      // Still in the vocabulary: the decision is about display, not wording.
      assert.notEqual(
        describeProjectEvent(event({ id: 'x', type })),
        type,
        `${type} is declined AND unlabelled — that is a gap wearing a decision's clothes`,
      );
      assert.equal(shownInFeed(type), false, `${type} is listed as declined but still shown`);
    }
  });

  void test('the cron verbs nobody performed are declined, and say why', () => {
    // LAI-151. A different reason from `sprint.tasks_changed`, which was
    // volume: these carry `actor_kind: system` and no actor, and this feed's
    // job is what changed **and who changed it**. There is nobody to name.
    for (const type of ['heartbeat.pruned', 'invite.expired', 'meeting_review.expired']) {
      assert.equal(shownInFeed(type), false, `${type} reaches a feed of what people did`);
      assert.ok((FEED_SILENT[type] ?? '').length > 20, `${type} is declined without a reason`);
    }
  });

  void test('task.stale_flagged is deliberately kept, and stays kept', () => {
    // The judgement, asserted rather than left implicit. It is the one cron
    // verb a person asks about — "why is this marked stale" — and the flag
    // itself provokes the question. Silencing it hides the answer.
    assert.equal(shownInFeed('task.stale_flagged'), true);
    assert.equal(
      describeProjectEvent(event({ id: 'x', type: 'task.stale_flagged' })),
      'flagged this task as stale',
    );
  });

  void test('every other verb the server can write is shown', () => {
    // The other half: `FEED_SILENT` must not become a place verbs go to be
    // forgotten. Anything not explicitly declined reaches the reader.
    for (const type of ['task.created', 'sprint.created', 'project.context_updated']) {
      assert.equal(shownInFeed(type), true, `${type} is not reaching the feed`);
    }
  });

  void test('an unknown verb degrades to itself rather than throwing', () => {
    assert.equal(describeProjectEvent(event({ id: '1', type: 'future.verb' })), 'future.verb');
  });
});

void describe('statusChange', () => {
  void test('reads from and to off a status change', () => {
    assert.deepEqual(
      statusChange(
        event({ id: '1', type: 'task.status_changed', payload: { from: 'todo', to: 'done' } }),
      ),
      { from: 'todo', to: 'done' },
    );
  });

  void test('ignores other types and malformed payloads', () => {
    assert.equal(statusChange(event({ id: '1', payload: { from: 'a', to: 'b' } })), undefined);
    assert.equal(
      statusChange(event({ id: '1', type: 'task.status_changed', payload: { from: 1 } })),
      undefined,
    );
    assert.equal(
      statusChange(event({ id: '1', type: 'task.status_changed', payload: null })),
      undefined,
    );
  });
});

void describe('byActorKind', () => {
  void test('splits agent work from human work — the reason actor_kind exists', () => {
    const counts = byActorKind([
      event({ id: '1', actor_kind: 'user' }),
      event({ id: '2', actor_kind: 'agent' }),
      event({ id: '3', actor_kind: 'agent' }),
      event({ id: '4', actor_kind: 'system' }),
    ]);

    assert.deepEqual(counts, { user: 1, agent: 2, system: 1 });
  });

  void test('reports zero rather than a missing key for an absent kind', () => {
    assert.deepEqual(byActorKind([]), { user: 0, agent: 0, system: 0 });
  });
});

void describe('relativeTime', () => {
  const now = 1_700_000_000_000;

  void test('is coarse, and singular where it should be', () => {
    assert.equal(relativeTime(now, now), 'just now');
    assert.equal(relativeTime(now - 61_000, now), '1 minute ago');
    assert.equal(relativeTime(now - 2 * 60_000, now), '2 minutes ago');
    assert.equal(relativeTime(now - 60 * 60_000, now), '1 hour ago');
    assert.equal(relativeTime(now - 26 * 60 * 60_000, now), '1 day ago');
  });

  void test('never reads as the future when clocks disagree', () => {
    // Server and browser clocks differ; "in -3 minutes" is worse than "just now".
    assert.equal(relativeTime(now + 60_000, now), 'just now');
  });
});
