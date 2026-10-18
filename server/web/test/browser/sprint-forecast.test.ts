/**
 * The sprint forecast on the Sprints page (LAI-772, the R&D's idea 10): "85%
 * likely to finish 18–23 of 26" under a sprint still running or planned, said
 * as computed rather than typed, and nothing for a completed one.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, until, type ApiStub } from './harness.ts';

const DAY = 86_400_000;
const NOW = Date.now();

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 1, todo: 0, in_progress: 0, review: 0, done: 1, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const sprint = (id: string, name: string, status: string, from: number, to: number) => ({
  id,
  project_id: 'laika-core',
  name,
  goal: 'Ship it.',
  status,
  starts_on: NOW + from * DAY,
  ends_on: NOW + to * DAY,
  created_at: 1,
  updated_at: 1,
});

const task = (id: string, key: string, status: string, sprintId: string | null) => ({
  id,
  key,
  number: Number(key.split('-')[1]),
  project_id: 'laika-core',
  title: `Task ${key}`,
  description_md: '',
  acceptance_md: '',
  status,
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: sprintId,
  tags: [],
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: NOW,
  started_at: null,
  completed_at: null,
});

/** Four sprints, as the reference has. */
const SPRINTS = [
  sprint('s1', 'Event store & SSE', 'completed', -28, -15),
  sprint('s2', 'Agent sessions', 'completed', -14, -1),
  sprint('s3', 'Presence & capacity', 'active', 0, 13),
  sprint('s4', 'Publish & harden', 'planned', 14, 27),
];

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': { data: [CORE], next_cursor: null },
  '/api/v1/projects/laika-core': {
    id: CORE.id,
    slug: CORE.slug,
    prefix: CORE.prefix,
    name: CORE.name,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/projects/laika-core/tasks': {
    data: [task('t1', 'LC-1', 'backlog', 's3'), task('t2', 'LC-2', 'done', 's3')],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/sprints': { data: SPRINTS, next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  // Presence **on**, with somebody in it: the state WORKING NOW used to draw
  // its row in, so the band-order test's "not back" means something
  // (LAI-727). `enabled: false` made the row render nothing anyway.
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u2',
        name: 'Grace Hopper',
        is_agent: true,
        matched_task_id: null,
        project_ids: ['laika-core'],
        last_seen: NOW,
        repo: 'kvelld/laika',
        branch: 'lc-1',
      },
    ],
  },
};

const forecastFor = (id: string, total: number) => ({
  sprint_id: id,
  total,
  done: 1,
  forecast: { probability: 0.87, low: 18, high: 23, median: 20, days_left: 13 },
  reason: null,
  basis: { days: 42, tasks_done: 31, weight_done: 29.5 },
});

const WITH_FORECASTS: ApiStub = {
  ...STUB,
  '/api/v1/sprints/s3/forecast': forecastFor('s3', 26),
  '/api/v1/sprints/s4/forecast': {
    ...forecastFor('s4', 0),
    total: 0,
    done: 0,
    forecast: null,
    reason: 'no_tasks',
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the sprint forecast', () => {
  void test('says how many of a running sprint’s tasks are likely done, and asks nothing of a completed one', async () => {
    const h = await open('/sprints?project=laika-core', WITH_FORECASTS);
    try {
      await h.page.locator('.sprint-card').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.sprint-forecast').count()) > 0);
      const active = h.page.locator('.sprint-card-active');
      assert.equal(
        await active.locator('.sprint-forecast').innerText(),
        '87% likely to finish 18–23 of 26',
      );
      assert.match(
        (await active.locator('.sprint-forecast').getAttribute('title')) ?? '',
        /last 42 days \(31 tasks\) and the sizes left — not story points/,
      );
      // A planned sprint with nothing in it says nothing; completed ones are never asked.
      assert.equal(await h.page.locator('.sprint-card-planned .sprint-forecast').count(), 0);
      const asked = h.calls.map((c) => c.path).filter((p) => p.endsWith('/forecast'));
      assert.deepEqual([...new Set(asked)].sort(), [
        '/api/v1/sprints/s3/forecast',
        '/api/v1/sprints/s4/forecast',
      ]);
    } finally {
      await h.close();
    }
  });
});
