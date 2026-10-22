/**
 * `src/api/activity.ts` (LAI-056).
 *
 * Pure helpers over the feed. `describeEvent` matters more than it looks: an
 * unknown event type must stay readable rather than throwing or rendering
 * `task.status_changed` raw at someone.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  describeEvent,
  historyCsvHref,
  isReorder,
  listProjectActivityPage,
  pushSummary,
  shownInFeed,
  statusMoveNames,
  statusTransition,
  type ActivityEvent,
} from '../../src/api/activity.ts';

function event(over: Partial<ActivityEvent> & { type: string }): ActivityEvent {
  return {
    id: 'e1',
    seq: 1,
    project_id: 'p',
    task_id: 't',
    actor_id: 'u',
    actor_kind: 'user',
    actor_token_id: null,
    payload: null,
    created_at: 0,
    ...over,
  };
}

void describe('describeEvent', () => {
  void test('gives human wording for the types we know', () => {
    assert.equal(describeEvent(event({ type: 'task.created' })), 'created this task');
    assert.equal(describeEvent(event({ type: 'comment.added' })), 'commented');
    assert.equal(describeEvent(event({ type: 'task.status_changed' })), 'moved this task');
  });

  void test('a reorder reads as a reorder, not as an edit (LAI-970)', () => {
    // The organisation's history shows every row; a drag is `task.updated`
    // naming `position`, and *edited this task* would claim a change it was not.
    const reorder = event({ type: 'task.updated', payload: { field: 'position' } });
    assert.equal(describeEvent(reorder), 'reordered this task');
    assert.equal(
      describeEvent(event({ type: 'task.updated', payload: { field: 'title' } })),
      'edited this task',
    );
  });

  void test('an unknown type degrades to itself, not to a crash or a blank', () => {
    // New server-side types will appear as themselves until someone adds a
    // line. Legible and obviously incomplete is the right failure.
    assert.equal(describeEvent(event({ type: 'task.teleported' })), 'task.teleported');
  });

  void test("the owner's who-can-do-what change reads as that, not as a member's role (LAI-960)", () => {
    // LAI-958 reuses `member.role_changed` with `scope: "org_permissions"`.
    const grants = event({
      type: 'member.role_changed',
      project_id: null,
      task_id: null,
      payload: { scope: 'org_permissions', from: {}, to: {} },
    });
    assert.equal(describeEvent(grants), 'changed who can do what');
    assert.equal(
      describeEvent(
        event({ type: 'member.role_changed', payload: { from: 'member', to: 'admin' } }),
      ),
      'changed a member’s role',
    );
  });

  void test('a membership row says who and which roles (LAI-989)', () => {
    // The payloads carry `user_name` and the roles since LAI-993; "lead" is
    // "Space admin" on screen (D-103 item 2).
    const member = (type: string, payload: Record<string, unknown>) =>
      describeEvent(event({ type, task_id: null, payload }));
    assert.equal(
      member('member.added', { user_id: 'u2', user_name: 'Mia', role: 'member' }),
      'added Mia as Member',
    );
    assert.equal(
      member('member.role_changed', {
        user_id: 'u3',
        user_name: 'Adam',
        from: 'lead',
        to: 'member',
      }),
      'changed Adam’s role: Space admin → Member',
    );
    assert.equal(
      member('member.removed', { user_id: 'u2', user_name: 'Mia', role: 'viewer' }),
      'removed Mia (Viewer)',
    );
    // The person acting on themselves, as the payload says.
    assert.equal(
      member('member.added', { user_id: 'u', user_name: 'Ada', role: 'lead', via: 'join' }),
      'joined as Space admin',
    );
    assert.equal(
      member('member.added', { user_id: 'u', user_name: 'Ada', role: 'member', via: 'invite' }),
      'joined as Member',
    );
    assert.equal(
      member('member.removed', { user_id: 'u', user_name: 'Ada', role: 'member', via: 'leave' }),
      'left the space as Member',
    );
    assert.equal(
      member('member.removed', {
        user_id: 'u2',
        user_name: 'Mia',
        role: 'member',
        via: 'deactivation',
      }),
      'removed Mia (Member) on deactivation',
    );
  });

  void test('an organisation role reads as the organisation names it (LAI-989)', () => {
    const org = (payload: Record<string, unknown>) =>
      describeEvent(
        event({ type: 'member.role_changed', project_id: null, task_id: null, payload }),
      );
    assert.equal(
      org({ scope: 'org', user_id: 'u3', user_name: 'Adam', from: 'admin', to: 'member' }),
      'changed Adam’s role: Admin → Member',
    );
    assert.equal(
      describeEvent(
        event({
          type: 'member.added',
          project_id: null,
          task_id: null,
          payload: { user_id: 'u', user_name: 'Ada', org_role: 'viewer', via: 'invite' },
        }),
      ),
      'joined the organisation as Viewer',
    );
  });

  void test('an older row without a name keeps the generic line', () => {
    // Rows written before LAI-993 carry only ids: never "added undefined".
    assert.equal(
      describeEvent(event({ type: 'member.added', payload: { user_id: 'u2', role: 'member' } })),
      'added a member',
    );
    assert.equal(
      describeEvent(event({ type: 'member.removed', payload: { user_id: 'u2', user_name: null } })),
      'removed a member',
    );
  });

  void test('never returns an empty string', () => {
    for (const type of ['task.created', 'nonsense', '']) {
      assert.equal(typeof describeEvent(event({ type })), 'string');
    }
  });
});

void describe('statusTransition', () => {
  void test('reads from and to off a status change', () => {
    const move = statusTransition(
      event({ type: 'task.status_changed', payload: { from: 'todo', to: 'in_progress' } }),
    );
    assert.deepEqual(move, { from: 'todo', to: 'in_progress' });
  });

  void test('is undefined for any other type, even with a matching payload', () => {
    // Guards against labelling a comment as a move because its payload happens
    // to carry the same keys.
    assert.equal(
      statusTransition(event({ type: 'comment.added', payload: { from: 'a', to: 'b' } })),
      undefined,
    );
  });

  void test('is undefined when the payload is missing or malformed', () => {
    for (const payload of [null, {}, { from: 'todo' }, { from: 1, to: 2 }]) {
      assert.equal(
        statusTransition(event({ type: 'task.status_changed', payload })),
        undefined,
        `payload ${JSON.stringify(payload)} should not produce a transition`,
      );
    }
  });
});

void describe('statusMoveNames — what a feed prints for a move (LAI-739)', () => {
  void test('the status names the payload carries, when it carries them', () => {
    // Two columns of one kind — QA and Code review — are one category; only
    // the names say which way the card went.
    const move = statusMoveNames(
      event({
        type: 'task.status_changed',
        payload: {
          from: 'review',
          to: 'review',
          from_status_name: 'QA',
          to_status_name: 'Code review',
        },
      }),
    );
    assert.deepEqual(move, { from: 'QA', to: 'Code review' });
  });

  void test('an older event without names reads as its kinds, in words', () => {
    const move = statusMoveNames(
      event({ type: 'task.status_changed', payload: { from: 'todo', to: 'in_progress' } }),
    );
    assert.deepEqual(move, { from: 'To do', to: 'In progress' });
  });

  void test('nothing for an event that is not a move', () => {
    assert.equal(statusMoveNames(event({ type: 'comment.added', payload: {} })), undefined);
  });
});

void describe('a reorder never reaches a feed (LAI-473, D-060.4)', () => {
  const event = (type: string, payload: unknown) =>
    ({ id: '1', type, payload }) as unknown as ActivityEvent;

  void test('isReorder is exactly task.updated naming the position field', () => {
    assert.equal(
      isReorder(event('task.updated', { field: 'position', from: 'a0', to: 'a1' })),
      true,
    );
    // Its neighbours in the same verb are edits a person should see.
    assert.equal(isReorder(event('task.updated', { field: 'tags', from: [], to: ['x'] })), false);
    assert.equal(isReorder(event('task.updated', { changed: ['title'] })), false);
    assert.equal(isReorder(event('task.status_changed', { field: 'position' })), false);
    assert.equal(isReorder(event('task.updated', null)), false);
  });

  void test('shownInFeed drops reorders and keeps everything else, in order', () => {
    const rows = [
      event('task.created', {}),
      event('task.updated', { field: 'position', from: 'a0', to: 'a1' }),
      event('task.updated', { changed: ['title'] }),
    ];
    assert.deepEqual(
      shownInFeed(rows).map((e) => e.type),
      ['task.created', 'task.updated'],
    );
  });
});

/*
 * **The Dashboard's window reads through a page function** (LAI-724 review,
 * nit): `store.ts` built the request with raw `request`, so the LAI-703
 * census in `one-page-reads.test.ts` could not see it. As a `Page` function
 * the census counts it, and `store.ts` must be allowed it by name.
 */
