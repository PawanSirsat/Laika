/**
 * The member profile's Developer setup tab in a real browser (LAI-1140,
 * frames 2p–2ab; D-132, D-133).
 *
 * Who sees the tab, what it draws from the read, and the three revokes as a
 * person operates them: each ⋯ is a menu the keyboard opens, each action
 * opens a confirm that says what stops working and that the member is told in
 * Laika, and the success notice follows. Plus the owner's setup with no
 * actions, a refused revoke, deactivated, empty, error and both themes at a
 * phone's width.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  open,
  refuse,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { DAY, NOW as FIXTURE_NOW, setup, token } from '../helpers/developer-setup-fixture.ts';
import type { DeveloperSetup } from '../../src/api/developer-setup.ts';

const NOW = Date.now();
const WEEK = 7 * DAY;

/** The fixture, moved onto the real clock so every age reads as written. */
function view(over: Partial<DeveloperSetup> = {}): DeveloperSetup {
  const shift = NOW - FIXTURE_NOW;
  const moved = JSON.parse(JSON.stringify(setup(over)), (key, value: unknown) =>
    typeof value === 'number' && value > 1e12 && /(_at|^now|^at)$/.test(key)
      ? value + shift
      : value,
  ) as DeveloperSetup;
  return moved;
}

const person = (id: string, name: string, org_role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  org_role,
  is_active: true,
  created_at: 1,
  updated_at: 1,
});

const OWNER = person('u1', 'Ada Owner', 'owner');
const ROWAN = person('u2', 'Rowan Vale', 'member');

