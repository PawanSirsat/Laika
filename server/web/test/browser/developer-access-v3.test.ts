/**
 * Developer access V3, behind `features.developer_access` (LAI-1048, plan §C,
 * §I, §J slice D1), in a real browser.
 *
 * - Every old address of plan §C lands where that mode says, as a `replace`
 *   (history does not grow), with the rest of the query kept.
 * - The Overview is worked out from `/agents/devices` alone: first run, a
 *   half-finished tool, and a returning reader with no funnel.
 * - Its states: loading, error, `403`, and an expired session.
 * - Keyboard only, a phone's width in both themes, and the wizard parts drawn
 *   with Connect's sheet.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, setTheme, type ApiStub, type Harness } from './harness.ts';

type Mode = 'classic' | 'preview' | 'v3';

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

const PROJECT = {
  id: 'p1',
  slug: 'onroute',
  prefix: 'ONR',
  name: 'OnRoute',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const compat = (mode: Mode) => ({
  server: { version: '0.1.0', build_commit: null },
  protocol: { current: 1, min_client: 1 },
  features: {
    developer_access: mode,
    device_pairing: false,
    tool_setup_exchange: false,
    client_reports: false,
    project_setups: false,
  },
  cli: {},
  release_notes: { ref: null, whats_new: [] },
});

interface AgentRow {
  id: string;
  harness: string;
  device_label: string | null;
  status: 'active' | 'revoked';
  grants: { project_id: string; scope: string }[];
  last_seen_at: number | null;
  created_at: number;
}

const agentRow = (over: Partial<AgentRow> & { id: string }) => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active' as const,
  grants: [],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: null,
  ...over,
});

type Agent = ReturnType<typeof agentRow>;

function devicesOf(agents: readonly Agent[]) {
  const by = new Map<string, Agent[]>();
  for (const a of agents) {
    const key = (a.device_label ?? '').toLowerCase();
    by.set(key, [...(by.get(key) ?? []), a]);
  }
  return [...by].map(([key, list]) => {
    const active = list.filter((a) => a.status === 'active').length;
    return {
      device_label: key === '' ? null : key,
      display_name: list[0]?.device_label ?? 'Unnamed device',
      recognised: true,
      last_seen_at: null,
      active_count: active,
      revoked_count: list.length - active,
      agents: list,
    };
  });
}

/** The same agents as `GET /devices` serves them (LAI-1045): one device per label. */
function v3DevicesOf(agents: readonly Agent[]) {
  return devicesOf(agents).map((d, i) => ({
    id: `d${String(i + 1)}`,
    display_name: d.display_name,
    device_label: d.device_label,
    kind: d.device_label === 'cloud' ? 'cloud' : 'local',
    origin: 'imported',
    status: 'active',
    confirmed: true,
    confirmed_at: null,
    paired_at: null,
    key_fingerprint: null,
    last_seen_at: d.last_seen_at,
    active_count: d.active_count,
    revoked_count: d.revoked_count,
    agents: d.agents,
    created_at: 1,
    revoked_at: null,
  }));
}

function stub(mode: Mode | 'absent', agents: readonly Agent[] = [], over: ApiStub = {}): ApiStub {
  return {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': { data: agents, next_cursor: null },
    '/api/v1/agents/devices': { data: devicesOf(agents) },
    '/api/v1/devices': { data: v3DevicesOf(agents) },
    '/api/v1/org': {
      id: 'org1',
      name: 'Kvell Dynamics',
      presence_enabled: true,
      developer_insights: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/me/activity-sharing': {
      org_enabled: false,
      enabled: false,
      person_can_opt_out: false,
      scope: 'agent-repos',
      min_sync_interval_s: 600,
    },
    '/api/v1/me/local-activity': {
      start: '2026-10-02',
      end: '2026-10-15',
      tz: 'UTC',
      days: [],
      collectors: 0,
      oldest_day: null,
    },
    ...(mode === 'absent' ? {} : { '/api/v1/developer/compatibility': compat(mode) }),
    ...over,
  };
}

