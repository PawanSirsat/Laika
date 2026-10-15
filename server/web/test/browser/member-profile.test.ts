/**
 * The member profile, in a real browser (LAI-743, D-078).
 *
 * The server tests own the figures and the door. What is left to prove is the
 * page a person reads: that every figure on it is the one the response
 * carried, that a manager's page has no agent, work or delivery block, that a
 * rating is written through the dialog by keyboard and lands on top, and that
 * the way in — a name on Organisation, a Capacity card, a *Work by person*
 * row — is a link for an owner or admin and plain text for anyone else.
 *
 * Fixtures are anchored to `Date.now()`, never to a date (CONVENTIONS §4).
 * The delivery figures that sit side by side are given different values —
 * accepted 4, sent back 6, reopened 7, p50 3 d, p75 4.5 d — so a card showing
 * one field under another's label fails rather than matching by coincidence.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, setTheme, until, type ApiStub } from './harness.ts';

const NOW = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Monday 00:00 UTC of this week, as the server counts it. */
const MONDAY = (() => {
  const d = new Date(NOW);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
})();
const SINCE = MONDAY - 11 * WEEK;
const WEEKLY = [0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 2, 0];

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${name.split(' ')[0]!.toLowerCase()}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const PEOPLE = [
  person('u1', 'Ada Owner', 'owner'),
  person('u2', 'Bea Builder', 'member'),
  person('u3', 'Cal Lead', 'member'),
  person('u5', 'Vic Viewer', 'viewer'),
];

const me = (id: string, org_role: string) => ({
  ...person(id, PEOPLE.find((p) => p.id === id)?.name ?? 'Someone', org_role),
  memberships: [{ project_id: 'p1', role: 'lead' }],
});

const BUILDER = {
  user: {
    id: 'u2',
    name: 'Bea Builder',
    email: 'bea@example.com',
    org_role: 'member',
    is_active: true,
    profile_kind: 'builder',
    created_at: NOW - 200 * DAY,
  },
  window: { weeks: 12, since: SINCE, until: NOW },
  projects: [
    {
      id: 'p1',
      slug: 'laika-core',
      name: 'Laika Core',
      key: 'LC',
      role: 'member',
      archived: false,
      open_tasks: 2,
      accepted: 4,
      reviewed: 0,
    },
    {
      id: 'p2',
      slug: 'orbit',
      name: 'Orbit',
      key: 'ORB',
      role: null,
      archived: true,
      open_tasks: 1,
      accepted: 0,
      reviewed: 1,
    },
  ],
  review: {
    accepted: 0,
    sent_back: 1,
    recent: [
      {
        task_id: 't9',
        key: 'ORB-2',
        title: 'Orbit two',
        project_slug: 'orbit',
        decision: 'sent_back',
        at: NOW - 2 * DAY,
        assignee: { id: 'u3', name: 'Cal Lead' },
      },
    ],
  },
  ratings: [
    {
      id: 'r2',
      score: 5,
      note: 'Clears review fast.',
      rated_by: { id: 'u1', name: 'Ada Owner' },
      created_at: NOW - DAY,
    },
    {
      id: 'r1',
      score: 3,
      note: 'Steady delivery on the billing work.',
      rated_by: { id: 'u4', name: 'Ari Admin' },
      created_at: NOW - 30 * DAY,
    },
  ],
  ratings_total: 2,
  current_work: {
    in_progress: [
      {
        id: 't7',
        key: 'LC-7',
        title: 'Seven: the migration runner',
        project_slug: 'laika-core',
        status: 'in_progress',
        status_name: 'In progress',
        started_at: NOW - 3 * DAY,
      },
    ],
    in_review: [
      {
        id: 't8',
        key: 'ORB-1',
        title: 'Orbit one',
        project_slug: 'orbit',
        status: 'review',
        status_name: 'Code review',
        started_at: NOW - DAY,
      },
    ],
    in_progress_total: 1,
    in_review_total: 1,
  },
  delivery: {
    accepted_per_week: WEEKLY.map((accepted, i) => ({ week_start: SINCE + i * WEEK, accepted })),
    accepted: 4,
    sent_back: 6,
    reopened: 7,
    cycle_time: { measured: 3, unmeasured: 1, p50_ms: 3 * DAY, p75_ms: 4.5 * DAY },
  },
  agents: {
    tokens: [
      {
        id: 'k1',
        name: 'Laptop Claude',
        client: 'claude-code',
        client_name: 'claude-code',
        last_used_at: NOW - 2 * MIN,
        last_mcp_at: NOW - 2 * MIN,
        created_at: NOW - 100 * DAY,
      },
      {
        id: 'k2',
        name: 'Codex desk',
        client: 'codex',
        client_name: 'codex_cli_rs',
        last_used_at: NOW - 3 * DAY,
        last_mcp_at: NOW - 3 * DAY,
        created_at: NOW - 50 * DAY,
      },
    ],
    tokens_total: 2,
    online: { enabled: true, clients: ['claude-code'], last_seen: NOW - MIN },
  },
};

