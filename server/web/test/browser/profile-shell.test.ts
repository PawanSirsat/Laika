/**
 * The profile's frame, in a real browser (SPEC §11.4.2.1, D-139, LAI-1152):
 * the breadcrumb and the notice, the head card with the availability pill
 * inline and the tabs inside it, ⋯ on someone else's, and on your own the
 * pill that edits your availability and *Who looked*. Both themes, and a
 * phone.
 *
 * The figures in the cards are member-profile.test.ts's; this file is the
 * chrome around them, and what D-139 item 8 took off the page.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { open, NOW } from './my-day-clock.ts';

const DAY = 86_400_000;

void after(async () => {
  await closeBrowser();
});

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const profileOf = (id: string, name: string, org_role = 'member') => ({
  user: {
    id,
    name,
    email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
    org_role,
    is_active: true,
    profile_kind: 'builder',
    created_at: NOW - 200 * DAY,
  },
  window: { weeks: 12, since: NOW - 84 * DAY, until: NOW },
  projects: [],
  review: {
    accepted: 0,
    sent_back: 0,
    last_30_days: 0,
    per_week: [],
    time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
    recent: [],
  },
  // A rating the API still serves (D-139 item 8): the page must not draw it.
  ratings: [
    {
      id: 'r1',
      score: 4,
      note: 'Steady under pressure',
      rated_by: { id: 'u9', name: 'Old Admin' },
      created_at: NOW - 10 * DAY,
    },
  ],
  ratings_total: 1,
  activity_sharing: { org_enabled: false, enabled: false },
  current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
  delivery: {
    accepted_per_week: [],
    accepted: 0,
    sent_back: 0,
    reopened: 0,
    cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
  },
  agents: {
    tokens: [],
    tokens_total: 0,
    online: { enabled: true, clients: [], last_seen: null },
    writes: [],
    writes_total: 0,
  },
});

const quietYear = () => {
  const days = 364;
  const zeros = () => new Array<number>(days).fill(0);
  return {
    range: '52w',
    start: new Date(NOW - (days - 1) * DAY).toISOString().slice(0, 10),
    end: new Date(NOW).toISOString().slice(0, 10),
    tz: 'UTC',
    sharing: { org_enabled: false, enabled: false },
    series: {
      github: null,
      local_commits: null,
      prompts: null,
      sessions: null,
      board_self: zeros(),
      board_agent: zeros(),
    },
    prompts_by_agent: {},
    agents: [],
  };
};

const quietUsage = (userId: string) => ({
  user_id: userId,
  from: '2026-07-27',
  to: '2026-10-18',
  weeks: [],
  totals: {
    tokens: 0,
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    attributed_tokens: 0,
    cost: { usd: 0, unpriced_tokens: 0, unpriced_models: [], unconfirmed_models: [] },
  },
  by_agent: [],
  by_model: [],
  no_token_data: [],
  sharing: { org_enabled: true, enabled: true },
});

const RECORD = {
  status: 'open',
  away: null,
  hours_per_week: 6,
  note: 'Happy to review front-end work',
  tags: ['Front-end', 'Reviews'],
  work_week: null,
  away_periods: [],
  updated_at: NOW - 3 * DAY,
};

/** Two looks inside the 30 days — one with a role, one from before LAI-1150 sent it — and one older. */
const LOOKS = {
  data: [
    {
      id: 'v1',
      viewer: { id: 'u7', name: 'Thabo Nkosi', org_role: 'admin' },
      kind: 'time',
      day: null,
      viewed_at: NOW - 2 * 60 * 60_000,
    },
    {
      id: 'v2',
      viewer: { id: 'u8', name: 'Lindiwe Dube' },
      kind: 'profile',
      day: null,
      viewed_at: NOW - 4 * DAY,
    },
    {
      id: 'v3',
      viewer: { id: 'u7', name: 'Thabo Nkosi', org_role: 'admin' },
      kind: 'usage',
      day: null,
      viewed_at: NOW - 40 * DAY,
    },
  ],
  next_cursor: null,
};

