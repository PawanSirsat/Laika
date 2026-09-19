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
  /*
   * **The by-slug response, as the server really sends it** (LAI-259).
   *
   * `task_counts`, `blocked_count`, `member_count`, `members` and
   * `last_activity_at` are derived by the *list* endpoint; `GET
   * /projects/:slug` returns the plain §4.3 row. This fixture used to be
   * `CORE` — the list shape — and that is exactly why "No space" reached a
   * real instance: the bar built a `Space` from fields only the list carries,
   * threw, and the fixture was generous enough to hide it.
   */
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
    created_at: CORE.created_at,
    updated_at: CORE.updated_at,
  },
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
      /*
       * **Wait for the name, not for the element.**
       *
       * The rail renders the listed name first, so `.sidebar-wordmark` exists from the
       * first paint carrying `laika-core`, and `GET /projects/:slug` replaces
       * it a beat later. Waiting on the element therefore returns on the
       * *fallback*, and this asserted against whichever of the two the machine
       * happened to be showing — green most runs, red about one in two under
       * load. The fallback is correct behaviour; the assertion was racing it.
       */
      /*
       * **The identity moved to the rail** (LAI-295). The bar carried the
       * project name and icon while the rail two inches away said `Laika`;
       * the owner asked for the rail to name the project and the bar to stop
       * repeating it.
       *
       * The race this test was written for is unchanged and still the point:
       * the wordmark renders the listed name first and the by-slug answer a
       * beat later, so waiting on the *element* returns on the fallback.
       * Wait for the value.
       */
      await h.page.locator('.sidebar-wordmark').waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(
        () => document.querySelector('.sidebar-wordmark')?.textContent === 'Laika Core',
        undefined,
        { timeout: 15_000 },
      );

      assert.equal(await h.page.locator('.sidebar-wordmark').innerText(), 'Laika Core');
      assert.equal(await h.page.locator('.sidebar-orgline').innerText(), 'Borealis Labs');

      // And the bar no longer draws either — moved, not copied.
      assert.equal(await h.page.locator('.space-name').count(), 0);
      assert.equal(await h.page.locator('.space-icon').count(), 0);

      /*
       * Four avatars and `+2`, from six real members — never the design's four
       * fixtures.
       *
       * **Asserted on the timeline since LAI-293.** The faces are an assignee
       * filter, so on the *board* they now live in that view's own row and the
       * bar correctly has none. The property this protects — real members,
       * clustered, never fixtures — is unchanged; only the view it must be
       * measured on moved.
       */
      const t = await open('/timeline?project=laika-core', STUB);
      try {
        await t.page.locator('.space-member').first().waitFor({ timeout: 20_000 });
        assert.equal(await t.page.locator('.space-member').count(), 4);
        assert.equal(await t.page.locator('.space-member-more').innerText(), '+2');
      } finally {
        await t.close();
      }

      const bar = await h.page.locator('#sidebar').innerText();
      assert.doesNotMatch(bar, /Mira Kellner/);
    } finally {
      await h.close();
    }
  });

  void test('names the space from the by-slug response, not the list', async () => {
    // The regression: the headline read "No space" over a project that
    // plainly existed, on every screen, because the bar wanted list-only
    // fields. Asserted against a fixture shaped like the real endpoint.
    const h = await open('/board?project=laika-core', STUB);
    try {
      const name = h.page.locator('.sidebar-wordmark');
      await name.waitFor({ timeout: 20_000 });
      await h.page.waitForFunction(
        () => document.querySelector('.sidebar-wordmark')?.textContent === 'Laika Core',
        undefined,
        { timeout: 10_000 },
      );
      assert.equal(await name.innerText(), 'Laika Core');
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

      /*
       * **A dropdown since LAI-270**, as the reference has it — selecting is
       * what writes the URL, not pressing a button until it cycles round.
       * **Behind `Filter` since LAI-290**, for the same reason: the bar drew it
       * twice once the board had its own toolbar. What this test protects is
       * unchanged — choosing a priority writes `?priority=`.
       */
      await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
      await h.page
        .locator('.bt-field', { hasText: 'Priority' })
        .locator('select')
        .selectOption('p1');
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
      // `Grace H.` in a chip (LAI-271); the full name is on the Capacity row.
      assert.match(await strip.innerText(), /Grace H\./);

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
      await h.page.locator('.sidebar-wordmark').waitFor({ timeout: 20_000 });

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

/**
 * One control per filter, wherever the filter lives (LAI-290).
 *
 * The board grew its own `Filter` button while the bar kept Priority, Tag,
 * Assignee and Ready-only inline, so each of those four was drawn **twice**,
 * both copies writing the same URL param. Two controls for one piece of state
 * is a defect even when they agree — they disagree the moment one is changed
 * from a link.
 *
 * The other half is why the bar's copies are *hidden* and not deleted: every
 * non-board view of a space has no toolbar, and the bar is the only filtering
 * it has.
 */
void describe('the bar does not draw filters a view already owns', () => {
  void test('the board shows one priority control, not two', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.bt-button').first().waitFor({ timeout: 20_000 });

      assert.equal(
        await h.page.locator('.space-select').count(),
        0,
        'the bar is still drawing its own filters while the board owns them',
      );
      assert.equal(
        await h.page.locator('.bt-button', { hasText: 'Filter' }).count(),
        1,
        'the board lost its Filter button',
      );
    } finally {
      await h.close();
    }
  });

  void test('a view with no toolbar keeps the bar’s own filters', async () => {
    // The regression the obvious fix would have caused: deleting the four from
    // `SpaceTopBar` strips filtering from Timeline, Calendar and Capacity,
    // which have nowhere else to put it.
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.space-bar').waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(400);

      assert.equal(
        await h.page.locator('.bt-button', { hasText: 'Filter' }).count(),
        0,
        'the timeline has a board toolbar — this test is no longer measuring anything',
      );
      assert.ok(
        (await h.page.locator('.space-select').count()) >= 2,
        'the timeline lost its filters — the bar is its only place for them',
      );
    } finally {
      await h.close();
    }
  });
});
