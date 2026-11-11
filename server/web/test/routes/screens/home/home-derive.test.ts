/**
 * The Command Center's derivations (LAI-1202): each section's rows, its count
 * and where the count leads, from fixture rows in the server's shapes.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityEvent } from '../../../../src/api/activity.ts';
import type { AgentSession, RegisteredAgent } from '../../../../src/api/agents.ts';
import { DAY_MS, startOfUtcDay } from '../../../../src/api/date-only.ts';
import type { PersonHandoffView } from '../../../../src/api/handoffs.ts';
import type { ReviewQueueItem } from '../../../../src/api/review.ts';
import type { TaskLiveClaim, TaskSummary } from '../../../../src/api/tasks.ts';
import {
  activeGroup,
  activityRows,
  agentRows,
  attentionEmpty,
  blockedGroup,
  blockerIdsOf,
  blockerLabel,
  comingUpGroup,
  connectionOf,
  handoffGroup,
  HOME_CAP,
  listHref,
  overdueGroup,
  reviewGroup,
  type BlockerInfo,
  type SpaceRef,
} from '../../../../src/routes/screens/home/home-derive.ts';

const NOW = Date.UTC(2026, 10, 11, 10, 0);
const TODAY = startOfUtcDay(NOW);
const ME = 'u1';

const SPACES = new Map<string, SpaceRef>([
  ['laika', { slug: 'laika', name: 'Laika' }],
  ['ops', { slug: 'ops', name: 'Laika Ops' }],
]);

function task(id: string, status: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    key: `LAI-${id}`,
    title: `Task ${id}`,
    status,
    status_name: status === 'in_progress' ? 'In progress' : 'To do',
    blocked_by: [],
    due_on: null,
    updated_at: 0,
    claim: null,
    ...extra,
  } as unknown as TaskSummary;
}

const inSpace = (slug: string, ...tasks: TaskSummary[]) => tasks.map((t) => ({ task: t, slug }));

function claim(agentId: string, connection: 'live' | 'suspect'): TaskLiveClaim {
  return {
    generation: 1,
    state: 'active',
    agent_id: agentId,
    session_id: 's1',
    lease_expires_at: NOW + 60_000,
    last_heartbeat_at: NOW,
    connection,
    suspect_after_ms: 90_000,
    device_label: null,
  };
}

void describe('listHref — where a count leads', () => {
  void test('one space: its List, filtered to the reader and the group', () => {
    assert.equal(
      listHref(['laika', 'laika'], ME, { overdue: 'true' }),
      '/list?project=laika&assignee=u1&overdue=true',
    );
  });

  void test('several spaces: the Work tab across every space, filtered to the reader', () => {
    assert.equal(listHref(['laika', 'ops'], ME), '/organisation?tab=work&person=u1');
  });
});

void describe('needs your attention', () => {
  const item = (id: string, can: boolean, since: number, failed = 0): ReviewQueueItem =>
    ({
      task: task(id, 'review'),
      project: { id: 'p1', slug: 'laika', name: 'Laika', prefix: 'LAI' },
      assignee_name: null,
      waiting_since: since,
      round: { ci: { head_sha: 'x', total: 2, passed: 2 - failed, failed, pending: 0 } },
      finished_by_name: null,
      can_decide: can,
      cue: null,
    }) as unknown as ReviewQueueItem;

  void test('review: only what the reader may decide, oldest first, each opening the dialog', () => {
    const g = reviewGroup(
      [item('1', true, 30), item('2', false, 10), item('3', true, 20, 1)],
      false,
    );
    assert.deepEqual(
      g.rows.map((r) => [r.key, r.href, r.note]),
      [
        ['LAI-3', '/inbox?tab=review&item=3', 'CI failed'],
        ['LAI-1', '/inbox?tab=review&item=1', 'CI passed'],
      ],
    );
    assert.equal(g.count, 2);
    assert.equal(g.href, '/inbox?tab=review');
  });

  void test('review: a capped queue says its count is a floor', () => {
    assert.equal(reviewGroup([item('1', true, 1)], true).floor, true);
  });

  void test('hand-offs: each opens its task in its space; the count is the server’s', () => {
    const row = {
      id: 'o1',
      kind: 'handoff',
      task_id: 't9',
      task_key: 'LAI-9',
      task_title: 'Cache the board query',
      project_slug: 'ops',
    } as unknown as PersonHandoffView;
    const g = handoffGroup([row], 4);
    assert.equal(g.count, 4, 'the page is one of four the server counts');
    assert.deepEqual(
      g.rows.map((r) => [r.key, r.href, r.note]),
      [['LAI-9', '/board?project=ops&task=t9', 'Hand-off to approve']],
    );
    assert.equal(g.href, '/inbox?tab=review&view=handoffs');
  });

  void test('overdue: the reader’s open work past its date, most overdue first; due today is not late', () => {
    const g = overdueGroup(
      inSpace(
        'laika',
        task('1', 'todo', { due_on: TODAY - 2 * DAY_MS }),
        task('2', 'in_progress', { due_on: TODAY - 5 * DAY_MS }),
        task('3', 'todo', { due_on: TODAY }),
        task('4', 'done', { due_on: TODAY - 9 * DAY_MS }),
      ),
      ME,
      NOW,
      SPACES,
    );
    assert.deepEqual(
      g.rows.map((r) => r.key),
      ['LAI-2', 'LAI-1'],
    );
    assert.equal(g.rows[0]?.note, 'Due 6 Nov');
    assert.equal(g.href, '/list?project=laika&assignee=u1&overdue=true');
  });

  void test('empty only when every group is', () => {
    const none = { rows: [], count: 0, href: '' };
    assert.equal(attentionEmpty({ review: undefined, handoffs: none, overdue: none }), true);
    assert.equal(
      attentionEmpty({ review: { ...none, count: 1 }, handoffs: undefined, overdue: none }),
      false,
    );
  });
});

void describe('blocked', () => {
  void test('names each unfinished blocker and its owner; a finished one releases the task', () => {
    const mine = inSpace(
      'laika',
      task('1', 'todo', { blocked_by: ['b1', 'b2'] }),
      task('2', 'in_progress', { blocked_by: ['b3'] }),
      task('3', 'todo', { blocked_by: ['gone'] }),
    );
    const blockers = new Map<string, BlockerInfo>([
      ['b1', { key: 'LAI-50', status: 'in_progress', owner: 'Sam Okafor' }],
      ['b2', { key: 'LAI-51', status: 'todo', owner: null }],
      ['b3', { key: 'LAI-52', status: 'done', owner: 'Kim' }],
    ]);
    const g = blockedGroup(mine, blockers, ME, SPACES);
    assert.deepEqual(
      g.rows.map((r) => [r.key, r.note]),
      [
        ['LAI-1', 'Waiting on LAI-50 (Sam Okafor), LAI-51 (unassigned)'],
        ['LAI-3', 'Waiting on a task you can’t open'],
      ],
    );
    assert.equal(g.href, '/list?project=laika&assignee=u1&blocked=true');
  });

  void test('a blocker whose owner is not known is named by key alone', () => {
    assert.equal(blockerLabel({ key: 'LAI-7', status: 'todo' }), 'LAI-7');
  });

  void test('blockers to look up: outside ones of open tasks, once each', () => {
    const mine = inSpace(
      'laika',
      task('1', 'todo', { blocked_by: ['x', '2'] }),
      task('2', 'todo', { blocked_by: ['x'] }),
      task('3', 'done', { blocked_by: ['y'] }),
    );
    assert.deepEqual(blockerIdsOf(mine), ['x']);
  });
});

void describe('your active work', () => {
  void test('in progress first, then up next; blocked work is not here; claims say what the server said', () => {
    const mine = [
      ...inSpace('laika', task('1', 'todo', { updated_at: 9 })),
      ...inSpace(
        'ops',
        task('2', 'in_progress', { updated_at: 1, claim: claim('ag1', 'suspect') }),
        task('3', 'in_progress', { updated_at: 5, claim: claim('ag1', 'live') }),
        task('4', 'in_progress', { blocked_by: ['b'] }),
        task('5', 'review'),
      ),
    ];
    const g = activeGroup(mine, new Map([['b', { key: 'LAI-99', status: 'todo' }]]), ME, SPACES);
    assert.deepEqual(
      g.rows.map((r) => [r.key, r.note, r.space]),
      [
        ['LAI-3', 'Agent working', 'Laika Ops'],
        ['LAI-2', 'Connection lost', 'Laika Ops'],
        ['LAI-1', 'To do', 'Laika'],
      ],
    );
    assert.equal(g.rows[0]?.href, '/board?project=ops&task=3');
    assert.equal(g.href, '/organisation?tab=work&person=u1');
  });

  void test('rows are capped; the count is all of them', () => {
    const many = inSpace(
      'laika',
      ...Array.from({ length: HOME_CAP + 3 }, (_, i) => task(String(i), 'todo')),
    );
    const g = activeGroup(many, new Map(), ME, SPACES);
    assert.equal(g.rows.length, HOME_CAP);
    assert.equal(g.count, HOME_CAP + 3);
  });
});

void describe('coming up', () => {
  void test('due today through seven days ahead, soonest first; overdue and finished are not here', () => {
    const g = comingUpGroup(
      inSpace(
        'laika',
        task('1', 'todo', { due_on: TODAY + 3 * DAY_MS }),
        task('2', 'todo', { due_on: TODAY }),
        task('3', 'todo', { due_on: TODAY + 7 * DAY_MS }),
        task('4', 'todo', { due_on: TODAY + 8 * DAY_MS }),
        task('5', 'todo', { due_on: TODAY - DAY_MS }),
        task('6', 'done', { due_on: TODAY + DAY_MS }),
        task('7', 'todo'),
      ),
      ME,
      NOW,
      SPACES,
    );
    assert.deepEqual(
      g.rows.map((r) => [r.key, r.note]),
      [
        ['LAI-2', 'Due today'],
        ['LAI-1', 'Due 14 Nov'],
        ['LAI-3', 'Due 18 Nov'],
      ],
    );
    assert.equal(g.href, '/calendar?project=laika');
  });
});

void describe('agents', () => {
  const session = (over: Partial<AgentSession>): AgentSession =>
    ({ id: 's', agent_id: 'a', ended_at: null, connection: 'live', ...over }) as AgentSession;

  void test('connection is the newest session’s word; Connection lost only from suspect', () => {
    assert.equal(connectionOf([session({ connection: 'live' })]), 'live');
    assert.equal(connectionOf([session({ connection: 'suspect' })]), 'lost');
    assert.equal(connectionOf([session({ connection: 'ended', ended_at: 5 })]), 'ended');
    assert.equal(connectionOf([session({ connection: 'live', ended_at: 5 })]), 'ended');
    // The server's word, never the page's clock: an old heartbeat on a session
    // the server still calls live is live (§9.1's suspect interval is its).
    assert.equal(connectionOf([session({ connection: 'live', last_heartbeat_at: 0 })]), 'live');
    assert.equal(connectionOf([]), 'none');
    assert.equal(connectionOf(undefined), 'unknown');
    // Only the newest counts: an old suspect session under a live one is not lost.
    assert.equal(
      connectionOf([session({ connection: 'live' }), session({ connection: 'suspect' })]),
      'live',
    );
  });

  void test('active agents only, each with its words and what it holds of the reader’s', () => {
    const agent = (id: string, status: string): RegisteredAgent =>
      ({ id, display_name: `Agent ${id}`, harness: 'claude-code', status }) as RegisteredAgent;
    const rows = agentRows(
      [agent('a1', 'active'), agent('a2', 'revoked'), agent('a3', 'active')],
      new Map([['a1', [session({ connection: 'suspect' })]]]),
      inSpace('laika', task('1', 'in_progress', { claim: claim('a1', 'suspect') })),
      SPACES,
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.connection, r.label, r.claims.map((c) => [c.key, c.note])]),
      [
        ['a1', 'lost', 'Connection lost', [['LAI-1', 'Connection lost']]],
        ['a3', 'unknown', 'Connection not known', []],
      ],
    );
  });
});

void describe('recent activity', () => {
  void test('each row links to its task, else its space’s Activity, else nowhere; capped', () => {
    const event = (id: string, over: Partial<ActivityEvent>): ActivityEvent => ({
      id,
      seq: 1,
      type: 'task.created',
      project_id: 'p1',
      task_id: null,
      actor_id: 'u2',
      actor_kind: 'user',
      actor_token_id: null,
      payload: null,
      created_at: 0,
      ...over,
    });
    const byId = new Map<string, SpaceRef>([['p1', { slug: 'laika', name: 'Laika' }]]);
    const rows = activityRows(
      [
        event('e1', { task_id: 't1' }),
        event('e2', {}),
        event('e3', { project_id: null }),
        ...Array.from({ length: 10 }, (_, i) => event(`x${String(i)}`, {})),
      ],
      byId,
    );
    assert.equal(rows.length, 8);
    assert.deepEqual(
      rows.slice(0, 3).map((r) => [r.href, r.space]),
      [
        ['/board?project=laika&task=t1', 'Laika'],
        ['/activity?project=laika', 'Laika'],
        [undefined, undefined],
      ],
    );
  });
});