const BASE: ApiStub = {
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Borealis',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/users/u1/profile': profileOf('u1', 'Ada Owner', 'owner'),
  '/api/v1/users/u2/profile': profileOf('u2', 'Hemant Purohit'),
  '/api/v1/users/u1/usage': quietUsage('u1'),
  '/api/v1/users/u2/usage': quietUsage('u2'),
  '/api/v1/people/u1/activity': quietYear(),
  '/api/v1/people/u2/activity': quietYear(),
  // Your own (D-139 item 1, LAI-1150): every role reads these, and only these.
  '/api/v1/me/profile': profileOf('u1', 'Ada Owner', 'owner'),
  '/api/v1/me/activity': quietYear(),
  '/api/v1/me/analytics-views': LOOKS,
  '/api/v1/me': { ...person('u1', 'Ada Owner', 'owner'), memberships: [] },
  '/api/v1/people/availability': {
    data: [
      {
        user: { id: 'u2', name: 'Hemant Purohit' },
        availability: {
          status: 'capacity',
          note: 'Deep in payments',
          tags: ['Back-end'],
          away: null,
        },
        spaces: [],
      },
    ],
  },
  // An analytics reader's pill is this one person's load, never the list,
  // which logs a look at everyone it lists (LAI-1159).
  '/api/v1/people/u2/load': {
    availability: { status: 'capacity', note: 'Deep in payments', tags: ['Back-end'], away: null },
  },
};

/** An owner who also holds *See and manage anyone's developer setup* (D-132). */
const WITH_SETUP = (() => {
  const base = defaultPermissions({ ...person('u1', 'Ada Owner', 'owner'), memberships: [] }) as {
    me: { actions: string[] };
  };
  return { ...base, me: { ...base.me, actions: [...base.me.actions, 'developer_setup.read_any'] } };
})();

/** The wordings SPEC §11.4.2.1 gives the notice. */
const OTHER_NOTICE = 'Owners and admins only · read-only · Hemant can see that you looked';
const OWN_NOTICE = 'Owners and admins see a read-only copy · you can see who looked';

async function headReady(page: Page) {
  const head = page.locator('.prof-head');
  await head.waitFor({ timeout: 20_000 });
  return head;
}

/** What D-139 item 8 took off the profile is nowhere on it. */
async function assertRemoved(page: Page) {
  assert.equal(await page.locator('[data-section="rating"]').count(), 0, 'the rating card');
  assert.equal(await page.getByRole('button', { name: 'Rate' }).count(), 0, 'the Rate button');
  assert.equal(await page.getByText('Steady under pressure').count(), 0, 'a rating’s note');
  assert.equal(await page.locator('[data-section="decisions"]').count(), 0, 'recent decisions');
  assert.equal(await page.locator('[data-section="load"]').count(), 0, 'Current load');
  assert.equal(await page.getByText(/Show current load/).count(), 0, 'Show current load');
  assert.equal(await page.locator('.prof .prof-info').count(), 0, 'an (i)');
  assert.equal(
    await page.locator('.prof .screen-bar').count(),
    0,
    'the old “Member profile” header',
  );
}

/** Nothing on the page scrolls sideways at this width. */
async function assertFits(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 0, `${label}: scrolls sideways by ${String(overflow)}px`);
}