function profile(user: ReturnType<typeof person>) {
  const zeros = Array.from({ length: 12 }, (_, i) => ({
    week_start: NOW - (12 - i) * WEEK,
    accepted: 0,
    sent_back: 0,
  }));
  return {
    user: { ...user, profile_kind: 'builder', created_at: NOW - 100 * DAY },
    window: { weeks: 12, since: NOW - 12 * WEEK, until: NOW },
    projects: [],
    review: {
      accepted: 0,
      sent_back: 0,
      last_30_days: 0,
      per_week: zeros,
      time_to_decide: { measured: 0, unmeasured: 0, p50_ms: null },
      recent: [],
    },
    ratings: [],
    ratings_total: 0,
    activity_sharing: { org_enabled: false, enabled: false },
    current_work: { in_progress: [], in_progress_total: 0, in_review: [], in_review_total: 0 },
    delivery: {
      accepted_per_week: zeros.map((w) => ({ week_start: w.week_start, accepted: 0 })),
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
  };
}

const quietActivity = () => {
  const zeros = () => new Array<number>(364).fill(0);
  return {
    range: '52w',
    start: new Date(NOW - 363 * DAY).toISOString().slice(0, 10),
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

const SETUP_GRANT = ['developer_setup.read_any', 'agent.revoke_any', 'device.revoke_any'];

/** The owner's default grants, with *See and manage anyone's developer setup* or without it. */
function permissions(withSetup: boolean) {
  const grants = defaultPermissions({ ...OWNER, memberships: [] }) as {
    me: { actions: string[] };
  };
  const actions = grants.me.actions.filter((a) => !SETUP_GRANT.includes(a));
  return {
    ...grants,
    me: { ...grants.me, actions: withSetup ? [...actions, ...SETUP_GRANT] : actions },
  };
}

function stub(overrides: ApiStub = {}, withSetup = true): ApiStub {
  return {
    '/api/v1/me': { ...OWNER, memberships: [] },
    '/api/v1/permissions': permissions(withSetup),
    '/api/v1/org': {
      id: 'o1',
      name: 'Borealis',
      presence_enabled: true,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/users': { data: [OWNER, ROWAN], next_cursor: null },
    '/api/v1/projects': {
      data: [
        {
          id: 'p1',
          slug: 'fixture',
          name: 'Fixture Space',
          prefix: 'FIX',
          description: null,
          repo: null,
          visibility: 'private',
          color: null,
          task_create_min_role: 'member',
          agents_allowed: true,
          former_prefixes: [],
          context_md: '',
          board_hide_done_days: null,
          archived_at: null,
          created_at: 1,
          updated_at: 1,
          task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        },
      ],
      next_cursor: null,
    },
    '/api/v1/users/u2/profile': profile(ROWAN),
    '/api/v1/users/u1/profile': profile(OWNER),
    '/api/v1/users/u2/usage': quietUsage('u2'),
    '/api/v1/users/u1/usage': quietUsage('u1'),
    '/api/v1/people/u2/activity': quietActivity,
    '/api/v1/people/u1/activity': quietActivity,
    '/api/v1/users/u2/tokens': { data: [], next_cursor: null },
    '/api/v1/users/u2/memberships': { data: [] },
    '/api/v1/people/u2/developer-setup': view(),
    ...overrides,
  };
}

async function at(
  path: string,
  overrides: ApiStub = {},
  width = 1440,
  withSetup = true,
): Promise<Harness> {
  return open(path, stub(overrides, withSetup), {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
}

const TAB = '/people?user=u2&tab=dev';

const tabsOf = (page: Page) =>
  page
    .locator('[data-profile-tab]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-profile-tab')));

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el === null ? '' : `${el.tagName.toLowerCase()}#${el.id}|${el.textContent ?? ''}`;
  });

void after(async () => {
  await closeBrowser();
});

void describe('who sees the tab', () => {
  void test('a holder of the grant sees Developer setup on somebody else’s profile', async () => {
    const h = await at('/people?user=u2');
    try {
      await h.page.locator('[data-profile-tab="dev"]').waitFor({ timeout: 20_000 });
      assert.deepEqual(await tabsOf(h.page), ['overview', 'day', 'time', 'dev']);
      assert.equal(await h.page.locator('[data-profile-tab="dev"]').innerText(), 'Developer setup');
      // Not read until it is opened: the read is a look the member sees.
      assert.equal(h.calls.filter((c) => c.path.includes('/developer-setup')).length, 0);
    } finally {
      await h.close();
    }
  });

  void test('without the grant there is no tab, and ?tab=dev opens the overview', async () => {
    const h = await at(TAB, {}, 1440, false);
    try {
      await h.page
        .locator('[data-profile-tab="overview"][aria-current="page"]')
        .waitFor({ timeout: 20_000 });
      assert.deepEqual(await tabsOf(h.page), ['overview', 'day', 'time']);
      assert.equal(await h.page.locator('[data-ds-ready], [data-ds-loading]').count(), 0);
      assert.equal(h.calls.filter((c) => c.path.includes('/developer-setup')).length, 0);
    } finally {
      await h.close();
    }
  });

  void test('never on your own profile', async () => {
    const h = await at('/people?user=u1&tab=dev');
    try {
      await h.page.locator('.prof-head').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-profile-tab]').count(), 0);
      assert.equal(h.calls.filter((c) => c.path.includes('/developer-setup')).length, 0);
    } finally {
      await h.close();
    }
  });
});

void describe('what the tab draws (frame 2p)', () => {
  void test('the notice, the summary, hidden spaces as counts, and a pairing request with no code', async () => {
    const h = await at(TAB);
    try {
      const tab = h.page.locator('[data-ds-ready]');
      await tab.waitFor({ timeout: 20_000 });
      assert.equal(
        (await h.page.locator('[data-ds-notice]').innerText()).trim(),
        'Owners and admins only · read-only · Rowan can see that you looked',
      );
      assert.match(
        await h.page.locator('[data-ds-tile="Repositories set up"]').innerText(),
        /^Repositories set up\s+1\s+2 setups in spaces you can’t see$/,
      );
      assert.match(
        await h.page.locator('[data-ds-repos-hidden]').innerText(),
        /2 setups in spaces you can’t see/,
      );
      const pending = await h.page.locator('[data-ds-pairing="pr1"]').innerText();
      assert.match(pending, /rowan-spare/);
      assert.match(pending, /waiting for Rowan to approve it/);
      assert.doesNotMatch(pending, /code/i, 'a pairing code is never shown (D-124)');
      // The space a grant names comes from the reader's own project list.
      assert.match(
        await h.page.locator('[data-ds-tool="a1"]').innerText(),
        /Fixture Space ·\s*Full/,
      );
      assert.match(
        await h.page.locator('[data-ds-tile="Spaces reachable"]').innerText(),
        /^Spaces reachable\s+1\s+by their live tools$/,
      );
      assert.equal(
        await h.page
          .locator('[data-ds-repo="fixture-org/fixture-app"]')
          .getAttribute('data-ds-repo-chip'),
        'update-available',
      );
      // Only the headline is announced; the links are not inside the live region.
      assert.equal(await h.page.locator('[data-ds-health]').getAttribute('role'), null);
      assert.equal(
        await h.page.locator('[data-ds-health] [role="status"]').innerText(),
        '2 things need attention',
      );
      assert.ok(!(await tab.innerText()).includes('email'), 'nothing says email (D-133)');
    } finally {
      await h.close();
    }
  });

  void test('the health line’s link moves focus to the tool it names', async () => {
    const h = await at(TAB);
    try {
      const health = h.page.locator('[data-ds-health]');
      await health.waitFor({ timeout: 20_000 });
      assert.match(await health.innerText(), /2 things need attention/);
      await h.page.locator('[data-ds-jump="dev-tool-a2"]').click();
      await until(async () => (await focused(h.page)).startsWith('article#dev-tool-a2'));
      assert.ok((await focused(h.page)).startsWith('article#dev-tool-a2'), await focused(h.page));
    } finally {
      await h.close();
    }
  });

  void test('revoked devices are folded away until asked for', async () => {
    const h = await at(TAB);
    try {
      const toggle = h.page.locator('[data-ds-revoked-toggle]');
      await toggle.waitFor({ timeout: 20_000 });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await h.page.locator('[data-ds-revoked-list]').count(), 0);
      await toggle.click();
      assert.match(
        await h.page.locator('[data-ds-revoked-list]').innerText(),
        /rowan-old.*by Ada Admin/s,
      );
    } finally {
      await h.close();
    }
  });

  void test('the token filter counts each state; search appears past eight tokens', async () => {
    const h = await at(TAB);
    try {
      await h.page.locator('[data-ds-filter="revoked"]').waitFor({ timeout: 20_000 });
      assert.equal(
        (await h.page.locator('[data-ds-filter="active"]').innerText()).trim(),
        'Active 3',
      );
      assert.equal(await h.page.locator('[data-ds-search]').count(), 0, 'five tokens: no search');
      await h.page.locator('[data-ds-filter="revoked"]').click();
      assert.deepEqual(
        await h.page
          .locator('[data-ds-token]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-ds-token'))),
        ['p2'],
      );
    } finally {
      await h.close();
    }

    const many = Array.from({ length: 9 }, (_, i) =>
      token(`m${String(i)}`, { name: `key-${String(i)}` }),
    );
    const h2 = await at(TAB, {
      '/api/v1/people/u2/developer-setup': view({
        tokens: { personal: many, tool_credentials: [] },
      }),
    });
    try {
      const search = h2.page.locator('[data-ds-search]');
      await search.waitFor({ timeout: 20_000 });
      await search.fill('key-7');
      await until(async () => (await h2.page.locator('[data-ds-token]').count()) === 1);
      assert.equal(await h2.page.locator('[data-ds-token]').count(), 1);
    } finally {
      await h2.close();
    }
  });
});