after(async () => {
  await closeBrowser();
});

const tabs = async (page: Page) =>
  (await page.locator('.page-tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

const active = async (page: Page) =>
  (await page.locator('.page-tab-active').getAttribute('data-tab')) ?? '';

const here = (page: Page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};

/** Land on `path` and wait for the page to have settled on a tab. */
async function land(
  h: Harness,
  path: string,
): Promise<{ url: string; tab: string; depth: number }> {
  await h.page.goto(`${h.origin}${path}`);
  await h.page.locator('.page-tab-active').waitFor({ timeout: 20_000 });
  return {
    url: here(h.page),
    tab: await active(h.page),
    depth: await h.page.evaluate(() => history.length),
  };
}

/** Plan §C, row by row: where each old address lands, per mode. */
const ROUTES: readonly {
  readonly from: string;
  readonly old: { readonly url: string; readonly tab: string };
  readonly v3: { readonly url: string; readonly tab: string };
}[] = [
  {
    from: '/connect',
    old: { url: '/developer?tab=connect', tab: 'connect' },
    v3: { url: '/developer?tab=overview', tab: 'overview' },
  },
  {
    from: '/developer/connect?agent=codex&step=2',
    old: { url: '/developer?tab=connect&agent=codex&step=2', tab: 'connect' },
    v3: { url: '/developer?tab=devices&add=tool&tool=codex', tab: 'devices' },
  },
  {
    from: '/tokens?utm=mail',
    old: { url: '/developer?tab=tokens&utm=mail', tab: 'tokens' },
    v3: { url: '/developer?tab=advanced&utm=mail', tab: 'advanced' },
  },
  {
    from: '/developer?tab=connect&step=2',
    old: { url: '/developer?tab=connect&step=2', tab: 'connect' },
    v3: { url: '/developer?tab=devices&add=tool', tab: 'devices' },
  },
  {
    from: '/developer?tab=agents&agent=a1',
    old: { url: '/developer?tab=agents&agent=a1', tab: 'agents' },
    v3: { url: '/developer?tab=devices&agent=a1', tab: 'devices' },
  },
  {
    from: '/developer?tab=tokens',
    old: { url: '/developer?tab=tokens', tab: 'tokens' },
    v3: { url: '/developer?tab=advanced', tab: 'advanced' },
  },
  {
    from: '/developer?tab=projects',
    old: { url: '/developer?tab=projects', tab: 'projects' },
    v3: { url: '/developer?tab=projects', tab: 'projects' },
  },
  {
    from: '/developer?tab=activity',
    old: { url: '/developer?tab=activity', tab: 'activity' },
    v3: { url: '/developer?tab=activity', tab: 'activity' },
  },
  {
    from: '/developer',
    old: { url: '/developer', tab: 'connect' },
    v3: { url: '/developer', tab: 'overview' },
  },
  {
    from: '/developer?tab=nonsense',
    old: { url: '/developer?tab=nonsense', tab: 'connect' },
    v3: { url: '/developer?tab=nonsense', tab: 'overview' },
  },
];

void describe('every old address lands, in each mode (plan §C)', () => {
  for (const mode of ['classic', 'preview', 'v3'] as const) {
    void test(`${mode}: each row lands as a replace, the query kept`, async () => {
      const h = await open('/developer?tab=activity', stub(mode, [agentRow({ id: 'a1' })]));
      try {
        // The control: an address nothing moves, opened the same way.
        const control = await land(h, '/developer?tab=activity');
        for (const row of ROUTES) {
          const want = mode === 'v3' ? row.v3 : row.old;
          const got = await land(h, row.from);
          assert.equal(got.url, want.url, `${row.from} in ${mode}`);
          assert.equal(got.tab, want.tab, `${row.from} in ${mode}: active tab`);
          // A push would leave the old address in history, one deeper per hop.
          assert.equal(got.depth, control.depth + ROUTES.indexOf(row) + 1, `${row.from}: pushed`);
        }
      } finally {
        await h.close();
      }
    });
  }

  void test('Back from a moved address goes to the page before it, not to the old one', async () => {
    const h = await open('/developer?tab=activity', stub('v3'));
    try {
      await h.page.locator('.page-tab-active').waitFor({ timeout: 20_000 });
      await land(h, '/tokens');
      assert.equal(here(h.page), '/developer?tab=advanced');
      await h.page.goBack();
      await h.page.locator('.page-tab-active').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=activity');
    } finally {
      await h.close();
    }
  });

  void test('a board without the endpoint, or a mode it does not know, is classic', async () => {
    for (const s of [
      stub('absent'),
      stub('classic', [], { '/api/v1/developer/compatibility': refuse(500, 'internal', 'down') }),
      stub('classic', [], {
        '/api/v1/developer/compatibility': { features: { developer_access: 'v4' } },
      }),
    ]) {
      const h = await open('/connect', s);
      try {
        await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
        assert.deepEqual(await tabs(h.page), [
          'Connect',
          'Agents',
          'Projects',
          'Activity',
          'Tokens',
        ]);
        assert.equal(here(h.page), '/developer?tab=connect');
      } finally {
        await h.close();
      }
    }
  });
});

void describe('the tab bars (plan §I)', () => {
  void test('preview: the classic five, then the V3 tabs marked Preview, and banners both ways', async () => {
    const h = await open('/developer', stub('preview'));
    try {
      await h.page.locator('.conn-wizard-card').waitFor({ timeout: 20_000 });
      assert.deepEqual(await tabs(h.page), [
        'Connect',
        'Agents',
        'Projects',
        'Activity',
        'Tokens',
        'Overview Preview',
        'Devices Preview',
        'Advanced Preview',
      ]);
      const banner = h.page.getByRole('complementary', { name: 'Preview' });
      assert.match(await banner.innerText(), /Try the new Developer access/);
      await banner.getByRole('link', { name: 'Open the preview' }).click();
      await h.page.locator('[data-testid="dev-overview"]').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=overview');
      assert.match(
        await h.page.getByRole('complementary', { name: 'Preview' }).innerText(),
        /classic tabs are unchanged/,
      );
      // The classic Projects tab is the classic card, with no V3 note above it.
      await h.page.locator('.page-tab[data-tab="projects"]').click();
      await h.page.locator('.dev-projects').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.dev-v3-help').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('v3: Overview first, no preview marks, and the new header line', async () => {
    const h = await open('/developer', stub('v3'));
    try {
      await h.page.locator('[data-testid="dev-overview"]').waitFor({ timeout: 20_000 });
      assert.deepEqual(await tabs(h.page), [
        'Overview',
        'Project setup',
        'Devices',
        'Activity',
        'Advanced',
      ]);
      assert.equal(await h.page.getByRole('complementary', { name: 'Preview' }).count(), 0);
      assert.match(
        await h.page.locator('.screen-page-desc').innerText(),
        /Connect your devices and coding tools/,
      );
    } finally {
      await h.close();
    }
  });

  void test('v3: Devices lists devices; Activity and Advanced carry what they re-host; Project setup its flow', async () => {
    const h = await open('/developer?tab=devices', stub('v3', [agentRow({ id: 'a1' })]));
    try {
      // LAI-1054: Devices is its own list now, not the classic Agents tab.
      await h.page.locator('.dv3-device[data-device="d1"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-testid="agents-tab"]').count(), 0);
      await h.page.locator('.page-tab[data-tab="projects"]').click();
      // Project setup is the real flow since LAI-1052 (project-setup.test.ts).
      await h.page
        .getByRole('heading', { name: 'Set up a project repository' })
        .waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.dev-projects-body').count(), 1);
      await h.page.locator('.page-tab[data-tab="activity"]').click();
      await h.page.locator('.dev-sharing').waitFor({ timeout: 20_000 });
      await h.page.locator('.page-tab[data-tab="advanced"]').click();
      await h.page.locator('.dev-advanced .tokens').waitFor({ timeout: 20_000 });
      // *New token* sits in Advanced itself, not in the page header.
      await h.page
        .locator('.dev-advanced-actions')
        .getByRole('button', { name: /New token/ })
        .waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page
          .locator('.screen-page-actions')
          .getByRole('button', { name: /New token/ })
          .count(),
        0,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the Overview (LAI-1048)', () => {
  void test('first run: three steps, the first current, and Continue opens the wizard', async () => {
    const h = await open('/developer', stub('v3'));
    try {
      const rail = h.page.getByRole('navigation', { name: 'Getting started' });
      await rail.waitFor({ timeout: 20_000 });
      const steps = await rail
        .locator('.conn-step')
        .evaluateAll((els) =>
          els.map((el) => `${el.getAttribute('data-state') ?? ''}:${el.textContent?.trim() ?? ''}`),
        );
      assert.equal(steps.length, 3);
      assert.match(steps[0] ?? '', /^current:1Step 1: Add a deviceNot yet$/);
      assert.match(steps[2] ?? '', /^todo:.*Set up a project/);
      assert.equal(await rail.locator('.conn-rail-step').nth(2).isDisabled(), true);
      // No summary for someone who has nothing yet.
      assert.equal(await h.page.getByRole('link', { name: 'Set up a project' }).count(), 0);

      const go = h.page.getByRole('link', { name: 'Continue' });
      assert.equal(await go.getAttribute('href'), '/developer?tab=devices&add=device');

      // Keyboard only: Tab until Continue has focus, then Enter.
      await h.page.locator('body').focus();
      for (let i = 0; i < 60; i++) {
        await h.page.keyboard.press('Tab');
        const onIt = await h.page.evaluate(
          () => document.activeElement?.textContent === 'Continue',
        );
        if (onIt) break;
      }
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent),
        'Continue',
        'Continue is not reachable by Tab',
      );
      await h.page.keyboard.press('Enter');
      // The V3 Add device wizard (LAI-1061), not the classic registration one.
      await h.page.locator('[data-wizard="device"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.agents-wizard').count(), 0);
      assert.equal(here(h.page), '/developer?tab=devices&add=device');

      // Cancel: the address forgets the wizard, and focus is on the button
      // that stands for it on the Devices tab (LAI-1054).
      await h.page.getByRole('button', { name: 'Cancel' }).click();
      await h.page.locator('[data-wizard="device"]').waitFor({ state: 'detached' });
      assert.equal(here(h.page), '/developer?tab=devices');
      await h.page.waitForFunction(
        () => document.activeElement?.textContent?.trim() === '+ Add device',
        undefined,
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('a tool registered but never heard from: step 2, and Continue goes to its row', async () => {
    const h = await open('/developer', stub('v3', [agentRow({ id: 'a1', harness: 'codex' })]));
    try {
      const rail = h.page.getByRole('navigation', { name: 'Getting started' });
      await rail.waitFor({ timeout: 20_000 });
      assert.equal(await rail.locator('.conn-step[data-state="done"]').count(), 1);
      assert.match(
        await rail.locator('.conn-step[data-state="current"]').innerText(),
        /Add a coding tool[\s\S]*Registered, not connected yet/,
      );
      assert.match(await h.page.locator('.dev-journey-next').innerText(), /Codex · Belka/);
      await h.page.getByRole('link', { name: 'Continue' }).click();
      await h.page.locator('.dv3-tool[data-agent="a1"]').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=devices&agent=a1');
      await h.page.waitForFunction(() => document.activeElement?.id === 'tool-a1', undefined, {
        timeout: 10_000,
      });
    } finally {
      await h.close();
    }
  });

  void test('returning: no funnel, Set up a project first, every tool with its word', async () => {
    const now = Date.now();
    const agents = [
      agentRow({
        id: 'a1',
        harness: 'omnigent',
        last_seen_at: now - 60_000,
        grants: [{ project_id: 'p1', scope: 'full' }],
      }),
      agentRow({ id: 'a2', harness: 'codex', device_label: 'Strelka', created_at: 2 }),
    ];
    const h = await open('/developer', stub('v3', agents));
    try {
      await h.page.locator('.dev-summary').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('navigation', { name: 'Getting started' }).count(), 0);
      const actions = await h.page.locator('.dev-summary-actions a').allInnerTexts();
      assert.deepEqual(actions, ['Add a tool', 'Set up a project']);
      assert.match(
        (await h.page.getByRole('link', { name: 'Set up a project' }).getAttribute('class')) ?? '',
        /bar-control-primary/,
      );
      const facts = await h.page.locator('.dev-summary-facts > div').allInnerTexts();
      assert.deepEqual(
        facts.map((f) => f.replace(/\s+/g, ' ').trim()),
        ['Devices 2', 'Tools 2', 'Projects they can reach 1'],
      );
      const rows = (await h.page.locator('.dev-summary-tools li').allInnerTexts()).map((r) =>
        r.replace(/\s+/g, ' ').trim(),
      );
      assert.equal(rows.length, 2);
      assert.match(rows[0] ?? '', /^Codex · Strelka Not connected yet · No request from it yet$/);
      assert.match(rows[1] ?? '', /^Omnigent · Belka Active · Last seen 1 min ago$/);
      assert.match(
        await h.page.locator('.dev-summary-note').innerText(),
        /One tool has not connected/,
      );

      await h.page.getByRole('link', { name: 'Set up a project' }).click();
      await h.page.locator('.dev-projects').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=projects');
      assert.equal(await active(h.page), 'projects');
    } finally {
      await h.close();
    }
  });

  void test('a change on refetch is announced, and focus moves to the new main action (review round 1)', async () => {
    const now = Date.now();
    const later = [
      agentRow({ id: 'a1', harness: 'omnigent', last_seen_at: now - 60_000 }),
      agentRow({ id: 'a2', harness: 'codex', device_label: 'Strelka', created_at: 2 }),
    ];
    let reads = 0;
    const h = await open(
      '/developer',
      stub('v3', [], {
        '/api/v1/agents/devices': () => {
          reads += 1;
          return { data: reads === 1 ? [] : devicesOf(later) };
        },
      }),
    );
    try {
      const region = h.page.locator('[data-testid="dev-overview"] > p[aria-live="polite"]');
      await h.page.getByRole('link', { name: 'Continue' }).waitFor({ timeout: 20_000 });
      // Mounted empty: the first answer is what the page shows, not news.
      assert.equal(await region.getAttribute('role'), 'status');
      assert.equal((await region.textContent()) ?? '', '');

      await h.page.getByRole('link', { name: 'Continue' }).focus();
      // The reader comes back to the tab: the Overview reads again.
      await h.page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await h.page.locator('.dev-summary').waitFor({ timeout: 20_000 });
      assert.ok(reads >= 2, 'the Overview did not read again');

      await h.page.waitForFunction(
        (el) => el?.textContent === '2 tools on this board, 1 connected.',
        await region.elementHandle(),
        { timeout: 10_000 },
      );
      // Continue went with the journey; focus is on the summary's main action, not body.
      await h.page.waitForFunction(
        () => document.activeElement?.textContent === 'Set up a project',
        undefined,
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('a change on refetch leaves focus alone when it was somewhere else', async () => {
    let reads = 0;
    const h = await open(
      '/developer',
      stub('v3', [], {
        '/api/v1/agents/devices': () => {
          reads += 1;
          return {
            data: reads === 1 ? [] : devicesOf([agentRow({ id: 'a1', last_seen_at: Date.now() })]),
          };
        },
      }),
    );
    try {
      await h.page.getByRole('link', { name: 'Continue' }).waitFor({ timeout: 20_000 });
      await h.page.locator('.page-tab[data-tab="activity"]').focus();
      await h.page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await h.page.locator('.dev-summary').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-tab')),
        'activity',
      );
    } finally {
      await h.close();
    }
  });

  void test('an old link with a tool opens the wizard on that tool', async () => {
    const h = await open('/connect?agent=codex', stub('v3'));
    try {
      await h.page.locator('[data-wizard="tool"]').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=devices&add=tool&tool=codex');
      // No device is paired here, so the tool is kept for after pairing (LAI-1061).
      await h.page.locator('[data-kept-tool="codex"]').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('[data-wizard="tool"]').innerText(), /Codex is kept/);
    } finally {
      await h.close();
    }
  });
});

void describe('the Overview’s states', () => {
  void test('loading, then an error with a retry that works', async () => {
    let calls = 0;
    const h = await open(
      '/developer',
      stub('v3', [], {
        '/api/v1/agents/devices': () => {
          calls += 1;
          return calls === 1 ? refuse(503, 'unavailable', 'Try again shortly.') : { data: [] };
        },
      }),
    );
    try {
      await h.page.getByText('Could not load your devices').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Try again' }).click();
      await h.page
        .getByRole('navigation', { name: 'Getting started' })
        .waitFor({ timeout: 20_000 });
    } finally {
      await h.close();
    }
  });

  void test('403 is the permission state, never an empty journey', async () => {
    const h = await open(
      '/developer',
      stub('v3', [], { '/api/v1/agents/devices': refuse(403, 'forbidden', 'Not yours.') }),
    );
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.state-forbidden').innerText(),
        /You do not have access to your devices/,
      );
      assert.equal(await h.page.getByRole('navigation', { name: 'Getting started' }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('an expired session goes to sign-in', async () => {
    const h = await open(
      '/developer',
      stub('v3', [], { '/api/v1/agents/devices': refuse(401, 'unauthorized', 'Signed out.') }),
    );
    try {
      await h.page.waitForURL(/\/login/, { timeout: 20_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('look and fit', () => {
  void test('the wizard parts on the Overview are drawn with Connect’s sheet', async () => {
    const h = await open('/developer', stub('v3'));
    try {
      const step = h.page.locator('.conn-step[data-state="current"] .conn-step-n');
      await step.waitFor({ timeout: 20_000 });
      const look = await step.evaluate((el) => {
        const css = getComputedStyle(el);
        const button = el.closest('.conn-rail-step');
        return {
          display: button === null ? '' : getComputedStyle(button).display,
          radius: css.borderTopLeftRadius,
          width: css.width,
          background: css.backgroundColor,
        };
      });
      assert.equal(look.display, 'flex', 'the rail step is unstyled');
      assert.equal(look.width, '32px', 'the step number is unstyled');
      assert.notEqual(look.background, 'rgba(0, 0, 0, 0)', 'the current step has no fill');
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark']) {
    void test(`390px, ${theme}: no sideways scroll on any V3 tab`, async () => {
      const now = Date.now();
      const h = await open(
        '/developer',
        stub('v3', [
          agentRow({ id: 'a1', last_seen_at: now, grants: [{ project_id: 'p1', scope: 'full' }] }),
        ]),
      );
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await setTheme(h.page, theme);
        for (const tab of ['overview', 'projects', 'devices', 'activity', 'advanced']) {
          await land(h, `/developer?tab=${tab}`);
          await h.page.locator('.dev-body').first().waitFor({ timeout: 20_000 });
          const wide = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(wide <= 0, `${tab} scrolls sideways by ${String(wide)}px in ${theme}`);
        }
      } finally {
        await h.close();
      }
    });
  }
});
