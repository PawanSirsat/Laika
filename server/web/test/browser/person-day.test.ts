/**
 * Somebody else's day, read (D-102, LAI-957's endpoints, LAI-959), in a real
 * browser on the pinned clock (LAI-954):
 *
 *  - an owner reads a member's My day **read only**, under a banner — no
 *    confirm, edit, break, add or undo control is drawn, the keys write
 *    nothing, and nothing but `GET /people/:id/time` is asked for the day;
 *  - **Viewing: Me ▾** is drawn for whoever holds the capability — by the
 *    server's `me.actions`, not the role — and for nobody else;
 *  - a `?user=` the reader may not read is the not-allowed state, asked of
 *    nobody;
 *  - the person's own My day lists **who looked at my time**;
 *  - a member's profile has **Day** and **Hours** tabs from the same read.
 *
 * Screenshots of the owner's view of a member's day, and of the member's own
 * list, light and dark at 1440 and 390, land in `LAIKA_SHOTS` when it is set.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { NOW, open } from './my-day-clock.ts';
import { at, TODAY, viewOf, weekData, weekStub, YESTERDAY } from './my-day-week.ts';

const ADA = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};
const GRACE = {
  ...ADA,
  id: 'u2',
  email: 'g@example.com',
  name: 'Grace Hopper',
  org_role: 'member',
};

const USERS = {
  data: [ADA, GRACE].map((u) => ({ ...u, created_at: 1, updated_at: 1 })),
  next_cursor: null,
};

/** `GET /permissions` with exactly these org actions for the reader. */
const permissions = (role: string, actions: readonly string[]) => ({
  org_roles: ['owner', 'admin', 'member', 'viewer'],
  project_roles: ['lead', 'member', 'viewer'],
  permissions: [],
  me: {
    org_role: role,
    credential: 'session',
    project_scope: 'all',
    implicit_project_role: null,
    actions,
    projects: [],
  },
});

const HOLDS = ['people.analytics.read', 'profile.read', 'profile.activity.read'];

const LOOKED = {
  data: [
    {
      id: 'v2',
      viewer: { id: 'u1', name: 'Ada Lovelace' },
      kind: 'time',
      day: YESTERDAY,
      viewed_at: at(TODAY, 14, 2),
    },
    {
      id: 'v1',
      viewer: { id: 'u1', name: 'Ada Lovelace' },
      kind: 'local_activity',
      day: null,
      viewed_at: at(YESTERDAY, 9, 10),
    },
  ],
  next_cursor: null,
};

/**
 * The reader `me`, with `actions` from `/permissions`, and Grace's week served
 * at `/people/u2/time` — the very answer her own `/me/time` gives, as the
 * server's is (LAI-957).
 */