void describe('the revokes (frames 2v–2x)', () => {
  void test('Unpair by keyboard: a menu, a confirm that says what stops, the call, and a notice', async () => {
    let reads = 0;
    const calls: StubCall[] = [];
    const h = await at(TAB, {
      '/api/v1/people/u2/developer-setup': () => {
        reads += 1;
        return view();
      },
      '/api/v1/people/u2/devices/d1/revoke': (c: StubCall) => {
        calls.push(c);
        return { device: view().devices[0], revoked_agent_ids: ['a1', 'a2'] };
      },
    });
    try {
      const more = h.page.getByRole('button', { name: 'Actions for rowan-box' });
      await more.waitFor({ timeout: 20_000 });
      await more.focus();
      await h.page.keyboard.press('ArrowDown');
      const item = h.page.getByRole('menuitem', { name: 'Unpair device…' });
      await item.waitFor();
      assert.equal(await item.evaluate((el) => el === document.activeElement), true);
      await h.page.keyboard.press('Enter');

      const dialog = h.page.getByRole('alertdialog');
      await dialog.waitFor();
      const text = await dialog.innerText();
      assert.match(text, /Unpair rowan-box\?/);
      assert.match(text, /What stops working/i);
      assert.match(text, /Claude Code and Codex on rowan-box stop now/);
      assert.match(text, /Rowan is notified in Laika/);
      assert.doesNotMatch(text, /email/i);
      assert.equal(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
        true,
        'focus is in the confirm',
      );
      const before = reads;

      await dialog.getByRole('button', { name: 'Unpair rowan-box' }).click();
      await h.page.locator('[data-ds-done]').waitFor();
      assert.equal(
        (await h.page.locator('[data-ds-done]').innerText()).trim(),
        'rowan-box is unpaired. Rowan was notified.',
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.method, 'POST');
      await until(() => reads > before);
      assert.ok(reads > before, 'the setup is read again after the revoke');
    } finally {
      await h.close();
    }
  });

  void test('Revoke tool and Revoke token each go through their own confirm', async () => {
    const posted: string[] = [];
    const h = await at(TAB, {
      '/api/v1/people/u2/agents/a2/revoke': (c: StubCall) => {
        posted.push(`${c.method} ${c.path}`);
        return view().tools[1];
      },
      '/api/v1/users/u2/tokens/p1': (c: StubCall) => {
        posted.push(`${c.method} ${c.path}`);
        return reply(204, null);
      },
    });
    try {
      await h.page
        .getByRole('button', { name: 'Actions for Codex on rowan-box' })
        .click({ timeout: 20_000 });
      await h.page.getByRole('menuitem', { name: 'Revoke tool…' }).click();
      let dialog = h.page.getByRole('alertdialog');
      assert.match(
        await dialog.innerText(),
        /Revoke Codex on rowan-box\?[\s\S]*Other tools on this device keep working/,
      );
      await dialog.getByRole('button', { name: 'Revoke Codex' }).click();
      await h.page.locator('[data-ds-done]').waitFor();
      assert.match(
        await h.page.locator('[data-ds-done]').innerText(),
        /Codex was revoked\. Rowan was notified\./,
      );

      await h.page.getByRole('button', { name: 'Actions for deploy-key' }).click();
      await h.page.getByRole('menuitem', { name: 'Revoke token…' }).click();
      dialog = h.page.getByRole('alertdialog');
      assert.match(await dialog.innerText(), /Revoke deploy-key\?/);
      await dialog.getByRole('button', { name: 'Revoke token' }).click();
      await until(async () =>
        (await h.page.locator('[data-ds-done]').innerText()).includes('Token revoked'),
      );
      assert.match(
        await h.page.locator('[data-ds-done]').innerText(),
        /Token revoked\. Rowan was notified\./,
      );
      assert.deepEqual(posted, [
        'POST /api/v1/people/u2/agents/a2/revoke',
        'DELETE /api/v1/users/u2/tokens/p1',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('Cancel and Escape close the confirm with nothing sent, and focus goes back to ⋯', async () => {
    const h = await at(TAB);
    try {
      const more = h.page.getByRole('button', { name: 'Actions for rowan-box' });
      await more.click({ timeout: 20_000 });
      await h.page.getByRole('menuitem', { name: 'Unpair device…' }).click();
      await h.page.getByRole('alertdialog').waitFor();
      await h.page.keyboard.press('Escape');
      await h.page.getByRole('alertdialog').waitFor({ state: 'detached' });
      await until(async () => more.evaluate((el) => el === document.activeElement));
      assert.equal(await more.evaluate((el) => el === document.activeElement), true);
      assert.equal(h.calls.filter((c) => c.method !== 'GET').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a refusal stays in the confirm, in the reader’s words, and nothing changes', async () => {
    const h = await at(TAB, {
      '/api/v1/people/u2/devices/d1/revoke': reply(403, {
        error: {
          code: 'forbidden',
          message: "An admin cannot change the owner's setup",
          details: { reason: 'not_for_owner' },
        },
      }),
    });
    try {
      await h.page
        .getByRole('button', { name: 'Actions for rowan-box' })
        .click({ timeout: 20_000 });
      await h.page.getByRole('menuitem', { name: 'Unpair device…' }).click();
      const dialog = h.page.getByRole('alertdialog');
      await dialog.getByRole('button', { name: 'Unpair rowan-box' }).click();
      await until(async () => (await dialog.innerText()).includes('Only the owner'));
      assert.match(
        await dialog.innerText(),
        /Only the owner can change the owner’s setup\. Nothing was changed\./,
      );
      assert.equal(await h.page.locator('[data-ds-done]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('on the owner’s setup an admin is offered no action, and is told why', async () => {
    // An admin reading the owner: the server answers `can_revoke: false`.
    const ADMIN = person('u3', 'Ada Admin', 'admin');
    const owner = { ...ROWAN, org_role: 'owner' };
    const grants = defaultPermissions({ ...ADMIN, memberships: [] }) as {
      me: { actions: string[] };
    };
    const v = view({ can_revoke: false });
    const h = await at(TAB, {
      '/api/v1/me': { ...ADMIN, memberships: [] },
      '/api/v1/permissions': {
        ...grants,
        me: { ...grants.me, actions: [...grants.me.actions, ...SETUP_GRANT] },
      },
      '/api/v1/users': { data: [owner, ADMIN], next_cursor: null },
      '/api/v1/users/u2/profile': profile(owner),
      '/api/v1/people/u2/developer-setup': { ...v, user: { ...v.user, org_role: 'owner' } },
    });
    try {
      await h.page.locator('[data-ds-owner-note]').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('[data-ds-owner-note]').innerText(),
        /This is the owner’s setup\. Only the owner can revoke/,
      );
      assert.equal(await h.page.locator('[data-ds-ready] [aria-haspopup="menu"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('the other states', () => {
  void test('deactivated (2aa): read-only history, revokes left', async () => {
    const v = view();
    const h = await at(TAB, {
      '/api/v1/people/u2/developer-setup': { ...v, user: { ...v.user, is_active: false } },
    });
    try {
      const note = h.page.locator('[data-ds-deactivated]');
      await note.waitFor({ timeout: 20_000 });
      assert.match(await note.innerText(), /deactivated[\s\S]*Only revoke actions are left/);
      assert.ok((await h.page.locator('[data-ds-ready] [aria-haspopup="menu"]').count()) > 0);
    } finally {
      await h.close();
    }
  });

  void test('empty (2y): nothing set up, and admins cannot do it for them', async () => {
    const h = await at(TAB, {
      '/api/v1/people/u2/developer-setup': view({
        devices: [],
        tools: [],
        pending_pairing: [],
        repositories: [],
        tokens: { personal: [], tool_credentials: [] },
        activity: [],
      }),
    });
    try {
      const empty = h.page.locator('[data-ds-empty]');
      await empty.waitFor({ timeout: 20_000 });
      assert.match(
        await empty.innerText(),
        /Rowan hasn’t set up any tools yet[\s\S]*Admins can’t set it up for them/,
      );
    } finally {
      await h.close();
    }
  });

  void test('an error says the server’s sentence, and Retry reads again', async () => {
    let n = 0;
    const h = await at(TAB, {
      '/api/v1/people/u2/developer-setup': () => {
        n += 1;
        return n === 1 ? refuse(500, 'internal', 'The database is busy.') : view();
      },
    });
    try {
      const alert = h.page.locator('[data-ds-error] [role="alert"]');
      await alert.waitFor({ timeout: 20_000 });
      assert.match(
        await alert.innerText(),
        /Rowan’s setup could not be read\. The database is busy\. Nothing was changed\./,
      );
      await alert.getByRole('button', { name: 'Retry' }).click();
      await h.page.locator('[data-ds-ready]').waitFor();
    } finally {
      await h.close();
    }
  });
});

void describe('both themes, at a phone’s width', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme} at 390: the tab fits the page`, async () => {
      const h = await at(TAB, {}, 390);
      try {
        await h.page.locator('[data-ds-ready]').waitFor({ timeout: 20_000 });
        await setTheme(h.page, theme);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(overflow <= 0, `the page scrolls sideways by ${String(overflow)}px`);
        // Labels are written out on a phone, where the column headers are hidden.
        assert.equal(await h.page.locator('.ds-dev-table .ds-row-head').isVisible(), false);
        assert.equal(
          await h.page.locator('[data-ds-device="d1"] .ds-lbl').first().isVisible(),
          true,
        );
      } finally {
        await h.close();
      }
    });
  }
});
