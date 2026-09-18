/**
 * The dashboard's activity feed is bounded (LAI-280).
 *
 * The owner's report, with a screenshot: 193 events rendered as 193 rows, so
 * the page ran to five screens and the rail floated beside a column of
 * repetition. The design's panel is a **card of fixed height whose rows
 * scroll** — the page stays one screen however much has happened.
 *
 * The property is not "few rows": every event is still reachable. It is that
 * the *page* does not grow with the feed.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

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
};

const NOW = Date.now();

/** Enough to dwarf any viewport — the shape of the owner's instance. */
const EVENTS = Array.from({ length: 180 }, (_, i) => ({
  id: `e${String(i)}`,
  seq: i,
  project_id: 'laika-core',
  task_id: i % 3 === 0 ? 't1' : null,
  actor_id: i % 4 === 0 ? 'u2' : 'u1',
  actor_kind: i % 4 === 0 ? 'agent' : 'user',
  type: 'task.updated',
  payload: null,
  created_at: NOW - i * 60_000,
}));

const TASK = {
  id: 't1',
  key: 'LC-1',
  number: 1,
  project_id: 'laika-core',
  title: 'A task',
  description_md: '',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: NOW - 3_600_000,
  started_at: null,
  completed_at: null,
};

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: 1, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 2,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [TASK], next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' },
      { user_id: 'u2', name: 'Grace Hopper', email: 'g@example.com', role: 'member' },
    ],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: EVENTS, next_cursor: null },
  '/api/v1/projects/laika-core/metrics': { since: 1, throughput: [], cycle_time: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

void after(async () => {
  await closeBrowser();
});

void describe('the activity feed', () => {
  void test('scrolls inside its card rather than growing the page', async () => {
    const h = await open('/dashboard?project=laika-core', STUB);
    try {
      await h.page.locator('.dash-event').first().waitFor({ timeout: 20_000 });

      const m = await h.page.evaluate(() => {
        const box = document.querySelector('.dash-feed-scroll');
        if (box === null) return null;
        return {
          rows: document.querySelectorAll('.dash-event').length,
          scrolls: box.scrollHeight > box.clientHeight,
          boxHeight: box.clientHeight,
          pageHeight: document.documentElement.scrollHeight,
          viewport: window.innerHeight,
        };
      });
      assert.ok(m !== null, 'the feed has no scroll container');

      /*
       * **Positive control.** Every assertion below is about restraint, and a
       * feed that rendered nothing would satisfy all of them.
       */
      assert.ok(m.rows > 100, `only ${String(m.rows)} rows — the fixture did not load`);

      assert.ok(m.scrolls, 'the feed does not scroll; the rows must be reachable');

      /*
       * **The page must not scale with the feed.**
       *
       * Not "the page fits the viewport" — on a short window some scrolling is
       * honest, and asserting otherwise only encodes the harness's 720px.
       *
       * And not "180 events look like 3" either: the panel is *allowed* to grow
       * up to its cap, and below the cap a longer feed is a taller card, which
       * is right. The defect was growth with **no** cap. So: two feeds that both
       * exceed it — double the events, and the page must be the same height to
       * the pixel.
       */
      const twice = await open('/dashboard?project=laika-core', {
        ...STUB,
        '/api/v1/projects/laika-core/activity': {
          data: [...EVENTS, ...EVENTS.map((e) => ({ ...e, id: `x${e.id}`, seq: e.seq + 1000 }))],
          next_cursor: null,
        },
      });
      try {
        await twice.page.locator('.dash-event').first().waitFor({ timeout: 20_000 });
        const doubled = await twice.page.evaluate(() => ({
          rows: document.querySelectorAll('.dash-event').length,
          page: document.documentElement.scrollHeight,
        }));
        assert.ok(doubled.rows > m.rows, 'the doubled fixture did not load');
        assert.equal(
          doubled.page,
          m.pageHeight,
          `${String(doubled.rows)} events make the page ${String(doubled.page)}px where ${String(m.rows)} make it ${String(m.pageHeight)}px`,
        );
      } finally {
        await twice.close();
      }
      // And the box is a real panel, not collapsed to nothing.
      assert.ok(m.boxHeight > 120, `the feed box is only ${String(m.boxHeight)}px tall`);
    } finally {
      await h.close();
    }
  });

  void test('the filter counts reconcile with the list', async () => {
    const h = await open('/dashboard?project=laika-core', STUB);
    try {
      await h.page.locator('.dash-filter').first().waitFor({ timeout: 20_000 });

      const counts = await h.page
        .locator('.dash-filter-count')
        .evaluateAll((els: Element[]) => els.map((e) => Number(e.textContent ?? '0')));
      assert.equal(counts.length, 3);

      /*
       * `All` once read 145 beside `People` 155 — a filter claiming to show
       * more than everything, because the tallies counted the whole range while
       * the buttons filter the visible list.
       */
      assert.equal(
        counts[0],
        (counts[1] ?? 0) + (counts[2] ?? 0),
        `All ${String(counts[0])} != People ${String(counts[1])} + Agents ${String(counts[2])}`,
      );
      assert.ok(
        (counts[2] ?? 0) > 0,
        'the fixture has agent events; the split proves nothing at 0',
      );
    } finally {
      await h.close();
    }
  });

  void test('a row reads when · who · what · which task', async () => {
    const h = await open('/dashboard?project=laika-core', STUB);
    try {
      const row = h.page.locator('.dash-event').first();
      await row.waitFor({ timeout: 20_000 });

      // The design's order, left to right. `USER` down every row was the thing
      // the eye hit first and the thing that never varied.
      assert.equal(await row.locator('.dash-kind').count(), 0, 'the actor-kind badge is back');
      assert.equal(await row.locator('.dash-when').count(), 1);
      assert.equal(await row.locator('.dash-avatar').count(), 1);

      const when = await row.locator('.dash-when').boundingBox();
      const avatar = await row.locator('.dash-avatar').boundingBox();
      const what = await row.locator('.dash-what').boundingBox();
      assert.ok(when !== null && avatar !== null && what !== null);
      assert.ok(when.x < avatar.x, 'the time must lead the row');
      assert.ok(avatar.x < what.x, 'the avatar sits between the time and the sentence');
    } finally {
      await h.close();
    }
  });

  void test('an agent row is marked, and a person’s is not', async () => {
    const h = await open('/dashboard?project=laika-core', STUB);
    try {
      await h.page.locator('.dash-event').first().waitFor({ timeout: 20_000 });

      await h.page.locator('.dash-filter', { hasText: 'Agents' }).click();
      await h.page.waitForFunction(
        () => document.querySelectorAll('.dash-event').length > 0,
        undefined,
        { timeout: 10_000 },
      );
      const agentRows = await h.page.locator('.dash-event .dash-avatar-bot').count();
      assert.ok(agentRows > 0, 'no agent row carries the mark');

      await h.page.locator('.dash-filter', { hasText: 'People' }).click();
      await h.page.waitForFunction(
        () => document.querySelectorAll('.dash-event').length > 0,
        undefined,
        { timeout: 10_000 },
      );
      assert.equal(
        await h.page.locator('.dash-event .dash-avatar-bot').count(),
        0,
        'a person’s row is marked as an agent',
      );
    } finally {
      await h.close();
    }
  });
});