function stub(me: typeof ADA, actions: readonly string[]): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes['/api/v1/me'] = me;
  routes['/api/v1/permissions'] = permissions(me.org_role, actions);
  routes['/api/v1/users'] = USERS;
  routes['/api/v1/me/analytics-views'] = LOOKED;
  for (let i = -21; i <= 21; i += 1) {
    const day = new Date(Date.parse(`${TODAY}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    routes[`/api/v1/people/u2/time?day=${day}`] = () => ({
      ...(viewOf(day, data) as Record<string, unknown>),
      // Grace's note for the day (LAI-503), for whoever reads it.
      day_note:
        day === TODAY
          ? { day, note: 'Two meetings ran long; the rest was heads-down.', updated_at: 1 }
          : null,
    });
  }
  routes['/api/v1/people/u2/local-activity'] = {
    start: YESTERDAY,
    end: TODAY,
    tz: 'UTC',
    days: [
      {
        day: TODAY,
        prompts_by_agent: { 'claude-code': 12 },
        sessions: 3,
        commits_local: 2,
        pushed_commits: 4,
        tokens: 120_000,
        cache_read: 0,
      },
    ],
    collectors: 1,
    oldest_day: YESTERDAY,
  };
  return routes;
}

const SHOTS = process.env.LAIKA_SHOTS;

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function openAt(path: string, routes: ApiStub, width = 1440): Promise<Harness> {
  return open(path, routes, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
}

const writes = (h: Harness) => h.calls.filter((c) => c.method !== 'GET');

/**
 * What changes a day. **Each is drawn on the reader's own day** — the test
 * below proves it — so their absence from somebody else's is the read-only
 * mode at work, not a selector that matches nothing.
 */
const WRITE_CONTROLS = [
  '[data-confirm-day]',
  '.inspector-confirm',
  '.myday-check',
  '[data-day-settings]',
  '[data-add-time]',
  '[data-timer-start]',
];

after(async () => {
  await closeBrowser();
});

void describe('an owner reads a member’s day (D-102, LAI-959)', () => {
  void test('her own day draws every write control the read-only view must not', async () => {
    const h = await openAt(`/my-day?day=${TODAY}`, stub(ADA, HOLDS));
    try {
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      // Nothing is in hand on load (LAI-511): the first block, picked.
      await h.page.locator('[data-block-select]').first().click();
      await h.page.locator('[data-inspector="draft"]').waitFor({ timeout: 10_000 });
      for (const selector of WRITE_CONTROLS) {
        assert.ok((await h.page.locator(selector).count()) > 0, `${selector} is not drawn`);
      }
      assert.ok((await h.page.locator('.dayline-edge').count()) > 0, 'no edge to drag');
      assert.equal(await h.page.locator('[data-viewing-banner]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('read only, under a banner: no confirm, edit, break, add or undo — and the keys write nothing', async () => {
    const h = await openAt(`/my-day?user=u2&day=${TODAY}`, stub(ADA, HOLDS));
    try {
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      await h.page.locator('[data-viewing-banner]').waitFor({ timeout: 10_000 });
      await until(async () =>
        (await h.page.locator('[data-viewing-banner]').innerText()).includes('Grace Hopper'),
      );
      const banner = await h.page.locator('[data-viewing-banner]').innerText();
      assert.match(banner, /Viewing Grace Hopper’s day — read only/);
      // Her note for the day, under the banner (LAI-503).
      assert.match(
        await h.page.locator('[data-day-note]').innerText(),
        /Grace Hopper’s note for .*Two meetings ran long/,
      );
      assert.match(await h.page.locator('h1').first().innerText(), /Grace Hopper’s day/);

      // Her drafts are there to read …
      assert.ok((await h.page.locator('[data-settle-row]').count()) > 0, 'no drafted rows drawn');
      // … and nothing to change them with.
      for (const selector of WRITE_CONTROLS) {
        assert.equal(await h.page.locator(selector).count(), 0, `${selector} is drawn`);
      }
      for (const word of ['Mark as break', 'Add time here', 'Not work', 'Split in two', 'Undo']) {
        assert.equal(
          await h.page.getByRole('button', { name: word, exact: true }).count(),
          0,
          `a "${word}" button is drawn`,
        );
      }

      // Pick a draft, then a gap: the inspector reads, and still offers nothing.
      await h.page.locator('[data-block-select]').first().click();
      await h.page.locator('[data-inspector="draft"]').waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('.dayline-edge').count(), 0, 'a selected block drags');
      assert.equal(await h.page.locator('[data-inspector] .myday-chip').count(), 0);
      await h.page.keyboard.press('Enter');
      await h.page.keyboard.press('g');
      await h.page.keyboard.press('x');
      const gap = h.page.locator('.dayline-gap').first();
      if ((await gap.count()) > 0) {
        await gap.click();
        await h.page.locator('[data-inspector="gap"]').waitFor({ timeout: 5_000 });
        assert.equal(await h.page.locator('[data-inspector] .myday-chip').count(), 0);
      }
      // A fixed window: nothing *should* happen, so nothing can end it early.
      await h.page.waitForTimeout(300);

      assert.deepEqual(writes(h), [], 'something was written');
      const paths = h.calls.map((c) => c.path);
      assert.ok(paths.includes('/api/v1/people/u2/time'), 'her day was not read');
      assert.ok(!paths.includes('/api/v1/me/time'), 'the reader’s own day was read instead');
      assert.ok(!paths.includes('/api/v1/me/analytics-views'), 'the reader’s own list was read');
    } finally {
      await h.close();
    }
  });

  void test('Viewing: Me ▾ picks her, and the URL carries ?user=', async () => {
    const h = await openAt(`/my-day?day=${TODAY}`, stub(ADA, HOLDS));
    try {
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      const trigger = h.page.locator('[data-viewing-switch] button').first();
      await trigger.waitFor({ timeout: 10_000 });
      assert.match(await trigger.innerText(), /Viewing:\s*Me/);
      await trigger.click();
      await h.page.getByRole('option', { name: /Grace Hopper/ }).click();
      await until(() => new URL(h.page.url()).searchParams.get('user') === 'u2');
      assert.equal(new URL(h.page.url()).searchParams.get('user'), 'u2');
      await h.page.locator('[data-viewing-banner]').waitFor({ timeout: 10_000 });
      assert.match(await trigger.innerText(), /Viewing:\s*Grace Hopper/);
    } finally {
      await h.close();
    }
  });

  void test('the capability, not the role: a member the owner granted it gets the switcher and her day', async () => {
    const me = { ...ADA, org_role: 'member' };
    const h = await openAt(`/my-day?user=u2&day=${TODAY}`, stub(me, HOLDS));
    try {
      await h.page.locator('[data-viewing-banner]').waitFor({ timeout: 20_000 });
      // The header's controls land in their slot a frame after the page.
      await until(async () => (await h.page.locator('[data-viewing-switch]').count()) === 1);
      assert.equal(await h.page.locator('[data-viewing-switch]').count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('a reader without it (D-102 rule 6)', () => {
  void test('has no switcher on their own day', async () => {
    const me = { ...ADA, org_role: 'member' };
    const h = await openAt(`/my-day?day=${TODAY}`, stub(me, ['local_activity.read_own']));
    try {
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      // Until /permissions answers the role decides, and a member's says no.
      await until(() => h.calls.some((c) => c.path === '/api/v1/permissions'));
      await h.page.waitForTimeout(300);
      assert.equal(await h.page.locator('[data-viewing-switch]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('is shown the not-allowed state on ?user=, and nobody’s day is asked for', async () => {
    const me = { ...ADA, org_role: 'member' };
    const h = await openAt(`/my-day?user=u2&day=${TODAY}`, stub(me, ['local_activity.read_own']));
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.state-forbidden').innerText(), /do not have access/);
      assert.ok(!h.calls.some((c) => c.path.startsWith('/api/v1/people/')), 'her day was asked');
      assert.equal(await h.page.locator('[data-myday-ready]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('an admin the owner took it from: the server’s answer wins over the role', async () => {
    const me = { ...ADA, org_role: 'admin' };
    const h = await openAt(`/my-day?user=u2&day=${TODAY}`, stub(me, ['profile.read']));
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-viewing-switch]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('who looked at my time (D-102 rule 3)', () => {
  void test('the person’s own My day lists who looked, at what, and when', async () => {
    const me = { ...GRACE };
    const h = await openAt(`/my-day?day=${TODAY}`, stub(me, ['local_activity.read_own']));
    try {
      // Who looked is a header button since LAI-502: the eye, with how many looks.
      const eye = h.page.locator('[data-who-looked] > button');
      await eye.waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('[data-looked-count]').count()) === 1);
      assert.equal(await h.page.locator('[data-looked-count]').innerText(), '2');
      await eye.click();
      await h.page.locator('[data-looked]').first().waitFor({ timeout: 20_000 });
      const rows = await h.page.locator('[data-looked]').allInnerTexts();
      assert.equal(rows.length, 2);
      assert.match(rows[0] ?? '', /Ada Lovelace looked at your day for/);
      assert.match(rows[0] ?? '', /2:02 PM today/);
      assert.match(rows[1] ?? '', /Ada Lovelace looked at your shared local activity/);
      // Who can look, in the words the rest of My day uses (LAI-968).
      assert.match(
        await h.page.locator('[data-who-looked]').innerText(),
        /can be read by owners, admins and anyone the owner lets see everyone’s analytics/,
      );
      assert.ok(h.calls.some((c) => c.path === '/api/v1/me/analytics-views'));
    } finally {
      await h.close();
    }
  });
});

void describe('who reads drafts is said on the person’s own day (D-102, LAI-968)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the header names who reads drafts, and its link brings who looked into view`, async () => {
      const h = await openAt(
        `/my-day?day=${TODAY}`,
        stub({ ...GRACE }, ['local_activity.read_own']),
      );
      try {
        await h.page.locator('[data-who-looked] > button').waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        // The design's one link (LAI-509): its words say who reads drafts.
        const lock = h.page.locator('.screen-page .myday-lock');
        assert.match(await lock.innerText(), /Who can see this/);
        assert.match((await lock.getAttribute('title')) ?? '', /Drafts: you, owners and admins/);
        assert.match(
          (await lock.getAttribute('title')) ?? '',
          /owners, admins and anyone the owner lets see everyone’s analytics/,
        );
        const link = h.page.locator('.screen-page').getByRole('link', { name: 'Who can see this' });
        assert.equal(await link.count(), 1);
        // Readable in both themes: a colour, and not the page's own background.
        const ink = await link.evaluate((el) => getComputedStyle(el).color);
        const ground = await h.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.notEqual(ink, ground);
        // The link opens Who looked (LAI-502), where the side card used to be scrolled to.
        await link.click();
        await h.page.locator('[data-looked]').first().waitFor({ timeout: 20_000 });
        const looked = h.page.locator('[data-who-looked]');
        const box = await looked.boundingBox();
        assert.ok(box !== null && box.y >= 0 && box.y < 900, `who looked is at ${String(box?.y)}`);
        assert.deepEqual(writes(h), []);
        await shoot(h.page, `drafts-readers-${theme}-1440`);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('a member’s profile: Day and Hours (LAI-959)', () => {
  const PROFILE = {
    user: {
      id: 'u2',
      name: 'Grace Hopper',
      email: 'g@example.com',
      org_role: 'member',
      is_active: true,
      profile_kind: 'manager',
      created_at: NOW - 200 * 86_400_000,
    },
    window: { weeks: 12, since: NOW - 84 * 86_400_000, until: NOW },
    projects: [],
    review: {
      accepted: 0,
      sent_back: 0,
      last_30_days: 0,
      per_week: [],
      time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
      recent: [],
    },
    ratings: [],
    ratings_total: 0,
    activity_sharing: { org_enabled: false, enabled: false },
    queue: { projects_led: 0, waiting: 0, oldest_waiting_since: null, projects: [] },
  };

  const profileStub = (): ApiStub => ({
    ...stub(ADA, HOLDS),
    '/api/v1/users/u2/profile': PROFILE,
  });

  void test('Day is her My day, read only, with what the board holds as she sees it', async () => {
    const h = await openAt(`/people?user=u2&tab=day&day=${TODAY}`, profileStub());
    try {
      await h.page.locator('[data-profile-tab="day"][aria-current="page"]').waitFor({
        timeout: 20_000,
      });
      await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('[data-viewing-banner]').innerText(),
        /Viewing Grace Hopper’s day — read only/,
      );
      assert.equal(await h.page.locator('[data-confirm-day], .myday-check').count(), 0);
      await h.page
        .locator('[data-person-local-activity] .share-table')
        .waitFor({ timeout: 10_000 });
      assert.match(
        await h.page.locator('[data-person-local-activity]').innerText(),
        /Claude Code 12/,
      );
      assert.deepEqual(writes(h), []);
    } finally {
      await h.close();
    }
  });

  void test('Hours is her week, day by day, with the week’s totals', async () => {
    const h = await openAt(`/people?user=u2&tab=hours&day=${TODAY}`, profileStub());
    try {
      await h.page.locator('[data-hours]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-hours-day]').count(), 7);
      assert.match(await h.page.locator('[data-hours-note]').innerText(), /Two meetings ran long/);
      const week = viewOf(TODAY) as {
        week: { confirmed_minutes: number; drafted_minutes: number }[];
      };
      const confirmed = week.week.reduce((n, d) => n + d.confirmed_minutes, 0);
      assert.ok(confirmed > 0, 'the fixture week has no confirmed time');
      const text = (await h.page.locator('[data-hours-confirmed]').innerText()).trim();
      const h_ = Math.floor(confirmed / 60);
      const m = confirmed % 60;
      const want =
        h_ === 0
          ? `${String(m)} min`
          : m === 0
            ? `${String(h_)} h`
            : `${String(h_)} h ${String(m)} min`;
      assert.equal(text, want);
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, both widths', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      void test(`${theme} at ${String(width)}: the owner’s view of her day, and her list, fit the page`, async () => {
        const h = await openAt(`/my-day?user=u2&day=${TODAY}`, stub(ADA, HOLDS), width);
        try {
          await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
          await setTheme(h.page, theme);
          await until(async () =>
            (await h.page.locator('[data-viewing-banner]').innerText()).includes('Grace'),
          );
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 0, `the page scrolls sideways by ${String(overflow)}px`);
          const box = await h.page.locator('[data-viewing-banner]').boundingBox();
          assert.ok(box !== null && box.width > 0 && box.x >= 0 && box.x + box.width <= width);
          await shoot(h.page, `owner-views-member-day-${theme}-${String(width)}`);
        } finally {
          await h.close();
        }

        const own = await openAt(
          `/my-day?day=${TODAY}`,
          stub({ ...GRACE }, ['local_activity.read_own']),
          width,
        );
        try {
          await own.page.locator('[data-who-looked] > button').waitFor({ timeout: 20_000 });
          await setTheme(own.page, theme);
          const overflow = await own.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(overflow <= 0, `the page scrolls sideways by ${String(overflow)}px`);
          await own.page.locator('[data-who-looked] > button').click();
          await own.page.locator('[data-looked]').first().waitFor({ timeout: 20_000 });
          await shoot(own.page, `member-who-looked-${theme}-${String(width)}`);
        } finally {
          await own.close();
        }
      });
    }
  }
});
