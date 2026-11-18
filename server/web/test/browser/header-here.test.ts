/**
 * The top bar's **who's here** (LAI-1348): the people online or away now, as
 * overlapping faces ringed by their status between + Create and the bell, a
 * `+N` for the rest, and a list of who is online and who is away on a click.
 *
 * `GET /presence/people` is stubbed with a value the test changes between
 * polls (30 s, on the page's own clock) to watch a face arrive and one leave.
 * Set `LAIKA_SHOTS` to keep the pictures the review asks for.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, defaultPermissions, open, setTheme, type ApiStub } from './harness.ts';
import { tipText } from './tooltip-probe.ts';

void after(async () => {
  await closeBrowser();
});

const SHOTS = process.env.LAIKA_SHOTS;
const MIN = 60_000;

const CORE = {
  id: '01AAA',
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
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 2,
  members: [],
  last_activity_at: 2,
  task_create_min_role: 'member',
};

const ME = {
  id: 'u1',
  name: 'Pawan Sirsat',
  email: 'u1@example.com',
  org_role: 'owner',
  is_active: true,
  last_seen_at: null,
  created_at: 1,
  updated_at: 1,
  memberships: [{ project_id: CORE.id, role: 'member' }],
};

type Status = 'online' | 'away';
const here = (user_id: string, name: string, status: Status, ago: number) => ({
  user_id,
  name,
  status,
  last_seen: Date.now() - ago,
  last_seen_via: 'board',
});

/** Two online, three away: online first, then the most recently seen. */
const FIVE = [
  here('u1', 'Pawan Sirsat', 'online', MIN),
  here('u2', 'Yashraaj Mundada', 'online', 2 * MIN),
  here('u3', 'Savita Shepur', 'away', 11 * MIN),
  here('u4', 'Hemant Purohit', 'away', 20 * MIN),
  here('u5', 'Kavya Rao', 'away', 40 * MIN),
];

/** The page's stub, with who is here read through `state` on every poll. */
function stub(state: { value: unknown }): ApiStub {
  return {
    '/api/v1/me': ME,
    '/api/v1/permissions': defaultPermissions({
      org_role: ME.org_role,
      memberships: ME.memberships,
    }),
    '/api/v1/projects': { data: [CORE], next_cursor: null },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/org': {
      id: 'org1',
      name: 'Kvelld',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/users': { data: [ME], next_cursor: null },
    '/api/v1/tasks': { data: [], next_cursor: null },
    '/api/v1/presence/people': () => state.value,
  };
}

const STACK = '[data-header-here]';
const faces = (page: Page) =>
  page
    .locator(`${STACK} .hdr-here-face`)
    .evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute('data-here-face') ?? '',
        el.getAttribute('data-status') ?? '',
        el.hasAttribute('data-arriving'),
        el.hasAttribute('data-leaving'),
      ]),
    );

/** The ring's colour against a probe painted with the token, in the same theme. */
const ringIs = (face: Locator, token: string) =>
  face.evaluate((el, name) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(el).backgroundColor === want;
  }, token);