/** The same person as a manager: the three builder blocks are absent. */
function asManager(profile: typeof BUILDER) {
  const { current_work: _work, delivery: _delivery, agents: _agents, ...rest } = profile;
  return { ...rest, user: { ...rest.user, profile_kind: 'manager' } };
}

const MANAGER = {
  ...asManager({ ...BUILDER, user: { ...BUILDER.user, id: 'u3', name: 'Cal Lead' } }),
  review: {
    accepted: 9,
    sent_back: 2,
    recent: [
      {
        task_id: 't3',
        key: 'LC-3',
        title: 'Three',
        project_slug: 'laika-core',
        decision: 'accepted',
        at: NOW - DAY,
        assignee: { id: 'u2', name: 'Bea Builder' },
      },
      {
        task_id: 't2',
        key: 'LC-2',
        title: 'Two',
        project_slug: 'laika-core',
        decision: 'sent_back',
        at: NOW - 4 * DAY,
        assignee: { id: 'u2', name: 'Bea Builder' },
      },
    ],
  },
  ratings: [],
  ratings_total: 0,
};

const EMPTY = {
  ...BUILDER,
  user: { ...BUILDER.user, id: 'u6', name: 'Nia New' },
  projects: [],
  review: { accepted: 0, sent_back: 0, recent: [] },
  ratings: [],
  ratings_total: 0,
  current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
  delivery: {
    accepted_per_week: WEEKLY.map((_, i) => ({ week_start: SINCE + i * WEEK, accepted: 0 })),
    accepted: 0,
    sent_back: 0,
    reopened: 0,
    cycle_time: { measured: 0, unmeasured: 0, p50_ms: null, p75_ms: null },
  },
  agents: { tokens: [], tokens_total: 0, online: { enabled: true, clients: [], last_seen: null } },
};

const BASE: ApiStub = {
  '/api/v1/projects': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o1',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
};

void after(async () => {
  await closeBrowser();
});

async function section(page: Page, name: string) {
  const found = page.locator(`.prof-card[data-section="${name}"]`);
  await found.waitFor({ timeout: 20_000 });
  return found;
}

async function stat(page: Page, name: string): Promise<string> {
  return (await page.locator(`[data-stat="${name}"] .prof-stat-value`).innerText()).trim();
}

// ------------------------------------------------------------------ builder

