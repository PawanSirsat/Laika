/**
 * The Board's WORKING NOW strip and the agent-sessions rail (LAI-440) — and,
 * since LAI-727, the Board without the strip.
 *
 * Both rendered a heading and **nothing** in the shipped build: their contents
 * came from `demo/presence.ts` and `demo/agent-sessions.ts`, which return
 * nothing unless demo mode is on (D-032). `GET /presence` exists now, the demo
 * modules are deleted, and what a reader sees under those headings has to be
 * one of three states rather than a silence.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const now = 1788272050095;
const P = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LAI',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 2, review: 1, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 3,
  members: [],
  last_activity_at: 2,
};

const task = (id: string, key: string, title: string, status: string) => ({
  id,
  key,
  project_id: 'p1',
  number: Number(key.split('-')[1]),
  title,
  description_md: null,
  acceptance_md: null,
  status,
  priority: 'p2',
  assignee_id: 'u1',
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: now - 5 * 3600000,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
});

const PRESENCE_STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'p1', role: 'lead' }],
  },
  '/api/v1/projects': { data: [P], next_cursor: null },
  '/api/v1/projects/laika-core': P,
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        repo: 'git@github.com:PawanSirsat/Laika.git',
        branch: 'lai-9-parity',
        matched_task_id: 't1',
        project_ids: ['p1'],
        is_agent: true,
        last_seen: now,
      },
      // LAI-438: present, location withheld. repo/branch absent; the other two null/[].
      {
        user_id: 'u2',
        name: 'Tomas Nel',
        matched_task_id: null,
        project_ids: [],
        is_agent: false,
        last_seen: now - 60000,
      },
    ],
  },
  '/api/v1/capacity': {
    enabled: true,
    people: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        active_sessions: 2,
        in_progress_tasks: ['t1', 't2'],
        oldest_in_progress_ms: 5 * 3600000,
        tasks_in_review: ['t3'],
        last_seen: now,
        unlisted: ['n1'],
      },
      {
        user_id: 'u2',
        name: 'Tomas Nel',
        active_sessions: 1,
        in_progress_tasks: [],
        oldest_in_progress_ms: null,
        tasks_in_review: [],
        last_seen: now - 60000,
        unlisted: [],
      },
      {
        user_id: 'u3',
        name: 'Priya Raman',
        active_sessions: 0,
        in_progress_tasks: ['t2'],
        oldest_in_progress_ms: 40 * 60000,
        tasks_in_review: [],
        last_seen: null,
        unlisted: [],
      },
    ],
  },
  '/api/v1/tasks/t1': task('t1', 'LAI-9', 'Parity tests for the MCP tools', 'in_progress'),
  '/api/v1/tasks/t2': task('t2', 'LAI-12', 'Heartbeat retention job', 'in_progress'),
  '/api/v1/tasks/t3': task('t3', 'LAI-15', 'Rate limit headers', 'review'),
  '/api/v1/unlisted': {
    data: [
      {
        id: 'n1',
        user_id: 'u1',
        token_id: 'tok1',
        repo: 'PawanSirsat/Laika',
        note: 'The migration runner logs a warning nobody reads on every boot.',
        promoted_task_id: null,
        dismissed_at: null,
        created_at: now - 3600000,
      },
    ],
    next_cursor: null,
  },
};

const T = (id: string, key: string, title: string, status: string, assignee: string | null) => ({
  id,
  key,
  project_id: 'p1',
  number: Number(key.split('-')[1]),
  title,
  description_md: null,
  acceptance_md: null,
  status,
  priority: 'p2',
  assignee_id: assignee,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: false,
  stale_flagged_at: null,
  blocked: false,
  blocked_by: [],
  blocks: [],
  tags: [],
  comment_count: 0,
  branch: null,
  external_ref: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
});

const STUB: ApiStub = {
  ...PRESENCE_STUB,
  '/api/v1/projects/laika-core/tasks': {
    data: [
      T('t1', 'LAI-9', 'Parity tests', 'in_progress', 'u1'),
      T('t9', 'LAI-20', 'Something to do', 'todo', null),
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead', created_at: 1 },
      { user_id: 'u2', name: 'Tomas Nel', email: 't@example.com', role: 'member', created_at: 1 },
    ],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

void after(async () => {
  await closeBrowser();
});

/*
 * **The row is gone from the Board (LAI-727)**, on the owner's word: *"then
 * also remove this row, that's it."* Three tests here asserted what the row
 * drew, and each property still holds where presence is still drawn:
 *
 * - *the withheld person is still a person, in both themes* —
 *   `capacity.test.ts`, "a person with no visible repo renders as a person";
 * - *an agent is marked and a human is not* — `capacity.test.ts`, "an agent
 *   session is marked, and a human is not"; and `activity-tab.test.ts`,
 *   "lists real agent sessions, and only agents";
 * - *nobody working says so* — `activity-tab.test.ts`, "no agent working
 *   says so".
 *
 * All three render through the one `PresencePerson`, which the row also used.
 * What is left to assert on the Board is that the row stays gone in the state
 * it used to draw in, and that the count the header still takes from
 * presence is unaffected.
 */
void describe('the Board has no WORKING NOW row (LAI-727)', () => {
  void test('people present: no row, and the header still counts the agents', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.board').first().waitFor({ timeout: 20_000 });
      // Positive control: presence did land — one of the two sessions is an agent.
      await h.page.waitForFunction(
        () =>
          /Agents\s*1/.test(
            [...document.querySelectorAll('.space-chip')].map((e) => e.textContent ?? '').join(' '),
          ),
        undefined,
        { timeout: 20_000 },
      );
      await h.page.waitForTimeout(400);
      assert.equal(await h.page.locator('.presence').count(), 0, 'the row is drawn');
      assert.equal(await h.page.locator('.presence-chip').count(), 0, 'a presence chip is drawn');
      assert.doesNotMatch(await h.page.locator('body').innerText(), /WORKING NOW/);
    } finally {
      await h.close();
    }
  });

  void test('presence off: still no row, and no heading', async () => {
    // LAI-440's AC3, which held before LAI-727 removed the row for everyone:
    // a permanent empty band on the main screen is a standing reproach for a
    // setting somebody chose.
    const off = { ...STUB, '/api/v1/presence': { enabled: false, present: [] } };
    const h = await open('/board?project=laika-core', off);
    try {
      await h.page.locator('.board').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(700);
      assert.equal(await h.page.locator('.presence').count(), 0, 'the strip survived');
      assert.doesNotMatch(
        await h.page.locator('body').innerText(),
        /WORKING NOW/,
        'the heading is still on the page',
      );
      /*
       * The `Agent sessions` card moved to the Activity tab with the rest of
       * the rail (LAI-281), so the board has none to hide. That the panel
       * itself respects `presence.enabled` is asserted where it now lives.
       */
    } finally {
      await h.close();
    }
  });
});