async function openAt(
  state: { value: unknown },
  width: number,
  extra: { clock?: boolean; reduce?: boolean } = {},
) {
  return open('/inbox', stub(state), {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
      if (extra.clock === true) await page.clock.install();
      if (extra.reduce === true) await page.emulateMedia({ reducedMotion: 'reduce' });
    },
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.locator('[data-app-header]').screenshot({ path: `${SHOTS}/${name}.png` });
}

void describe('the stack', () => {
  void test('at 1440: online first, rings by status, a +N, said in words, left of the bell', async () => {
    const h = await openAt({ value: { enabled: true, people: FIVE } }, 1440);
    try {
      await h.page.locator(STACK).waitFor({ timeout: 20_000 });
      assert.deepEqual(await faces(h.page), [
        ['u1', 'online', false, false],
        ['u2', 'online', false, false],
      ]);
      assert.equal(await h.page.locator(`${STACK} [data-here-more]`).innerText(), '+3');
      assert.equal(await ringIs(h.page.locator('[data-here-face="u1"]'), '--chip-green'), true);
      const label =
        'people online or away: Pawan Sirsat, online; Yashraaj Mundada, online; and 3 more';
      assert.equal(await h.page.locator(STACK).getAttribute('aria-label'), `5 ${label}`);
      assert.equal(await tipText(h.page.locator(STACK)), `5 ${label}`);
      // Between + Create and the bell.
      const [create, stack, bell] = await Promise.all(
        ['[data-header-create]', STACK, '[data-header-bell]'].map((s) =>
          h.page.locator(s).boundingBox(),
        ),
      );
      assert.ok(create && stack && bell, 'a control has no box');
      assert.ok(create.x + create.width <= stack.x, 'the stack is not right of + Create');
      assert.ok(stack.x + stack.width <= bell.x, 'the stack is not left of the bell');
    } finally {
      await h.close();
    }
  });

  void test('an away ring is amber, and all fit when there is room', async () => {
    const h = await openAt({ value: { enabled: true, people: FIVE.slice(1, 4) } }, 1440);
    try {
      await h.page.locator(STACK).waitFor({ timeout: 20_000 });
      assert.deepEqual(
        (await faces(h.page)).map(([id, status]) => [id, status]),
        [
          ['u2', 'online'],
          ['u3', 'away'],
          ['u4', 'away'],
        ],
      );
      assert.equal(await h.page.locator(`${STACK} [data-here-more]`).count(), 0);
      assert.equal(await ringIs(h.page.locator('[data-here-face="u3"]'), '--chip-orange'), true);
    } finally {
      await h.close();
    }
  });
});

void describe('the list', () => {
  void test('online, then away, each in words; Open Capacity; Escape returns focus', async () => {
    const h = await openAt({ value: { enabled: true, people: FIVE } }, 1440);
    try {
      await h.page.locator(STACK).click();
      const pop = h.page.locator('[data-here-pop]');
      await pop.waitFor({ timeout: 10_000 });
      const rows = await pop
        .locator('[data-here-row]')
        .evaluateAll((els) =>
          els.map((el) => [
            el.closest('[data-here-group]')?.getAttribute('data-here-group') ?? '',
            el.querySelector('.hdr-here-name')?.textContent ?? '',
            el.querySelector('.hdr-here-status')?.textContent ?? '',
          ]),
        );
      assert.deepEqual(rows, [
        ['online', 'Pawan Sirsat', 'Online now'],
        ['online', 'Yashraaj Mundada', 'Online now'],
        ['away', 'Savita Shepur', 'Away · 11 min'],
        ['away', 'Hemant Purohit', 'Away · 20 min'],
        ['away', 'Kavya Rao', 'Away · 40 min'],
      ]);
      assert.equal(
        await pop.locator('[data-here-capacity]').getAttribute('href'),
        '/insights?tab=capacity&sort=online',
      );
      assert.equal(await h.page.locator(STACK).getAttribute('aria-expanded'), 'true');

      await h.page.keyboard.press('Escape');
      await pop.waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.hasAttribute('data-header-here')),
        true,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('arrivals and departures', () => {
  void test('a new face pops in, a gone one shrinks away, and both are said', async () => {
    const state = { value: { enabled: true, people: FIVE.slice(0, 2) } as unknown };
    const h = await openAt(state, 1440, { clock: true });
    try {
      await h.page.locator(STACK).waitFor({ timeout: 20_000 });
      // The first answer animates nothing.
      assert.deepEqual(await faces(h.page), [
        ['u1', 'online', false, false],
        ['u2', 'online', false, false],
      ]);

      state.value = { enabled: true, people: [FIVE[0], FIVE[2]] };
      await h.page.clock.fastForward(30_000);
      await h.page.locator('[data-here-face="u3"][data-arriving]').waitFor({ timeout: 10_000 });
      const during = await faces(h.page);
      assert.deepEqual(
        during.map(([id, , arriving, leaving]) => [id, arriving, leaving]),
        [
          ['u1', false, false],
          ['u3', true, false],
          ['u2', false, true],
        ],
      );
      // The leaving face goes when its exit has played.
      await h.page.locator('[data-here-face="u2"]').waitFor({ state: 'detached', timeout: 5_000 });
      assert.match(
        await h.page
          .locator('[role="status"][aria-live="polite"]')
          .allInnerTexts()
          .then((t) => t.join(' ')),
        /Savita Shepur is away\. Yashraaj Mundada went offline\./,
      );
    } finally {
      await h.close();
    }
  });

  void test('with reduced motion, a gone face goes at once', async () => {
    const state = { value: { enabled: true, people: FIVE.slice(0, 2) } as unknown };
    const h = await openAt(state, 1440, { clock: true, reduce: true });
    try {
      await h.page.locator(STACK).waitFor({ timeout: 20_000 });
      state.value = { enabled: true, people: [FIVE[0]] };
      await h.page.clock.fastForward(30_000);
      await h.page.locator('[data-here-face="u2"]').waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await h.page.locator('[data-leaving]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('nothing drawn', () => {
  for (const [why, value] of [
    // A list sent with it anyway is still not drawn: `enabled` decides.
    ['presence is off', { enabled: false, people: FIVE }],
    ['nobody is here', { enabled: true, people: [] }],
  ] as const) {
    void test(`when ${why}`, async () => {
      const h = await openAt({ value }, 1440);
      try {
        await h.page.locator('[data-header-bell]').waitFor({ timeout: 20_000 });
        await h.page.waitForTimeout(500);
        assert.ok(
          h.calls.some((c) => c.path === '/api/v1/presence/people'),
          'never asked',
        );
        assert.equal(await h.page.locator(STACK).count(), 0);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('look and fit', () => {
  void test('at 1280 two places and clear of the search; at 390 hidden and the bar fits', async () => {
    const h = await openAt({ value: { enabled: true, people: FIVE } }, 1280);
    try {
      await h.page.locator(STACK).waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator(`${STACK} .hdr-here-face`).count(), 1);
      assert.equal(await h.page.locator(`${STACK} [data-here-more]`).innerText(), '+4');
      const [search, stack] = await Promise.all(
        ['.shell-head-search', STACK].map((s) => h.page.locator(s).boundingBox()),
      );
      assert.ok(search && stack, 'the search or the stack has no box');
      assert.ok(search.x + search.width <= stack.x, 'the stack overlaps the search');

      await h.page.setViewportSize({ width: 390, height: 844 });
      await h.page.waitForTimeout(300);
      assert.equal(await h.page.locator(STACK).isVisible(), false);
      const sideways = await h.page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(sideways <= 0, `the page scrolls ${String(sideways)}px sideways`);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['Light', 'Dark'] as const) {
    void test(`${theme}: the stack and the list`, async () => {
      const h = await openAt({ value: { enabled: true, people: FIVE } }, 1440);
      try {
        await h.page.locator(STACK).waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        await h.page.waitForTimeout(400);
        assert.equal(await ringIs(h.page.locator('[data-here-face="u1"]'), '--chip-green'), true);
        await shoot(h.page, `header-here-1440-${theme.toLowerCase()}`);
        await h.page.locator(STACK).click();
        await h.page.locator('[data-here-pop]').waitFor({ timeout: 10_000 });
        if (SHOTS !== undefined) {
          await h.page.screenshot({
            path: `${SHOTS}/header-here-list-1440-${theme.toLowerCase()}.png`,
            clip: { x: 640, y: 0, width: 800, height: 520 },
          });
        }
      } finally {
        await h.close();
      }
    });
  }
});