void describe('a builder’s profile', () => {
  void test('renders every figure from the response, in its place', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const head = h.page.locator('.prof-head');
      await head.waitFor({ timeout: 20_000 });
      const headText = await head.innerText();
      assert.match(headText, /Bea Builder/);
      assert.match(headText, /bea@example\.com/);
      assert.match(headText, /Member/);
      assert.equal(
        await h.page.locator('input[name="profile-kind"][value="builder"]').isChecked(),
        true,
      );

      const projects = await section(h.page, 'projects');
      assert.match(await projects.locator('.prof-card-count').innerText(), /^2$/);
      const projectText = await projects.innerText();
      assert.match(projectText, /Laika Core/);
      assert.match(projectText, /Orbit/);
      assert.match(projectText, /archived/i);

      const current = await section(h.page, 'current');
      const currentText = await current.innerText();
      assert.match(currentText, /LC-7/);
      assert.match(currentText, /Seven: the migration runner/);
      assert.match(currentText, /ORB-1/);
      assert.match(currentText, /Code review/);

      await section(h.page, 'delivery');
      const bars = h.page.locator('.prof-bars [data-accepted]');
      assert.equal(await bars.count(), 12, 'one bar per week of the window');
      assert.deepEqual(
        await bars.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-accepted')))),
        WEEKLY,
      );
      assert.equal(await stat(h.page, 'accepted'), '4');
      assert.equal(await stat(h.page, 'sent_back'), '6');
      assert.equal(await stat(h.page, 'reopened'), '7');
      assert.equal(await stat(h.page, 'p50'), '3 d');
      assert.equal(await stat(h.page, 'p75'), '4.5 d');
      assert.match(await h.page.locator('.prof-unmeasured').innerText(), /1 .*not measured/i);

      const review = await section(h.page, 'review');
      assert.equal(
        await review.locator('[data-stat="review_accepted"] .prof-stat-value').innerText(),
        '0',
      );
      assert.equal(
        await review.locator('[data-stat="review_sent_back"] .prof-stat-value').innerText(),
        '1',
      );

      const agents = await section(h.page, 'agents');
      const agentText = await agents.innerText();
      assert.match(agentText, /Claude Code/);
      assert.match(agentText, /Codex/);
      assert.match(agentText, /Laptop Claude/);
      assert.match(await agents.locator('.prof-online').innerText(), /Claude Code/);
      assert.equal(await agents.locator('.prof-agent[data-online="true"]').count(), 1);

      const rating = await section(h.page, 'rating');
      const latest = await rating.locator('.prof-rating-latest').innerText();
      assert.match(latest, /5 \/ 5/);
      assert.match(latest, /Clears review fast\./);
      assert.match(latest, /Ada Owner/);
      const history = await rating.locator('.prof-rating-history li').allInnerTexts();
      assert.equal(history.length, 1, 'the history is everything but the latest');
      assert.match(history[0] ?? '', /3 \/ 5.*Steady delivery/s);
    } finally {
      await h.close();
    }
  });

  void test('fits 1366 and 390 in both themes, with nothing scrolling sideways', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await section(h.page, 'delivery');
      for (const theme of ['Light', 'Dark']) {
        // The theme switch is in the sidebar, which is off-canvas on a phone:
        // switch at laptop width, then measure both.
        await h.page.setViewportSize({ width: 1366, height: 900 });
        await setTheme(h.page, theme);
        for (const width of [1366, 390]) {
          await h.page.setViewportSize({ width, height: 900 });
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(
            overflow <= 0,
            `${String(width)} ${theme}: scrolls sideways by ${String(overflow)}px`,
          );
          // Every card sits inside the viewport, not clipped off its right edge.
          const outside = await h.page
            .locator('.prof-card')
            .evaluateAll(
              (els) =>
                els.filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
                  .length,
            );
          assert.equal(outside, 0, `${String(width)} ${theme}: a card runs off the page`);
        }
      }
    } finally {
      await h.close();
    }
  });

  /**
   * The server caps three lists at 50 and sends the total (LAI-746). The page
   * says how many it is not showing, and counts by the total, not the length.
   */
  void test('says how many more there are when a list was cut', async () => {
    const long = {
      ...BUILDER,
      ratings_total: 60,
      current_work: { ...BUILDER.current_work, in_progress_total: 4, in_review_total: 1 },
      agents: { ...BUILDER.agents, tokens_total: 9 },
    };
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': long,
    });
    try {
      const current = await section(h.page, 'current');
      assert.match(await current.locator('.prof-sub').first().innerText(), /In progress\s*4/i);
      assert.match(await current.locator('.prof-more').innerText(), /and 3 more/);

      const agents = await section(h.page, 'agents');
      assert.match(await agents.locator('.prof-more').innerText(), /and 7 more/);

      const rating = await section(h.page, 'rating');
      assert.match(await rating.locator('.prof-sub').innerText(), /Earlier\s*59/i);
      assert.match(await rating.locator('.prof-more').innerText(), /and 58 more/);
    } finally {
      await h.close();
    }
  });

  void test('says nothing about more when nothing was cut', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await section(h.page, 'rating');
      assert.equal(await h.page.locator('.prof-more').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('says what is empty for a person with no history', async () => {
    const h = await open('/people?user=u6', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u6/profile': EMPTY,
    });
    try {
      const text = await (await section(h.page, 'rating')).page().locator('.prof').innerText();
      assert.match(text, /No projects yet/);
      assert.match(text, /Nothing in progress or in review/);
      assert.match(text, /Nothing accepted in these 12 weeks/);
      assert.match(text, /No agent has connected/);
      assert.match(text, /Not rated yet/);
      assert.equal(await stat(h.page, 'p50'), '—', 'nothing measured reads as a dash, not 0');
      assert.doesNotMatch(text, /undefined|NaN|null/);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------------ manager

void describe('a manager’s profile', () => {
  void test('shows projects, review work and recent decisions, and no builder blocks', async () => {
    const h = await open('/people?user=u3', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u3/profile': MANAGER,
    });
    try {
      await section(h.page, 'projects');
      const review = await section(h.page, 'review');
      assert.equal(
        await review.locator('[data-stat="review_accepted"] .prof-stat-value').innerText(),
        '9',
      );
      assert.equal(
        await review.locator('[data-stat="review_sent_back"] .prof-stat-value').innerText(),
        '2',
      );

      const decisions = await section(h.page, 'decisions');
      const rows = await decisions.locator('li').allInnerTexts();
      assert.equal(rows.length, 2);
      assert.match(rows[0] ?? '', /Accepted.*LC-3/s);
      assert.match(rows[1] ?? '', /Sent back.*LC-2/s);

      for (const absent of ['agents', 'current', 'delivery']) {
        assert.equal(
          await h.page.locator(`.prof-card[data-section="${absent}"]`).count(),
          0,
          `a manager's page has a ${absent} block`,
        );
      }
      assert.equal(
        await h.page.locator('input[name="profile-kind"][value="manager"]').isChecked(),
        true,
      );
    } finally {
      await h.close();
    }
  });

  void test('switching the kind sends PATCH and redraws from the answer', async () => {
    let state: unknown = BUILDER;
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': (call: { method: string; body: unknown }) => {
        if (call.method === 'PATCH') {
          state =
            (call.body as { profile_kind?: string }).profile_kind === 'manager'
              ? asManager(BUILDER)
              : BUILDER;
        }
        return state;
      },
    });
    try {
      await section(h.page, 'agents');
      // `click`, not `check`: the control shows the server's answer, so the
      // radio moves when the PATCH comes back rather than on the click.
      await h.page.locator('input[name="profile-kind"][value="manager"]').click();

      await until(
        async () => (await h.page.locator('.prof-card[data-section="agents"]').count()) === 0,
      );
      assert.equal(await h.page.locator('.prof-card[data-section="agents"]').count(), 0);
      const patch = h.calls.find((c) => c.method === 'PATCH');
      assert.deepEqual(patch?.body, { profile_kind: 'manager' });
      assert.equal(patch?.path, '/api/v1/users/u2/profile');
    } finally {
      await h.close();
    }
  });
});

