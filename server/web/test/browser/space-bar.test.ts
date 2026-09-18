/**
 * The space bar: identity, controls, tabs and presence (LAI-251).
 *
 * What only a browser can show: the geometry the design specifies, that the
 * controls actually write to the URL, that one stream serves the whole space,
 * and that the bar fits at every width in both themes.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, type ApiStub, type StubCall } from './harness.ts';

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
  task_counts: { backlog: 2, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 6,
  members: [],
  last_activity_at: 2,
};

const member = (id: string, name: string) => ({
  user_id: id,
  name,
  email: `${id}@example.com`,
  role: 'member',
  created_at: 1,
});

/** Six members, so the design's cluster overflows and `+2` is a real number. */
const MEMBERS = [
  member('u1', 'Ada Lovelace'),
  member('u2', 'Grace Hopper'),
  member('u3', 'Alan Turing'),
  member('u4', 'Edsger Dijkstra'),
  member('u5', 'Barbara Liskov'),
  member('u6', 'Tony Hoare'),
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
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: MEMBERS },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u2',
        name: 'Grace Hopper',
        is_agent: false,
        matched_task_id: null,
        project_ids: ['laika-core'],
        last_seen: 1,
      },
      {
        user_id: 'u7',
        name: 'claude-core',
        is_agent: true,
        matched_task_id: null,
        project_ids: ['laika-core'],
        last_seen: 1,
      },
    ],
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the space bar', () => {
  void test('renders the design’s identity row from real data', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-name').waitFor({ timeout: 20_000 });

      assert.equal(await h.page.locator('.space-name').innerText(), 'Laika Core');

      const icon = await h.page.locator('.space-icon').boundingBox();
      assert.ok(icon, 'the space icon is missing');
      assert.equal(Math.round(icon.width), 26, 'the icon is the design’s 26px square');

      // Four avatars and `+2`, from six real members — never the design's
      // four fixtures.
      assert.equal(await h.page.locator('.space-member').count(), 4);
      assert.equal(await h.page.locator('.space-member-more').innerText(), '+2');

      const bar = await h.page.locator('#sidebar').innerText();
      assert.doesNotMatch(bar, /Mira Kellner/);
    } finally {
      await h.close();
    }
  });

  void test('the LIVE pill reports the stream rather than always saying LIVE', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const pill = h.page.locator('.space-live');
      await pill.waitFor({ timeout: 20_000 });

      // The stub serves no `/events`, so the stream never reaches `ready` —
      // and the pill must say so instead of claiming to be live.
      const text = await pill.innerText();
      assert.notEqual(text, 'LIVE', 'the pill claims a stream it does not have');
      assert.match(text, /CONNECTING|OFFLINE/);
      const cls = (await pill.getAttribute('class')) ?? '';
      assert.doesNotMatch(cls, /space-live-live/);
    } finally {
      await h.close();
    }
  });

  void test('the agent count comes from presence, not from a fixture', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      // Wait for presence itself, not for the chip: the chip renders
      // immediately with `Agents 0` and would be read before the fetch lands.
      await h.page.locator('.presence-chip').first().waitFor({ timeout: 20_000 });
      const agents = h.page.locator('.space-chip', { hasText: 'Agents' });
      // One of the two present sessions is an agent.
      assert.match(await agents.innerText(), /Agents 1/);
    } finally {
      await h.close();
    }
  });

  void test('the controls write the URL, so a filtered space is a link', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-chip').first().waitFor({ timeout: 20_000 });

      await h.page.locator('.space-chip', { hasText: 'Agents' }).click();
      await h.page.waitForFunction(() => window.location.search.includes('agent=true'), undefined, {
        timeout: 5000,
      });

      const priority = h.page.locator('.space-chip', { hasText: /Any priority|^P\d$/ });
      await priority.click();
      await h.page.waitForFunction(
        () => window.location.search.includes('priority=p1'),
        undefined,
        {
          timeout: 5000,
        },
      );

      // And the project survives every one of them.
      assert.match(h.page.url(), /project=laika-core/);
    } finally {
      await h.close();
    }
  });

  void test('WORKING NOW sits above the view and filters it', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const strip = h.page.locator('.presence');
      await strip.waitFor({ timeout: 20_000 });
      assert.match(await strip.innerText(), /WORKING NOW/);
      // The heading renders before the fetch lands, so the strip reads
      // "Loading…" for a frame — wait for a chip rather than for the band.
      await h.page.locator('.presence-chip').first().waitFor({ timeout: 20_000 });
      assert.match(await strip.innerText(), /Grace Hopper/);

      await h.page.locator('.presence-chip').first().click();
      await h.page.waitForFunction(() => window.location.search.includes('assignee='), undefined, {
        timeout: 5000,
      });
    } finally {
      await h.close();
    }
  });

  void test('one stream for the space, not one per consumer', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-live').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(1200);

      // The pill, the presence strip, the board's cards and its rail all want
      // these frames. Opening a stream each would be four connections and four
      // replay windows per project.
      const streams = h.calls.filter((c: StubCall) => c.path === '/api/v1/events');
      assert.ok(
        streams.length <= 1,
        `the space opened ${String(streams.length)} event streams, not one`,
      );
    } finally {
      await h.close();
    }
  });

  void test('the bar fits, both themes, at every width', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.space-name').waitFor({ timeout: 20_000 });

      for (const theme of ['light', 'dark']) {
        // Back to a width where the rail is on-canvas: below 900px the sidebar
        // is translated off-screen and its theme control cannot be clicked.
        await h.page.setViewportSize({ width: 1440, height: 1000 });
        await setTheme(h.page, theme);
        for (const width of [1440, 1280, 900, 820, 420]) {
          await h.page.setViewportSize({ width, height: 1000 });
          await h.page.waitForFunction(
            (w: number) => document.documentElement.clientWidth === w,
            width,
            { timeout: 5000 },
          );
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.equal(
            overflow,
            0,
            `${theme} at ${String(width)}px overflows by ${String(overflow)}px`,
          );
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('the tabs are the design’s 34px, and the active one is underlined', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const active = h.page.locator('.view-tab-active');
      await active.waitFor({ timeout: 20_000 });

      const box = await active.boundingBox();
      assert.ok(box);
      assert.equal(Math.round(box.height), 34, 'a tab is the design’s 34px tall');

      const style = await active.evaluate((el) => {
        const s = getComputedStyle(el);
        return { border: s.borderBottomWidth, weight: s.fontWeight, colour: s.color };
      });
      assert.equal(style.border, '2px', 'the active tab carries the design’s 2px underline');
      assert.equal(style.weight, '700');
      // The underline and the text are the same accent, which is what makes
      // the state readable without relying on the colour alone.
      const inactive = await h.page
        .locator('.view-tab:not(.view-tab-active)')
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      assert.notEqual(style.colour, inactive, 'the active tab is not distinguished at all');
    } finally {
      await h.close();
    }
  });
});