void describe('someone else’s profile (frame A)', () => {
  for (const theme of ['Dark', 'Light'] as const) {
    void test(`breadcrumb, notice, the pill inline and the tabs in the head card (${theme})`, async () => {
      const h = await open('/people?user=u2', { ...BASE, '/api/v1/permissions': WITH_SETUP });
      try {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        const head = await headReady(h.page);

        const crumbs = h.page.getByRole('navigation', { name: 'Breadcrumb' });
        await crumbs.getByText('Hemant Purohit').waitFor({ timeout: 10_000 });
        assert.equal(
          (await crumbs.innerText()).replace(/\s+/g, ' ').trim(),
          'Members / Hemant Purohit',
        );
        assert.equal(
          await crumbs.getByRole('link', { name: 'Members' }).getAttribute('href'),
          '/organisation?tab=people',
        );
        assert.equal(
          (await h.page.locator('[data-profile-notice]').innerText()).trim(),
          OTHER_NOTICE,
        );

        // The pill sits on the name's row, after the chip — never under the meta.
        const pill = head.locator(
          '.prof-name-row [data-profile-pill] [data-avail-pill="capacity"]',
        );
        await pill.waitFor({ timeout: 10_000 });
        assert.match(await pill.innerText(), /At capacity/);
        assert.equal(await h.page.locator('#prof-name').innerText(), 'Hemant Purohit');
        assert.match(
          await head.locator('[data-profile-availability]').innerText(),
          /“Deep in payments”\s*Back-end\s*set by Hemant/,
        );

        // Tabs inside the head card, Developer setup by its someone-else name.
        const tabs = head.locator('nav.prof-tabs [data-profile-tab]');
        assert.deepEqual(await tabs.allInnerTexts(), [
          'Overview',
          'Day',
          'Time report',
          'Developer setup',
        ]);
        // Someone else's head draws no Who looked, and no editor for their pill.
        assert.equal(await h.page.locator('[data-profile-who-looked]').count(), 0);
        assert.equal(await h.page.locator('[data-my-availability]').count(), 0);
        await assertRemoved(h.page);
        await assertFits(h.page, `1440 ${theme}`);
      } finally {
        await h.close();
      }
    });
  }

  void test('someone who has said nothing reads a dashed “Availability not set”', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/people/availability': {
        data: [
          {
            user: { id: 'u2', name: 'Hemant Purohit' },
            availability: { status: null, note: null, tags: [], away: null },
            spaces: [],
          },
        ],
      },
      '/api/v1/people/u2/load': {
        availability: { status: null, note: null, tags: [], away: null },
      },
    });
    try {
      const head = await headReady(h.page);
      const pill = head.locator('.prof-name-row [data-avail-pill="none"]');
      await pill.waitFor({ timeout: 10_000 });
      assert.match(await pill.innerText(), /Availability not set/);
      assert.equal(await pill.evaluate((el) => getComputedStyle(el).borderStyle), 'dashed');
      // Nothing said: no note line either.
      assert.equal(await head.locator('[data-profile-availability]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('⋯ holds Manage member…, Copy link to profile and See Hemant’s cards in Work', async () => {
    const h = await open('/people?user=u2', BASE, {
      before: async (page) => {
        await page.addInitScript(() => {
          const copied: string[] = [];
          (window as unknown as { __copied: string[] }).__copied = copied;
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: (text: string) => {
                copied.push(text);
                return Promise.resolve();
              },
            },
          });
        });
      },
    });
    try {
      await headReady(h.page);
      const more = h.page.locator('[data-profile-manage] button[aria-haspopup="menu"]');
      await more.click();
      const items = h.page.getByRole('menuitem');
      assert.deepEqual(
        (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
        [
          'Manage member… Role, spaces, security, deactivate',
          'Copy link to profile',
          'See Hemant’s cards in Work',
        ],
      );

      await h.page.getByRole('menuitem', { name: 'Copy link to profile' }).click();
      await until(
        async () =>
          (await h.page.evaluate(() => (window as unknown as { __copied: string[] }).__copied))
            .length > 0,
      );
      const copied = await h.page.evaluate(
        () => (window as unknown as { __copied: string[] }).__copied,
      );
      assert.deepEqual(copied, [`${h.origin}/people?user=u2`]);
      await h.page.locator('[data-profile-copied]').getByText('Link copied').waitFor();

      // Manage member… is the existing panel, unchanged.
      await more.click();
      await h.page.getByRole('menuitem', { name: /Manage member…/ }).click();
      await h.page.locator('[data-panel="manage-member"]').waitFor({ timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await h.page.locator('[data-panel="manage-member"]').waitFor({ state: 'detached' });

      await more.click();
      await h.page.getByRole('menuitem', { name: 'See Hemant’s cards in Work' }).click();
      // Work is the Organisation page's tab since D-147 (LAI-1170).
      await h.page.waitForURL(/\/organisation\?tab=work&person=u2$/, { timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('a phone stacks the breadcrumb and the notice, and nothing scrolls sideways', async () => {
    const h = await open('/people?user=u2', BASE);
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await headReady(h.page);
      await h.page.locator('[data-profile-notice]').waitFor();
      const crumbs = await h.page.getByRole('navigation', { name: 'Breadcrumb' }).boundingBox();
      const notice = await h.page.locator('[data-profile-notice]').boundingBox();
      assert.ok(crumbs !== null && notice !== null);
      assert.ok(notice.y >= crumbs.y + crumbs.height - 1, 'the notice is beside the breadcrumb');
      const avatar = await h.page.locator('.prof-avatar').boundingBox();
      assert.equal(Math.round(avatar?.width ?? 0), 48, 'the avatar is 3rem on a phone');
      // The tabs scroll inside their own row rather than the page.
      assert.equal(
        await h.page.locator('nav.prof-tabs').evaluate((el) => getComputedStyle(el).overflowX),
        'auto',
      );
      await assertFits(h.page, '390');
    } finally {
      await h.close();
    }
  });
});

void describe('your own profile (frame C)', () => {
  const own = (extra: ApiStub = {}): ApiStub => ({
    ...BASE,
    '/api/v1/me/availability': RECORD,
    ...extra,
  });

  for (const theme of ['Dark', 'Light'] as const) {
    void test(`My profile, its notice, all four tabs and Developer access (${theme})`, async () => {
      const h = await open('/people?user=u1', own());
      try {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        const head = await headReady(h.page);
        const crumbs = h.page.getByRole('navigation', { name: 'Breadcrumb' });
        assert.equal((await crumbs.innerText()).trim(), 'My profile');
        assert.equal(await crumbs.getByRole('link').count(), 0);
        assert.equal(
          (await h.page.locator('[data-profile-notice]').innerText()).trim(),
          OWN_NOTICE,
        );

        assert.deepEqual(await head.locator('nav.prof-tabs [data-profile-tab]').allInnerTexts(), [
          'Overview',
          'Day',
          'Time report',
          'Developer access',
        ]);
        // ⋯ is someone else's; your own has Who looked instead.
        assert.equal(await h.page.locator('[data-profile-manage]').count(), 0);
        await head.locator('[data-profile-who-looked]').waitFor();

        // The pill line is yours: *set by you*.
        const line = head.locator('[data-profile-availability]');
        await line.waitFor({ timeout: 10_000 });
        assert.match(
          await line.innerText(),
          /“Happy to review front-end work”\s*Front-end\s*Reviews\s*set by you · updated 3 days ago/,
        );
        await assertRemoved(h.page);

        await head.locator('[data-profile-tab="time"]').click();
        await h.page.locator('[data-time-report="me"]').waitFor({ timeout: 20_000 });
        assert.equal(
          (await h.page.locator('[data-time-report="me"] .trep-title').innerText()).trim(),
          'Time report',
        );

        // Your own setup in the profile itself (LAI-1156), under its own notice.
        await head.locator('[data-profile-tab="dev"]').click();
        const notice = h.page.locator('[data-ds-notice]');
        await notice.waitFor({ timeout: 10_000 });
        assert.equal(
          (await notice.innerText()).trim(),
          'Your setup · owners and admins see a read-only copy, and you can see when they look',
        );
        await assertFits(h.page, `1440 ${theme}`);
      } finally {
        await h.close();
      }
    });
  }

  void test('the pill opens My availability, and a save is the pill and its line', async () => {
    const writes: StubCall[] = [];
    let saved: Record<string, unknown> = RECORD;
    const h = await open(
      '/people?user=u1',
      own({
        '/api/v1/me/availability': (call: StubCall) => {
          if (call.method === 'PUT') {
            writes.push(call);
            saved = { ...saved, ...(call.body as object), updated_at: NOW };
          }
          return saved;
        },
      }),
    );
    try {
      const head = await headReady(h.page);
      const trigger = head.locator('.prof-name-row [data-my-availability] > button');
      await trigger.locator('[data-avail-pill="open"]').waitFor({ timeout: 10_000 });
      assert.equal(await trigger.getAttribute('aria-haspopup'), 'dialog');
      await trigger.click();
      const dialog = h.page.getByRole('dialog', { name: /My availability/ });
      await dialog.getByText(/everyone in your spaces sees this/i).waitFor({ timeout: 10_000 });

      await dialog.getByRole('radio', { name: 'At capacity' }).check();
      const note = dialog.getByPlaceholder('What you would like to pick up');
      await note.fill('Heads down on the migration');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await dialog.waitFor({ state: 'detached', timeout: 10_000 });

      assert.equal(writes.length, 1);
      assert.equal((writes[0]!.body as { note: string }).note, 'Heads down on the migration');
      await trigger.locator('[data-avail-pill="capacity"]').waitFor({ timeout: 10_000 });
      await until(async () =>
        /“Heads down on the migration”[\s\S]*set by you · updated today/.test(
          await head.locator('[data-profile-availability]').innerText(),
        ),
      );
    } finally {
      await h.close();
    }
  });

  void test('Who looked: 30 days of looks with role, tab and when; Tab stays in; Escape hands back', async () => {
    const h = await open('/people?user=u1', own());
    try {
      await headReady(h.page);
      const button = h.page.locator('[data-profile-who-looked] > button');
      await button.locator('[data-looked-count]').waitFor({ timeout: 10_000 });
      // The look 40 days ago is outside the window, so the count is two.
      assert.equal((await button.locator('[data-looked-count]').innerText()).trim(), '2');
      assert.equal(
        await button.getAttribute('aria-label'),
        'Who looked at your profile: 2 in the last 30 days',
      );
      assert.ok(h.calls.some((c) => c.path === '/api/v1/me/analytics-views'));

      await button.focus();
      await h.page.keyboard.press('Enter');
      const dialog = h.page.getByRole('dialog', { name: /Who looked/ });
      await dialog.waitFor({ timeout: 10_000 });
      assert.match(await dialog.innerText(), /Who looked · last 30 days/);
      const rows = dialog.locator('.prof-looked-row');
      assert.equal(await rows.count(), 2);
      assert.match(
        await rows.nth(0).innerText(),
        /Thabo Nkosi · Admin\s*Looked at Time report · 2 h ago/,
      );
      // No role from a server before LAI-1150: the name alone, nothing invented.
      assert.equal(
        (await rows.nth(1).locator('.prof-looked-name').innerText()).trim(),
        'Lindiwe Dube',
      );
      assert.match(await rows.nth(1).innerText(), /Looked at Overview/);
      assert.match(
        await dialog.innerText(),
        /Owners and admins see a read-only copy of your profile\. Every look is listed here for 400 days\./,
      );

      // Focus moved in, and Tab cycles inside the dialog.
      assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
      for (let i = 0; i < 4; i += 1) {
        await h.page.keyboard.press('Tab');
        assert.equal(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
          true,
          `Tab ${String(i + 1)} left the dialog`,
        );
      }
      await h.page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);

      await h.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(
        await button.evaluate((el) => el === document.activeElement),
        true,
        'focus did not return to Who looked',
      );
    } finally {
      await h.close();
    }
  });

  void test('a plain member opens My profile from /me/profile, and nobody else’s', async () => {
    const h = await open('/people?user=u3', {
      ...BASE,
      '/api/v1/me': { ...person('u3', 'Cal Member', 'member'), memberships: [] },
      '/api/v1/me/profile': profileOf('u3', 'Cal Member'),
      '/api/v1/users/u3/usage': quietUsage('u3'),
      '/api/v1/me/availability': RECORD,
    });
    try {
      const head = await headReady(h.page);
      assert.equal((await head.locator('#prof-name').innerText()).trim(), 'Cal Member');
      assert.equal(
        (await h.page.getByRole('navigation', { name: 'Breadcrumb' }).innerText()).trim(),
        'My profile',
      );
      assert.deepEqual(await head.locator('nav.prof-tabs [data-profile-tab]').allInnerTexts(), [
        'Overview',
        'Day',
        'Time report',
        'Developer access',
      ]);
      await h.page.locator('.prof-card[data-section="activity"]').waitFor({ timeout: 20_000 });
      // Their own reads, never the owners-and-admins ones.
      assert.ok(h.calls.some((c) => c.path === '/api/v1/me/profile'));
      assert.ok(h.calls.some((c) => c.path === '/api/v1/me/activity'));
      assert.equal(
        h.calls.some(
          (c) => c.path === '/api/v1/users/u3/profile' || c.path === '/api/v1/people/u3/activity',
        ),
        false,
      );
      assert.equal(await h.page.getByText('You do not have access to member profiles').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a phone: Who looked is an eye and its count, and nothing scrolls sideways', async () => {
    const h = await open('/people?user=u1', own());
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      await headReady(h.page);
      const button = h.page.locator('[data-profile-who-looked] > button');
      await button.locator('[data-looked-count]').waitFor({ timeout: 10_000 });
      assert.equal(await button.locator('.prof-looked-text').isVisible(), false);
      assert.equal(await button.locator('.prof-eye').isVisible(), true);
      assert.equal(await button.locator('[data-looked-count]').isVisible(), true);
      await assertFits(h.page, '390 own');
      await button.click();
      const dialog = h.page.getByRole('dialog', { name: /Who looked/ });
      await dialog.waitFor();
      const box = await dialog.boundingBox();
      assert.ok(
        box !== null && box.x >= 0 && box.x + box.width <= 390 + 0.5,
        `Who looked runs off the phone: ${JSON.stringify(box)}`,
      );
    } finally {
      await h.close();
    }
  });
});