// -------------------------------------------------------------------- rating

void describe('rating a member', () => {
  void test('by keyboard: open, choose, write, send — and it lands on top', async () => {
    const ratings = [...BUILDER.ratings];
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': () => ({
        ...BUILDER,
        ratings: [...ratings],
        ratings_total: ratings.length,
      }),
      '/api/v1/users/u2/ratings': (call: { body: unknown }) => {
        const body = call.body as { score: number; note: string };
        const created = {
          id: `r${String(ratings.length + 1)}`,
          score: body.score,
          note: body.note,
          rated_by: { id: 'u1', name: 'Ada Owner' },
          created_at: Date.now(),
        };
        ratings.unshift(created);
        return created;
      },
    });
    try {
      const rate = h.page.locator('button.prof-rate');
      await rate.waitFor({ timeout: 20_000 });
      await rate.focus();
      await h.page.keyboard.press('Enter');

      const dialog = h.page.locator('.rating-dialog[role="dialog"]');
      await dialog.waitFor();
      const submit = dialog.locator('button.rating-submit');
      assert.equal(await submit.isDisabled(), true, 'sendable before anything was chosen');

      // Focus starts on the score; arrows move it, as a radio group's do.
      await h.page.keyboard.press('ArrowRight');
      await h.page.keyboard.press('ArrowRight');
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await dialog.locator('input[name="rating-score"][value="4"]').isChecked(), true);
      assert.equal(await submit.isDisabled(), true, 'sendable with no note');

      await h.page.keyboard.press('Tab');
      await h.page.keyboard.type('Owns the release checklist now.');
      await submit.focus();
      await h.page.keyboard.press('Enter');

      await dialog.waitFor({ state: 'detached' });
      await until(async () =>
        (
          await h.page
            .locator('.prof-rating-latest')
            .innerText()
            .catch(() => '')
        ).includes('Owns the release checklist'),
      );
      const latest = await h.page.locator('.prof-rating-latest').innerText();
      assert.match(latest, /4 \/ 5/);
      assert.match(latest, /Owns the release checklist now\./);
      // The one it superseded moved into the history, newest first.
      const history = await h.page.locator('.prof-rating-history li').allInnerTexts();
      assert.match(history[0] ?? '', /5 \/ 5.*Clears review fast/s);

      const post = h.calls.find(
        (c) => c.method === 'POST' && c.path === '/api/v1/users/u2/ratings',
      );
      assert.deepEqual(post?.body, { score: 4, note: 'Owns the release checklist now.' });
    } finally {
      await h.close();
    }
  });

  void test('Escape closes the dialog without sending, and gives focus back', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const rate = h.page.locator('button.prof-rate');
      await rate.waitFor({ timeout: 20_000 });
      await rate.click();
      await h.page.locator('.rating-dialog').waitFor();
      await h.page.keyboard.press('Escape');
      await h.page.locator('.rating-dialog').waitFor({ state: 'detached' });

      assert.equal(await rate.evaluate((el) => el === document.activeElement), true);
      assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('shows the server’s refusal in the dialog rather than closing it', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
      '/api/v1/users/u2/ratings': refuse(
        422,
        'unprocessable',
        'A rating needs a note of 1 to 500 characters',
      ),
    });
    try {
      await h.page.locator('button.prof-rate').click();
      const dialog = h.page.locator('.rating-dialog');
      await dialog.locator('input[name="rating-score"][value="2"]').check();
      await dialog.locator('textarea').fill('Something.');
      await dialog.locator('button.rating-submit').click();

      await dialog.locator('[role="alert"]').waitFor();
      assert.match(await dialog.locator('[role="alert"]').innerText(), /1 to 500 characters/);
    } finally {
      await h.close();
    }
  });

  void test('offers no rating of yourself', async () => {
    const self = {
      ...BUILDER,
      user: { ...BUILDER.user, id: 'u1', name: 'Ada Owner', org_role: 'owner' },
    };
    const h = await open('/people?user=u1', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u1/profile': self,
    });
    try {
      const rating = await section(h.page, 'rating');
      assert.equal(await h.page.locator('button.prof-rate').count(), 0);
      assert.match(await rating.innerText(), /cannot rate yourself/i);
    } finally {
      await h.close();
    }
  });
});