void describe('listProjectActivityPage', () => {
  void test('asks for one page of 200, with since and cursor when given', async () => {
    const asked: string[] = [];
    globalThis.fetch = ((input: string | URL) => {
      asked.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], next_cursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    await listProjectActivityPage('laika core', {});
    await listProjectActivityPage('laika-core', { since: 5, cursor: 'C1' });
    assert.deepEqual(asked, [
      '/api/v1/projects/laika%20core/activity?limit=200',
      '/api/v1/projects/laika-core/activity?limit=200&since=5&cursor=C1',
    ]);
  });
});

void describe('pushSummary (LAI-753)', () => {
  void test('says how many commits, to which branch, and the first shas', () => {
    const shas = ['1111111aaaa', '2222222bbbb', '3333333cccc', '4444444dddd'];
    assert.equal(
      pushSummary(
        event({
          type: 'webhook.commit',
          payload: { repo: 'kvell/laika', branch: 'main', default_branch: true, count: 4, shas },
        }),
      ),
      '4 commits to main (default branch) · 1111111, 2222222, 3333333 …',
    );
    assert.equal(
      pushSummary(
        event({
          type: 'webhook.commit',
          payload: { branch: 'lai-1-x', count: 1, shas: ['abcdef0123'] },
        }),
      ),
      '1 commit to lai-1-x · abcdef0',
    );
  });

  void test('an older row with only repo and branch falls back to the label', () => {
    const old = event({ type: 'webhook.commit', payload: { repo: 'kvell/laika', branch: 'x' } });
    assert.equal(pushSummary(old), undefined);
    assert.equal(describeEvent(old), 'pushed a commit');
    assert.equal(pushSummary(event({ type: 'task.created' })), undefined);
  });
});

void describe('historyCsvHref (LAI-989)', () => {
  void test('is the history endpoint as a file, with the filters on screen', () => {
    const href = historyCsvHref({
      actor: 'u1',
      project: 'core',
      type: 'task.created',
      since: 10,
      until: 20,
    });
    const url = new URL(href, 'http://x');
    assert.equal(url.pathname, '/api/v1/activity/history');
    assert.equal(url.searchParams.get('format'), 'csv');
    assert.equal(url.searchParams.get('actor'), 'u1');
    assert.equal(url.searchParams.get('project'), 'core');
    assert.equal(url.searchParams.get('type'), 'task.created');
    assert.equal(url.searchParams.get('since'), '10');
    assert.equal(url.searchParams.get('until'), '20');
  });

  void test('never carries limit or cursor, which the server refuses beside csv', () => {
    const url = new URL(historyCsvHref({}), 'http://x');
    assert.deepEqual([...url.searchParams.keys()], ['format']);
  });
});