// ------------------------------------------------------------- who sees it

void describe('who is shown a profile', () => {
  void test('a member is told it is not theirs, and the profile is never asked for', async () => {
    const h = await open('/people?user=u2', {
      ...BASE,
      '/api/v1/me': me('u3', 'member'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.state-forbidden').innerText(), /member profiles/i);
      await h.page.waitForTimeout(300);
      assert.equal(h.calls.filter((c) => c.path.endsWith('/profile')).length, 0);
    } finally {
      await h.close();
    }
  });

  void test('an id that names nobody says so', async () => {
    const h = await open('/people?user=nobody', {
      ...BASE,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/nobody/profile': refuse(404, 'not_found', 'No user with id "nobody"'),
    });
    try {
      const text = h.page.locator('.prof');
      await until(async () =>
        /No such person|not found/i.test(await text.innerText().catch(() => '')),
      );
      assert.match(await text.innerText(), /No such person/i);
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------------- the ways in

void describe('the ways in are links for owners and admins only', () => {
  const ORG_STUB: ApiStub = {
    ...BASE,
    '/api/v1/users': { data: PEOPLE, next_cursor: null },
    '/api/v1/invites': { data: [], next_cursor: null },
  };

  void test('Organisation: a member’s name opens their profile', async () => {
    const h = await open('/organisation', {
      ...ORG_STUB,
      '/api/v1/me': me('u1', 'owner'),
      '/api/v1/users/u2/profile': BUILDER,
    });
    try {
      const link = h.page.locator('.org-people a[href="/people?user=u2"]');
      await link.waitFor({ timeout: 20_000 });
      assert.match(await link.innerText(), /Bea Builder/);
      await link.click();
      await h.page.locator('.prof-head').waitFor();
      assert.equal(new URL(h.page.url()).pathname, '/people');
      assert.ok(h.calls.some((c) => c.path === '/api/v1/users/u2/profile'));
    } finally {
      await h.close();
    }
  });

  void test('Organisation: a member or viewer sees names, not links', async () => {
    for (const [id, role] of [
      ['u3', 'member'],
      ['u5', 'viewer'],
    ] as const) {
      const h = await open('/organisation', { ...ORG_STUB, '/api/v1/me': me(id, role) });
      try {
        await h.page
          .locator('.org-people li', { hasText: 'Bea Builder' })
          .waitFor({ timeout: 20_000 });
        assert.equal(
          await h.page.locator('a[href^="/people"]').count(),
          0,
          `${role} is offered a profile`,
        );
      } finally {
        await h.close();
      }
    }
  });

  const CAP_STUB: ApiStub = {
    ...BASE,
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/capacity': {
      enabled: true,
      people: [
        {
          user_id: 'u2',
          name: 'Bea Builder',
          active_sessions: 1,
          in_progress_tasks: [],
          oldest_in_progress_ms: null,
          tasks_in_review: [],
          last_seen: NOW - MIN,
        },
      ],
    },
    '/api/v1/unlisted': refuse(403, 'forbidden', 'no'),
  };

  void test('Capacity: a card’s name opens the profile for an owner, and is plain for a member', async () => {
    const owner = await open('/capacity', { ...CAP_STUB, '/api/v1/me': me('u1', 'owner') });
    try {
      await owner.page.locator('.cap-card').first().waitFor({ timeout: 20_000 });
      assert.equal(await owner.page.locator('.cap-card a[href="/people?user=u2"]').count(), 1);
    } finally {
      await owner.close();
    }

    const member = await open('/capacity', { ...CAP_STUB, '/api/v1/me': me('u3', 'member') });
    try {
      await member.page.locator('.cap-card').first().waitFor({ timeout: 20_000 });
      assert.match(await member.page.locator('.cap-card').first().innerText(), /Bea Builder/);
      assert.equal(await member.page.locator('a[href^="/people"]').count(), 0);
    } finally {
      await member.close();
    }
  });

  const CORE = {
    id: 'p1',
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
  const task = (n: number, assignee: string | null, status: string) => ({
    id: `t${String(n)}`,
    key: `LC-${String(n)}`,
    number: n,
    project_id: 'p1',
    title: `Task ${String(n)}`,
    description_md: '',
    acceptance_md: '',
    status,
    status_id: `st-${status}`,
    status_name: status,
    priority: 'p2',
    position: null,
    assignee_id: assignee,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    sprint_id: null,
    tags: [],
    ready: false,
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
    created_at: NOW - n * DAY,
    updated_at: NOW - n * 3_600_000,
    started_at: null,
    completed_at: null,
  });
  const DASH_STUB: ApiStub = {
    ...BASE,
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 1, in_progress: 2, review: 0, done: 0, cancelled: 0 },
          blocked_count: 0,
          member_count: 2,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks': {
      data: [task(1, 'u2', 'in_progress'), task(2, 'u2', 'todo'), task(3, 'u3', 'in_progress')],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core/members': {
      members: ['u2', 'u3'].map((id) => ({
        user_id: id,
        name: PEOPLE.find((p) => p.id === id)?.name,
        email: `${id}@example.com`,
        role: 'member',
        created_at: 1,
      })),
    },
    '/api/v1/projects/laika-core/mentionable': {
      users: PEOPLE.map((p) => ({ id: p.id, name: p.name })),
    },
    '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/metrics': {
      since: NOW - 7 * DAY,
      throughput: [],
      cycle_time: null,
    },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/presence': { enabled: false, present: [] },
  };

  void test('Work by person: each person has a profile link for an owner, none for a member', async () => {
    const owner = await open('/dashboard?project=laika-core', {
      ...DASH_STUB,
      '/api/v1/me': me('u1', 'owner'),
    });
    try {
      await owner.page
        .locator('.dash-people .dash-legend-row')
        .first()
        .waitFor({ timeout: 20_000 });
      const links = await owner.page
        .locator('.dash-people a[href^="/people?user="]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href')).sort());
      assert.deepEqual(links, ['/people?user=u2', '/people?user=u3']);
      // The row itself still opens the board, as it did.
      assert.ok(
        (await owner.page
          .locator('.dash-people a.dash-legend-row[href*="assignee=u2"]')
          .count()) === 1,
      );
    } finally {
      await owner.close();
    }

    const member = await open('/dashboard?project=laika-core', {
      ...DASH_STUB,
      '/api/v1/me': me('u3', 'member'),
    });
    try {
      await member.page
        .locator('.dash-people .dash-legend-row')
        .first()
        .waitFor({ timeout: 20_000 });
      assert.equal(await member.page.locator('a[href^="/people"]').count(), 0);
    } finally {
      await member.close();
    }
  });
});
