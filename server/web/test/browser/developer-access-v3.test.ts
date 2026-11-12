/**
 * Developer access V3, behind `features.developer_access` (LAI-1048, plan §C,
 * §I, §J slice D1), in a real browser.
 *
 * - Every old address of plan §C lands where that mode says, as a `replace`
 *   (history does not grow), with the rest of the query kept.
 * - The Overview is worked out from `GET /devices` — the Devices tab's read —
 *   and the reader's setup records (LAI-1079): one next step per state, the
 *   journey, the connection status and the repository setups.
 * - Its states: an error for either read, `403`, and an expired session.
 * - Keyboard only, a phone's width in both themes, and the Overview drawn
 *   with the design kit's sheet.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  OVERVIEW_ADDRESSES,
  toolAddress,
} from '../../src/routes/screens/developer/v3/overview-state.ts';
import { closeBrowser, open, refuse, setTheme, type ApiStub, type Harness } from './harness.ts';
import { NEVER_REPORTED } from '../helpers/launcher.ts';
import { tooltipText } from './tooltip-text.ts';

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
  launcher: NEVER_REPORTED,
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
      launcher: NEVER_REPORTED,
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
    launcher: NEVER_REPORTED,
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
    // The reader's setup records across every project (LAI-1077): none.
    '/api/v1/project-setups': { data: [] },
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
    // A board without the endpoint: refused, so the harness's own classic
    // answer for an unnamed path (LAI-1076) does not stand in for it.
    '/api/v1/developer/compatibility':
      mode === 'absent' ? refuse(404, 'not_found', 'no such route') : compat(mode),
    ...over,
  };
}

after(async () => {
  await closeBrowser();
});

const tabs = async (page: Page) =>
  (await page.locator('.page-tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

/**
 * Until every animation on the page has ended. A cancelled one counts as ended:
 * a theme switch cancels the transition it interrupts, and its `finished`
 * rejects with `AbortError` (LAI-1141). It may start another in its place, so
 * the page is asked again until nothing is left running.
 */
const settle = (page: Page) =>
  page.evaluate(async () => {
    for (let round = 0; round < 10; round += 1) {
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      if (running.length === 0) return;
      await Promise.allSettled(running.map((a) => a.finished));
    }
  });

/** V3's *Advanced*, drawn after the four tabs as a quieter link (LAI-1096). */
const advancedLink = (page: Page) => page.locator('.dx-tabrow > a.dx-tab-secondary');

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
    v3: { url: '/developer?tab=tools&add=tool&tool=codex', tab: 'tools' },
  },
  {
    from: '/tokens?utm=mail',
    old: { url: '/developer?tab=tokens&utm=mail', tab: 'tokens' },
    v3: { url: '/developer?tab=advanced&utm=mail', tab: 'advanced' },
  },
  {
    from: '/developer?tab=connect&step=2',
    old: { url: '/developer?tab=connect&step=2', tab: 'connect' },
    v3: { url: '/developer?tab=tools&add=tool', tab: 'tools' },
  },
  {
    from: '/developer?tab=agents&agent=a1',
    old: { url: '/developer?tab=agents&agent=a1', tab: 'agents' },
    v3: { url: '/developer?tab=tools&agent=a1', tab: 'tools' },
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
    // LAI-1078: Share local activity is Advanced's second card in v3.
    v3: { url: '/developer?tab=advanced&section=activity', tab: 'advanced' },
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
      const h = await open('/developer?tab=projects', stub(mode, [agentRow({ id: 'a1' })]));
      try {
        // The control: an address nothing moves, opened the same way.
        const control = await land(h, '/developer?tab=projects');
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
    const h = await open('/developer?tab=projects', stub('v3'));
    try {
      await h.page.locator('.page-tab-active').waitFor({ timeout: 20_000 });
      await land(h, '/tokens');
      assert.equal(here(h.page), '/developer?tab=advanced');
      await h.page.goBack();
      await h.page.locator('.page-tab-active').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=projects');
    } finally {
      await h.close();
    }
  });

  void test('a board without the endpoint, or a mode it does not know, is v3 (LAI-1076)', async () => {
    for (const s of [
      stub('absent'),
      stub('classic', [], { '/api/v1/developer/compatibility': refuse(500, 'internal', 'down') }),
      stub('classic', [], {
        '/api/v1/developer/compatibility': { features: { developer_access: 'v4' } },
      }),
    ]) {
      const h = await open('/developer', s);
      try {
        await h.page.locator('[data-testid="dev-overview"]').waitFor({ timeout: 20_000 });
        assert.deepEqual(await tabs(h.page), ['Overview', 'Project setup', 'Devices', 'Tools']);
        assert.equal(await advancedLink(h.page).getAttribute('data-tab'), 'advanced');
        assert.equal(await h.page.locator('.conn-wizard-card').count(), 0);
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
      // Classic's header on a classic tab: the page's name is its title.
      assert.equal(await h.page.locator('.screen-page-title').innerText(), 'Developer access');
      assert.equal(await h.page.locator('.screen-page-eyebrow').count(), 0);
      // Preview's bar is not the design's: Advanced is a tab like the rest.
      assert.equal(await h.page.locator('.dx-tabrow, .dx-tab-secondary').count(), 0);
      assert.deepEqual(await tabs(h.page), [
        'Connect',
        'Agents',
        'Projects',
        'Activity',
        'Tokens',
        'Overview Preview',
        'Devices Preview',
        'Tools Preview',
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
      // The design's four tabs (LAI-1096); Advanced is the quieter link after them.
      assert.deepEqual(await tabs(h.page), ['Overview', 'Project setup', 'Devices', 'Tools']);
      const link = advancedLink(h.page);
      assert.equal(await link.getAttribute('href'), '/developer?tab=advanced');
      assert.equal(await link.getAttribute('aria-current'), null);
      assert.equal((await link.innerText()).replace(/\s+/g, ' ').trim(), 'Advanced');
      // Drawn, not typed (LAI-1214): the chevron is the registry's.
      assert.equal(await link.locator('[data-icon="chevron"]').count(), 1);
      // After the tabs, in the same row, and quieter than a tab.
      const [strip, after] = await Promise.all([
        h.page.locator('.dx-tabrow .page-tabs').boundingBox(),
        link.boundingBox(),
      ]);
      assert.ok(strip !== null && after !== null);
      assert.ok(after.x >= strip.x + strip.width - 1, 'Advanced is not after the tabs');
      assert.ok(Math.abs(after.y - strip.y) < 2, 'Advanced is not in the tab row');
      const [linkColour, tabColour] = await Promise.all([
        link.evaluate((el) => getComputedStyle(el).color),
        h.page
          .locator('.page-tab[data-tab="projects"]')
          .evaluate((el) => getComputedStyle(el).color),
      ]);
      assert.notEqual(linkColour, tabColour, 'Advanced is drawn as loud as a tab');
      // The header (LAI-1096): the page's name is the eyebrow, over the design's title.
      assert.equal(await h.page.locator('.screen-page-eyebrow').innerText(), 'DEVELOPER ACCESS');
      assert.equal(await h.page.locator('.screen-page-eyebrow').textContent(), 'Developer access');
      assert.equal(
        await h.page.getByRole('heading', { level: 1 }).innerText(),
        'Connect your work to Laika',
      );
      assert.equal(await h.page.getByRole('complementary', { name: 'Preview' }).count(), 0);
      // The owner's design's sentence (LAI-1078).
      assert.equal(
        await h.page.locator('.screen-page-desc').innerText(),
        'Pair your computer once, connect your coding tools, then set up each project repository. Project setup is where work becomes connected.',
      );
    } finally {
      await h.close();
    }
  });

  void test('v3: Devices lists devices; Advanced carries credentials and activity; Project setup its flow', async () => {
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
      // Drawn as the design's three-step wizard since LAI-1082; its title
      // shows while the tools load, so wait for the wizard itself.
      const wizard = h.page.locator('.dev-setup [data-wizard="project-setup"]');
      await wizard.waitFor({ timeout: 20_000 });
      assert.equal(await wizard.count(), 1);
      // No Activity tab in v3 (LAI-1078): its card is Advanced's second.
      assert.equal(await h.page.locator('.page-tab[data-tab="activity"]').count(), 0);
      await advancedLink(h.page).click();
      await h.page.locator('.dev-advanced .dev-adv').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=advanced');
      // On its own page the link is marked as a tab is, and no tab is: the
      // accent and its underline, as the active tab draws them.
      assert.equal(await advancedLink(h.page).getAttribute('aria-current'), 'page');
      const marked = await advancedLink(h.page).evaluate((el) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        const got = getComputedStyle(el);
        return { color: got.color, underline: got.borderBottomColor, accent };
      });
      assert.deepEqual(marked, {
        color: marked.accent,
        underline: marked.accent,
        accent: marked.accent,
      });
      assert.equal(await h.page.locator('.page-tab-active').count(), 1);
      assert.equal(await active(h.page), 'advanced');
      assert.equal(await h.page.locator('.page-tab[aria-current]').count(), 0);
      await h.page.locator('.dev-advanced-page .dev-sharing').waitFor({ timeout: 20_000 });
      // *New personal credential* sits in Advanced itself, not in the page
      // header (LAI-1058; developer-advanced.test.ts has the rest).
      await h.page
        .locator('.dev-advanced')
        .getByRole('button', { name: /New personal credential/ })
        .waitFor({ timeout: 10_000 });
      assert.equal(
        await h.page
          .locator('.screen-page-actions')
          .getByRole('button', { name: /New (token|personal credential)/ })
          .count(),
        0,
      );
    } finally {
      await h.close();
    }
  });
});

/*
 * The Overview's fixtures (LAI-1079). `GET /devices` as the server answers
 * it — a paired device may have no tool at all, which `v3DevicesOf` cannot
 * say — tools with a live credential where they are meant to be connected,
 * and the reader's setup records across every project (`GET /project-setups`
 * with no project, LAI-1077).
 */
const LIVE_TOKEN = {
  id: 't1',
  name: 'agent',
  prefix: 'lai_abcd',
  scope: 'full',
  project_ids: null,
  last_used_at: null,
  last_mcp_at: null,
  last_client: null,
  last_client_name: null,
  kind: 'agent',
  agent_id: null as string | null,
  agent_label: null,
  expires_at: null,
  revoked_at: null,
  created_at: 1,
};

type Tool = Omit<Agent, 'tokens'> & { tokens: (typeof LIVE_TOKEN)[] };

/** A tool on the board: a live credential, seen a minute ago unless `last_seen_at` says not. */
const tool = (over: Partial<AgentRow> & { id: string }): Tool => ({
  ...agentRow({ last_seen_at: Date.now() - 60_000, ...over }),
  tokens: [{ ...LIVE_TOKEN, id: `t-${over.id}`, agent_id: over.id }],
});

const deviceRow = (
  id: string,
  name: string,
  tools: readonly Tool[],
  origin: 'paired' | 'imported' = 'paired',
) => {
  const active = tools.filter((t) => t.status === 'active').length;
  return {
    id,
    display_name: name,
    device_label: name.toLowerCase(),
    kind: 'local',
    origin,
    status: 'active',
    confirmed: true,
    confirmed_at: 1,
    paired_at: origin === 'paired' ? 1 : null,
    key_fingerprint: null,
    last_seen_at: null,
    active_count: active,
    revoked_count: tools.length - active,
    agents: tools,
    launcher: NEVER_REPORTED,
    created_at: 1,
    revoked_at: null,
  };
};

type DeviceRow = ReturnType<typeof deviceRow>;

const setupRecord = (over: Record<string, unknown> & { id: string }) => ({
  agent_id: 'a1',
  device_label: 'Belka',
  project_id: 'p1',
  project_slug: 'onroute',
  repo_label: null,
  repo_key: '',
  instructions_path: 'CLAUDE.md',
  block_found: true,
  template_revision: 2,
  project_match: null,
  prefix_match: null,
  source: 'self_reported_browser',
  checked_at: Date.now() - 60_000,
  ...over,
});

const localCheck = (over: Record<string, unknown> & { id: string }) =>
  setupRecord({
    source: 'local_check',
    repo_label: 'onroute-app',
    repo_key: 'a'.repeat(64),
    project_match: true,
    prefix_match: true,
    ...over,
  });

/** The v3 stub, with these devices and setup records. */
function overview(
  devices: readonly DeviceRow[],
  setups: readonly ReturnType<typeof setupRecord>[] = [],
  over: ApiStub = {},
): ApiStub {
  return stub('v3', [], {
    '/api/v1/devices': { data: devices },
    '/api/v1/project-setups': { data: setups },
    ...over,
  });
}

/** Each state the hero has (LAI-1079), as the evidence run and the 390 checks draw it. */
const STATES = {
  fresh: () => overview([]),
  'device-only': () => overview([deviceRow('d1', 'Belka', [])]),
  'tool-never-seen': () =>
    overview([
      deviceRow('d1', 'Belka', [tool({ id: 'a1', harness: 'codex', last_seen_at: null })]),
    ]),
  'connected-no-setup': () =>
    overview(
      [
        deviceRow('d1', 'Belka', [
          tool({ id: 'a1', harness: 'omnigent', grants: [{ project_id: 'p1', scope: 'full' }] }),
        ]),
        deviceRow(
          'd2',
          'Strelka',
          [
            tool({
              id: 'a2',
              harness: 'codex',
              device_label: 'Strelka',
              last_seen_at: null,
              created_at: 2,
            }),
            tool({ id: 'a3', device_label: 'Strelka', last_seen_at: null, created_at: 3 }),
          ],
          'imported',
        ),
      ],
      [],
    ),
  'all-done': () =>
    overview(
      [
        deviceRow('d1', 'Belka', [
          tool({ id: 'a1', grants: [{ project_id: 'p1', scope: 'full' }] }),
          tool({
            id: 'a2',
            harness: 'codex',
            created_at: 2,
            grants: [{ project_id: 'p1', scope: 'full' }],
          }),
        ]),
      ],
      [
        localCheck({ id: 's1' }),
        setupRecord({ id: 's2', agent_id: 'a2', instructions_path: 'AGENTS.md' }),
        localCheck({
          id: 's3',
          project_id: 'p2',
          project_slug: 'atlas',
          repo_label: 'atlas-web',
          template_revision: 1,
        }),
      ],
    ),
} as const;

type OverviewStateName = keyof typeof STATES;

const hero = (page: Page) => page.locator('[data-testid="dev-overview"] .dx-hero');

/** The hero, once it has drawn: its kind, eyebrow, title and links. */
async function readHero(page: Page) {
  const h = hero(page);
  await h.waitFor({ timeout: 20_000 });
  const links = await h
    .locator('.dx-actions a')
    .evaluateAll((els) => els.map((el) => [el.textContent ?? '', el.getAttribute('href') ?? '']));
  return {
    kind: (await h.getAttribute('data-hero')) ?? '',
    eyebrow: await h.locator('.dx-eyebrow').innerText(),
    title: await h.locator('.dx-hero-title').innerText(),
    links,
  };
}

/** The journey's rows: step, state, the line, and its one action. */
async function readJourney(page: Page) {
  const card = page.locator('[data-journey]');
  return {
    chip: await card.locator('.dx-card-head .dx-chip').innerText(),
    rows: await card.locator('.dx-flow-row').evaluateAll((els) =>
      els.map((el) => {
        const action = el.querySelector('.dx-btn');
        return {
          step: el.getAttribute('data-step') ?? '',
          state: el.getAttribute('data-state') ?? '',
          line: el.querySelector('.dx-flow-line')?.textContent ?? '',
          action: action?.childNodes[0]?.textContent ?? '',
          href: action?.getAttribute('href') ?? null,
          // Off with a reason (LAI-1214): aria-disabled, still focusable, and
          // the reason in the shared tooltip it is described by.
          disabled:
            action instanceof HTMLButtonElement
              ? action.disabled || action.getAttribute('aria-disabled') === 'true'
              : false,
          why:
            (action?.getAttribute('aria-describedby') ?? '')
              .split(/\s+/)
              .map((id) => (id === '' ? null : document.getElementById(id)))
              .find((tip) => tip?.getAttribute('role') === 'tooltip')?.textContent ?? null,
        };
      }),
    ),
  };
}

/** Connection status, row by row: what is counted, the names, the chip. */
const readStatus = (page: Page) =>
  page
    .locator('[data-status] .dx-stat')
    .evaluateAll((els) =>
      els.map((el) =>
        [
          el.getAttribute('data-stat') ?? '',
          el.querySelector('.dx-stat-count')?.textContent ?? '',
          el.querySelector('.dx-stat-names')?.textContent ?? '',
          el.querySelector('.dx-chip')?.textContent ?? '',
        ].join(' | '),
      ),
    );

/** Your repository setups, row by row: title, line and chip — or the action on the first. */
const readSetups = (page: Page) =>
  page
    .locator('[data-setups] .dx-record')
    .evaluateAll((els) =>
      els.map((el) =>
        [
          el.getAttribute('data-setup') ?? '',
          el.querySelector('.dx-record-title')?.textContent ?? '',
          el.querySelector('.dx-record-sub')?.textContent ?? '',
          el.querySelector('.dx-chip')?.textContent ??
            `${el.querySelector('a')?.textContent ?? ''} ${el.querySelector('a')?.getAttribute('href') ?? ''}`,
        ].join(' | '),
      ),
    );

/** Each repository's devices, line by line: the device, its tools and what its chip says. */
const readDevices = (page: Page) =>
  page.locator('[data-setups] .dx-repo').evaluateAll((rows) =>
    rows.map((row) => ({
      repo: row.querySelector('.dx-record-title')?.textContent ?? '',
      devices: [...row.querySelectorAll('.dx-repo-device')].map((li) =>
        [
          li.querySelector('.dx-repo-device-name')?.textContent ?? '',
          li.querySelector('.dx-repo-device-line')?.textContent ?? '',
          li.querySelector('.dx-chip')?.textContent ?? '',
        ].join(' | '),
      ),
    })),
  );

/** Where *Manage tools* goes. */
const TOOLS_HREF = OVERVIEW_ADDRESSES.tools;

/**
 * Project setup's wizard (LAI-321): the tab opens on the reader's
 * repositories once they have one, so *set up a repository* names the wizard.
 */
const WIZARD_HREF = '/developer?tab=projects&view=wizard';

const NEW_SETUP_ROW = `new | Set up a new repository | Choose an existing Laika project, your connected tool, then copy a safe prompt into your agent. | Set up repository ${WIZARD_HREF}`;

/** The design's lines for the steps still to do (LAI-1096). */
const LINE = {
  device: 'Pair laptop or cloud runner only',
  tool: 'Give the tool its own credential and verify it',
  project: 'Project-specific prompt · no new token · no re-install',
} as const;

/** The tools chip's list (LAI-1096): opened from the chip, each tool, why and its link. */
async function openAttention(page: Page) {
  const chip = page.locator('[data-status] [data-attention] > button');
  await chip.waitFor({ timeout: 20_000 });
  assert.equal(await chip.getAttribute('aria-expanded'), 'false');
  await chip.click();
  assert.equal(await chip.getAttribute('aria-expanded'), 'true');
  const list = page.getByRole('group', { name: 'Needs your attention' });
  await list.waitFor({ timeout: 10_000 });
  assert.equal(await chip.getAttribute('aria-controls'), await list.getAttribute('id'));
  const items = await list
    .locator('li')
    .evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute('data-agent') ?? '',
        el.querySelector('.dx-attention-name')?.textContent ?? '',
        el.querySelector('.dx-attention-why')?.textContent ?? '',
        el.querySelector('a')?.childNodes[0]?.textContent ?? '',
        el.querySelector('a')?.getAttribute('href') ?? '',
      ]),
    );
  return { chip, list, items };
}

/** Nothing sits between the hero and the journey, as in the design (LAI-1096). */
async function heroThenJourney(page: Page): Promise<boolean> {
  return hero(page).evaluate((el) => el.nextElementSibling?.hasAttribute('data-journey') === true);
}

void describe('the Overview (LAI-1048, LAI-1079)', () => {
  void test('fresh: start here, add a device — by keyboard — and nothing else is offered yet', async () => {
    const h = await open('/developer', STATES.fresh());
    try {
      assert.deepEqual(await readHero(h.page), {
        kind: 'no-device',
        eyebrow: 'START HERE',
        title: 'Start by connecting your device',
        links: [['Add a device', OVERVIEW_ADDRESSES.addDevice]],
      });
      assert.deepEqual(await readJourney(h.page), {
        chip: '0 of 3 complete',
        rows: [
          {
            step: 'device',
            state: 'active',
            line: LINE.device,
            action: 'Start',
            href: OVERVIEW_ADDRESSES.addDevice,
            disabled: false,
            why: null,
          },
          {
            step: 'tool',
            state: 'pending',
            line: LINE.tool,
            action: 'Start',
            href: null,
            disabled: true,
            why: 'Add a device first',
          },
          {
            step: 'project',
            state: 'pending',
            line: LINE.project,
            action: 'Start',
            href: null,
            disabled: true,
            why: 'Connect a tool first',
          },
        ],
      });
      // A locked step says why in words, not only by being greyed out.
      assert.equal(
        await tooltipText(h.page.locator('[data-step="tool"] button')),
        'Add a device first',
      );
      // Off with a reason, it is still reached by Tab (LAI-1214: it was `disabled`).
      await h.page.locator('[data-step="tool"] button').focus();
      assert.ok(
        await h.page
          .locator('[data-step="tool"] button')
          .evaluate((el) => document.activeElement === el),
      );
      assert.match(
        (await h.page.locator('[data-step="tool"] button .visually-hidden').textContent()) ?? '',
        /Add a device first/,
      );
      assert.deepEqual(await readStatus(h.page), [
        'devices | 0 devices | No paired devices | Not added',
        'tools | 0 tools | No tools yet | Not added',
        'setups | 0 repositories set up | Project prompts and instructions files | Next step',
      ]);
      assert.deepEqual(await readSetups(h.page), [NEW_SETUP_ROW]);
      assert.equal(await h.page.locator('[data-attention]').count(), 0);
      assert.equal(await heroThenJourney(h.page), true);
      // "How this works" is gone; the distinction card says the same, honestly.
      const distinction = h.page.locator('[data-distinction]');
      assert.match(
        await distinction.innerText(),
        /IMPORTANT DISTINCTION\s+Access ≠ repository setup/,
      );
      assert.match(await distinction.innerText(), /never carries a credential/);
      assert.equal(
        await distinction.getByRole('link', { name: 'Explore project setup' }).getAttribute('href'),
        '/developer?tab=projects',
      );
      assert.equal(
        await distinction.getByRole('link', { name: 'Advanced' }).getAttribute('href'),
        '/developer?tab=advanced',
      );
      assert.equal(await h.page.getByText('How this works').count(), 0);

      // Keyboard only: Tab until the hero's action has focus, then Enter.
      await h.page.locator('body').focus();
      for (let i = 0; i < 60; i++) {
        await h.page.keyboard.press('Tab');
        const onIt = await h.page.evaluate(
          () => document.activeElement?.textContent === 'Add a device',
        );
        if (onIt) break;
      }
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent),
        'Add a device',
        'Add a device is not reachable by Tab',
      );
      await h.page.keyboard.press('Enter');
      // The V3 Add device wizard (LAI-1061), not the classic registration one.
      await h.page.locator('[data-wizard="device"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.agents-wizard').count(), 0);
      assert.equal(here(h.page), OVERVIEW_ADDRESSES.addDevice);
    } finally {
      await h.close();
    }
  });

  void test('a paired device with no tool counts as a device, and the tool is next', async () => {
    const h = await open('/developer', STATES['device-only']());
    try {
      assert.deepEqual(await readHero(h.page), {
        kind: 'no-tool',
        eyebrow: 'START HERE',
        title: 'Connect a coding tool',
        links: [['Add your first tool', OVERVIEW_ADDRESSES.addTool]],
      });
      const journey = await readJourney(h.page);
      assert.equal(journey.chip, '1 of 3 complete');
      assert.deepEqual(
        journey.rows.map((r) => [r.step, r.state, r.line, r.action, r.href, r.disabled]),
        [
          ['device', 'done', '1 device · Belka', 'Manage', OVERVIEW_ADDRESSES.devices, false],
          ['tool', 'active', LINE.tool, 'Start', OVERVIEW_ADDRESSES.addTool, false],
          ['project', 'pending', LINE.project, 'Start', null, true],
        ],
      );
      assert.deepEqual((await readStatus(h.page)).slice(0, 2), [
        'devices | 1 device | Belka | Paired',
        'tools | 0 tools | No tools yet | Not added',
      ]);
      // The Devices tab's read, not the old one that skipped a device with no tool.
      assert.ok(h.calls.some((c) => c.path === '/api/v1/devices'));
      assert.equal(h.calls.filter((c) => c.path === '/api/v1/agents/devices').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('a tool registered but never heard from: finish connecting it, at its row', async () => {
    const h = await open('/developer', STATES['tool-never-seen']());
    try {
      assert.deepEqual(await readHero(h.page), {
        kind: 'finish-tool',
        eyebrow: 'YOUR NEXT STEP',
        title: 'Finish connecting Codex · Belka',
        links: [['Continue setup', toolAddress('a1')]],
      });
      assert.equal(
        await hero(h.page).locator('.dx-hero-sub').innerText(),
        'Credential created, never used. Finish its setup on Belka; this page moves on once it has connected.',
      );
      const journey = await readJourney(h.page);
      assert.deepEqual(journey.rows[1], {
        step: 'tool',
        state: 'active',
        line: 'Codex · Belka registered, not connected yet',
        action: 'Start',
        href: toolAddress('a1'),
        disabled: false,
        why: null,
      });
      assert.equal(journey.rows[2]?.why, 'Connect a tool first');
      // The tool by name alone; its chip is the button that lists it (LAI-1096).
      assert.deepEqual((await readStatus(h.page))[1], 'tools | 1 tool | Codex | 1 needs setup');
      // Nothing under the hero: the hero is about it, and the chip lists it.
      assert.equal(await heroThenJourney(h.page), true);
      const { items } = await openAttention(h.page);
      assert.deepEqual(items, [
        [
          'a1',
          'Codex · Belka',
          'credential created, never used',
          'Finish setup',
          toolAddress('a1'),
        ],
      ]);

      await hero(h.page).getByRole('link', { name: 'Continue setup' }).click();
      await h.page.waitForURL((url) => `${url.pathname}${url.search}` === toolAddress('a1'), {
        timeout: 20_000,
      });
    } finally {
      await h.close();
    }
  });

  void test('connected, no setup: set up a project, or manage tools; the rest is attention', async () => {
    const h = await open('/developer', STATES['connected-no-setup']());
    try {
      assert.deepEqual(await readHero(h.page), {
        kind: 'no-setup',
        eyebrow: 'YOUR NEXT STEP',
        title: 'Set up your project repository',
        links: [
          ['Set up a project', WIZARD_HREF],
          ['Manage tools', TOOLS_HREF],
        ],
      });
      // Tools not connected yet are no note under the hero any more (LAI-1096):
      // the journey follows it, and they are behind the tools chip.
      assert.equal(await h.page.locator('[data-note]').count(), 0);
      assert.equal(await heroThenJourney(h.page), true);
      const { chip, list, items } = await openAttention(h.page);
      assert.equal(await chip.getAttribute('data-tone'), 'warn');
      assert.deepEqual(items, [
        [
          'a3',
          'Claude Code · Strelka',
          'credential created, never used',
          'Finish setup',
          toolAddress('a3'),
        ],
        [
          'a2',
          'Codex · Strelka',
          'credential created, never used',
          'Finish setup',
          toolAddress('a2'),
        ],
      ]);
      // Each link names its tool for a screen reader.
      await list.getByRole('link', { name: /^Finish setup\s*: Codex · Strelka$/ }).waitFor();
      // Escape closes it and puts focus back on the chip.
      await list.getByRole('link', { name: /^Finish setup\s*: Codex · Strelka$/ }).focus();
      await h.page.keyboard.press('Escape');
      await list.waitFor({ state: 'detached' });
      assert.equal(await chip.getAttribute('aria-expanded'), 'false');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.closest('[data-attention]') !== null),
        true,
      );
      // By keyboard: Enter opens it, and Tab walks into it from the chip.
      await h.page.keyboard.press('Enter');
      await list.waitFor();
      await h.page.keyboard.press('Tab');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('href')),
        toolAddress('a3'),
      );
      // A click outside closes it.
      await h.page.locator('[data-journey] .dx-card-title').click();
      await list.waitFor({ state: 'detached' });
      // A link in it goes to that tool's row, its Details open.
      await (
        await openAttention(h.page)
      ).list
        .getByRole('link', { name: /^Finish setup\s*: Codex · Strelka$/ })
        .click();
      await h.page.waitForURL((url) => `${url.pathname}${url.search}` === toolAddress('a2'), {
        timeout: 20_000,
      });
      await h.page.goBack();
      await hero(h.page).waitFor({ timeout: 20_000 });
      const journey = await readJourney(h.page);
      assert.equal(journey.chip, '2 of 3 complete');
      assert.deepEqual(
        journey.rows.map((r) => [r.state, r.line, r.action, r.href]),
        [
          ['done', '2 devices · Belka, Strelka', 'Manage', OVERVIEW_ADDRESSES.devices],
          ['done', '3 tools registered, 1 connected', 'Manage', TOOLS_HREF],
          ['active', LINE.project, 'Start', WIZARD_HREF],
        ],
      );
      assert.deepEqual(await readStatus(h.page), [
        'devices | 2 devices | Belka, Strelka | 1 imported',
        'tools | 3 tools | Claude Code, Codex, Omnigent | 2 need setup',
        'setups | 0 repositories set up | Project prompts and instructions files | Next step',
      ]);
      // Never Ready, never a claim beyond the evidence.
      assert.doesNotMatch(
        await h.page.locator('[data-testid="dev-overview"]').innerText(),
        /\bReady\b/,
      );

      await hero(h.page).getByRole('link', { name: 'Set up a project' }).click();
      await h.page.waitForURL(/tab=projects/, { timeout: 20_000 });
      // It lands on Project setup's wizard (LAI-1082), not just its address.
      await h.page.locator('.dev-setup[data-view="wizard"]').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), WIZARD_HREF);
      assert.equal(await active(h.page), 'projects');
    } finally {
      await h.close();
    }
  });

  void test('all done: set up another repository, and each setup with the word its records support', async () => {
    const h = await open('/developer', STATES['all-done']());
    try {
      assert.deepEqual(await readHero(h.page), {
        kind: 'all-done',
        eyebrow: 'YOUR NEXT STEP',
        title: 'Set up another repository',
        links: [
          ['Set up a repository', WIZARD_HREF],
          ['Manage tools', TOOLS_HREF],
        ],
      });
      const journey = await readJourney(h.page);
      assert.equal(journey.chip, '3 of 3 complete');
      assert.deepEqual(journey.rows[2], {
        step: 'project',
        state: 'done',
        // Two repositories: OnRoute's, set up by two tools on Belka, and Atlas's.
        line: '2 repository setups',
        // Open is the reader's repositories; the tab opens on them for this reader.
        action: 'Open',
        href: '/developer?tab=projects',
        disabled: false,
        why: null,
      });
      assert.deepEqual(
        (await readStatus(h.page))[2],
        'setups | 2 repositories set up | 1 not verified, 1 to update | 1 needs an update',
      );
      // One row per repository (LAI-321): its name, then the project — its
      // name where the list has it, its slug where it does not — and file.
      // A repository reads as its least certain device: Codex's word on Belka
      // is not verified, though Claude Code's check there was.
      await h.page.locator('[data-setups] [data-repo]').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await readSetups(h.page), [
        NEW_SETUP_ROW,
        'recorded | onroute-app | OnRoute · CLAUDE.md | Recorded by you',
        'update-available | atlas-web | atlas · CLAUDE.md | Update available',
      ]);
      assert.deepEqual(await readDevices(h.page), [
        {
          repo: 'onroute-app',
          devices: ['Belka | Claude Code, Codex · not verified | Recorded by you'],
        },
        { repo: 'atlas-web', devices: ['Belka | Claude Code | Update available'] },
      ]);
      // The design's title; the region keeps the name of what it lists (LAI-1096).
      assert.equal(
        await h.page.locator('[data-setups] .dx-section-heading').innerText(),
        'Project setup is the main outcome',
      );
      assert.equal(await h.page.locator('[data-setups] .dx-section-sub').count(), 0);
      assert.equal(
        await h.page
          .getByRole('region', { name: 'Your repository setups' })
          .getAttribute('data-setups'),
        '',
      );
      // Every tool connected and none to update: a word, not a button.
      assert.equal(await h.page.locator('[data-attention]').count(), 0);
      // The setups list is the full width under both columns.
      const [list, columns] = await Promise.all([
        h.page.locator('[data-setups]').boundingBox(),
        h.page.locator('.dx-columns').boundingBox(),
      ]);
      assert.ok(list !== null && columns !== null);
      assert.ok(list.y >= columns.y + columns.height, 'the setups list is not under the columns');
      assert.equal(Math.round(list.width), Math.round(columns.width));
    } finally {
      await h.close();
    }
  });

  void test('a repository set up on two laptops is one row, each laptop a line under it (LAI-321)', async () => {
    // The owner's own records on 2026-11-04: Laika by three tools on two
    // laptops read "Laika · Laika" three times, and OnRoute's "I've added it"
    // was a bare row of its own.
    const laika = {
      project_id: 'p2',
      project_slug: 'laika',
      repo_label: 'Laika',
      repo_key: 'c'.repeat(64),
    };
    const h = await open(
      '/developer',
      overview(
        [
          deviceRow('d1', 'KvellD 36 GB', [
            tool({ id: 'a1', device_label: 'KvellD 36 GB' }),
            tool({ id: 'a2', harness: 'omnigent', device_label: 'KvellD 36 GB', created_at: 2 }),
          ]),
          deviceRow('d2', 'Pawan 16 GB', [
            tool({ id: 'a3', harness: 'omnigent', device_label: 'Pawan 16 GB', created_at: 3 }),
            tool({ id: 'a4', device_label: 'Pawan 16 GB', created_at: 4 }),
          ]),
        ],
        [
          localCheck({ id: 's1', agent_id: 'a1', ...laika }),
          localCheck({ id: 's2', agent_id: 'a3', ...laika }),
          localCheck({ id: 's3', agent_id: 'a2', instructions_path: 'AGENTS.md', ...laika }),
          localCheck({
            id: 's4',
            agent_id: 'a4',
            repo_label: 'On-Route',
            repo_key: 'd'.repeat(64),
          }),
          setupRecord({ id: 's5', agent_id: 'a4' }),
        ],
      ),
    );
    try {
      await h.page.locator('[data-setups] [data-repo]').first().waitFor({ timeout: 20_000 });
      // Laika once, named once; OnRoute once, its own word under its check.
      assert.deepEqual(await readSetups(h.page), [
        NEW_SETUP_ROW,
        'checked | Laika | CLAUDE.md | Checked',
        'checked | On-Route | CLAUDE.md | Checked',
      ]);
      assert.deepEqual(await readDevices(h.page), [
        {
          repo: 'Laika',
          devices: [
            'KvellD 36 GB | Claude Code, Omnigent | Checked',
            'Pawan 16 GB | Omnigent | Checked',
          ],
        },
        {
          repo: 'On-Route',
          devices: ['Pawan 16 GB | Claude Code · also recorded by you | Checked'],
        },
      ]);
      // Nested as a list of its own, named for its repository.
      assert.equal(
        await h.page
          .getByRole('list', { name: 'Devices that set up Laika' })
          .getByRole('listitem')
          .count(),
        2,
      );
      // Counted as the two repositories they are.
      assert.equal(
        (await readStatus(h.page))[2],
        'setups | 2 repositories set up | 2 checked | Checked',
      );

      // A reader with setups still reaches the wizard from here, not their list.
      await h.page.getByRole('link', { name: 'Set up repository' }).click();
      await h.page.locator('.dev-setup[data-view="wizard"]').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), WIZARD_HREF);
      assert.equal(await h.page.locator('.dx-ps-setups').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a helper the board needs updated is behind the tools chip, from its own report', async () => {
    const h = await open(
      '/developer',
      overview(
        [
          deviceRow('d1', 'Belka', [
            tool({ id: 'a1' }),
            tool({ id: 'a2', harness: 'codex', created_at: 2 }),
          ]),
        ],
        [setupRecord({ id: 's1' })],
        {
          // The board needs protocol 1; a1's helper speaks 0, a2's 1.
          '/api/v1/agents/a1/verification': {
            agent_id: 'a1',
            client_report: { protocol: 0, cli_commit: null },
          },
          '/api/v1/agents/a2/verification': {
            agent_id: 'a2',
            client_report: { protocol: 1, cli_commit: null },
          },
        },
      ),
    );
    try {
      const { items } = await openAttention(h.page);
      assert.deepEqual(items, [
        ['a1', 'Claude Code · Belka', 'update required', 'Open details', toolAddress('a1')],
      ]);
      assert.equal(
        await h.page.locator('[data-status] [data-attention] > button').textContent(),
        '1 needs an update',
      );
      assert.ok(h.calls.some((c) => c.path === '/api/v1/developer/compatibility'));
      // No notice of its own (LAI-1096): how to update is in the tool's Details.
      assert.equal(await h.page.locator('[data-note], [data-cli-notice]').count(), 0);
      assert.equal(await heroThenJourney(h.page), true);
    } finally {
      await h.close();
    }
  });

  void test('a change on refetch is announced, and focus moves to the new main action (review round 1)', async () => {
    const later = [
      deviceRow('d1', 'Belka', [tool({ id: 'a1', harness: 'omnigent' })]),
      deviceRow('d2', 'Strelka', [
        tool({
          id: 'a2',
          harness: 'codex',
          device_label: 'Strelka',
          last_seen_at: null,
          created_at: 2,
        }),
      ]),
    ];
    let reads = 0;
    const h = await open(
      '/developer',
      overview([], [], {
        '/api/v1/devices': () => {
          reads += 1;
          return { data: reads === 1 ? [] : later };
        },
      }),
    );
    try {
      const region = h.page.locator('[data-testid="dev-overview"] > p[aria-live="polite"]');
      const add = hero(h.page).getByRole('link', { name: 'Add a device' });
      await add.waitFor({ timeout: 20_000 });
      // Mounted empty: the first answer is what the page shows, not news.
      assert.equal(await region.getAttribute('role'), 'status');
      assert.equal((await region.textContent()) ?? '', '');

      await add.focus();
      // The reader comes back to the tab: the Overview reads again.
      await h.page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await h.page.locator('.dx-hero[data-hero="no-setup"]').waitFor({ timeout: 20_000 });
      assert.ok(reads >= 2, 'the Overview did not read again');

      await h.page.waitForFunction(
        (el) =>
          el?.textContent ===
          'Next step: Set up your project repository. 2 tools on this board, 1 connected.',
        await region.elementHandle(),
        { timeout: 10_000 },
      );
      // The link went with the old step; focus is on the new main action, not body.
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
      overview([], [], {
        '/api/v1/devices': () => {
          reads += 1;
          return { data: reads === 1 ? [] : [deviceRow('d1', 'Belka', [tool({ id: 'a1' })])] };
        },
      }),
    );
    try {
      await hero(h.page).getByRole('link', { name: 'Add a device' }).waitFor({ timeout: 20_000 });
      await advancedLink(h.page).focus();
      await h.page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await h.page.locator('.dx-hero[data-hero="no-setup"]').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-tab')),
        'advanced',
      );
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark']) {
    void test(`${theme}: two columns at 1440, one at 390 with no sideways scroll, in every state`, async () => {
      for (const name of Object.keys(STATES) as OverviewStateName[]) {
        const h = await open('/developer', STATES[name]());
        try {
          await h.page.setViewportSize({ width: 1440, height: 900 });
          await setTheme(h.page, theme);
          await hero(h.page).waitFor({ timeout: 20_000 });
          const wide = await Promise.all([
            hero(h.page).boundingBox(),
            h.page.locator('[data-status]').boundingBox(),
          ]);
          assert.ok(wide[0] !== null && wide[1] !== null);
          assert.ok(
            wide[1].x > wide[0].x + wide[0].width,
            `${name}: status is not right of the hero at 1440`,
          );
          // Drawn in this theme's tokens: the hero's ring is the accent border.
          const ring = await hero(h.page).evaluate((el) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--accent-border)';
            el.append(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return { got: getComputedStyle(el).borderTopColor, want };
          });
          assert.equal(ring.got, ring.want, `${name}: the hero is not drawn in the kit`);

          await h.page.setViewportSize({ width: 390, height: 844 });
          const narrow = await Promise.all([
            hero(h.page).boundingBox(),
            h.page.locator('[data-status]').boundingBox(),
          ]);
          assert.ok(narrow[0] !== null && narrow[1] !== null);
          assert.ok(narrow[1].y > narrow[0].y, `${name}: status is not under the hero at 390`);
          const sideways = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(sideways <= 0, `${name} scrolls sideways by ${String(sideways)}px in ${theme}`);
        } finally {
          await h.close();
        }
      }
    });
  }

  void test('an old link with a tool opens the wizard on that tool', async () => {
    const h = await open('/connect?agent=codex', stub('v3'));
    try {
      await h.page.locator('[data-wizard="tool"]').waitFor({ timeout: 20_000 });
      assert.equal(here(h.page), '/developer?tab=tools&add=tool&tool=codex');
      // No device is paired here, so the tool is kept for after pairing (LAI-1061).
      await h.page.locator('[data-kept-tool="codex"]').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('[data-wizard="tool"]').innerText(), /Codex is kept/);
    } finally {
      await h.close();
    }
  });
});

void describe('the Overview’s states', () => {
  void test('an error with a retry that works', async () => {
    let calls = 0;
    const h = await open(
      '/developer',
      overview([], [], {
        '/api/v1/devices': () => {
          calls += 1;
          return calls === 1 ? refuse(503, 'unavailable', 'Try again shortly.') : { data: [] };
        },
      }),
    );
    try {
      await h.page.getByText('Could not load your devices').waitFor({ timeout: 20_000 });
      assert.equal(await hero(h.page).count(), 0);
      await h.page.getByRole('button', { name: 'Try again' }).click();
      assert.equal((await readHero(h.page)).kind, 'no-device');
    } finally {
      await h.close();
    }
  });

  void test('the setups read failing is its own error, never an empty list', async () => {
    let calls = 0;
    const h = await open(
      '/developer',
      overview([deviceRow('d1', 'Belka', [tool({ id: 'a1' })])], [], {
        '/api/v1/project-setups': () => {
          calls += 1;
          return calls === 1
            ? refuse(503, 'unavailable', 'Try again shortly.')
            : { data: [setupRecord({ id: 's1' })] };
        },
      }),
    );
    try {
      await h.page.getByText('Could not load your repository setups').waitFor({ timeout: 20_000 });
      // Not "Set up your project repository" on a read that never arrived.
      assert.equal(await hero(h.page).count(), 0);
      await h.page.getByRole('button', { name: 'Try again' }).click();
      assert.equal((await readHero(h.page)).kind, 'all-done');
    } finally {
      await h.close();
    }
  });

  void test('403 is the permission state, never an empty journey', async () => {
    const h = await open(
      '/developer',
      overview([], [], { '/api/v1/devices': refuse(403, 'forbidden', 'Not yours.') }),
    );
    try {
      await h.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.state-forbidden').innerText(),
        /You do not have access to your devices/,
      );
      assert.equal(await hero(h.page).count(), 0);
      assert.equal(await h.page.locator('[data-journey]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('an expired session goes to sign-in', async () => {
    const h = await open(
      '/developer',
      overview([], [], { '/api/v1/devices': refuse(401, 'unauthorized', 'Signed out.') }),
    );
    try {
      await h.page.waitForURL(/\/login/, { timeout: 20_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('look and fit', () => {
  void test('the Overview is drawn with the design kit’s sheet', async () => {
    const h = await open('/developer', STATES['device-only']());
    try {
      const done = h.page.locator('.dx-flow-n[data-state="done"]');
      await done.waitFor({ timeout: 20_000 });
      const look = await h.page.evaluate(() => {
        const css = (selector: string) => {
          const el = document.querySelector(selector);
          return el === null ? null : getComputedStyle(el);
        };
        return {
          columns: css('.dx-columns')?.display ?? '',
          step: css('.dx-flow-n[data-state="done"]')?.width ?? '',
          primary: css('.dx-hero .dx-btn-primary')?.backgroundColor ?? '',
          chip: css('[data-journey] .dx-chip')?.borderTopLeftRadius ?? '',
        };
      });
      assert.equal(look.columns, 'grid', 'the two columns are unstyled');
      assert.equal(look.step, '34px', 'the step number is unstyled');
      assert.notEqual(look.primary, 'rgba(0, 0, 0, 0)', 'the primary action has no fill');
      assert.notEqual(look.chip, '0px', 'the chip is not a pill');
      // A finished step is a tick, not its number.
      assert.equal(await done.locator('svg').count(), 1);
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
        // Advanced is drawn in the design's frame (`.dx`, LAI-1078); the others
        // still in `.dev-body` until their slices land.
        for (const tab of ['overview', 'projects', 'devices', 'tools', 'advanced']) {
          await land(h, `/developer?tab=${tab}`);
          await h.page.locator('.dev-body, .dx').first().waitFor({ timeout: 20_000 });
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

  /** Each tab's and the Advanced link's right edge, and the row's own width. */
  const rowFit = (page: Page) =>
    page.evaluate(() => {
      const ul = document.querySelector('.dx-tabrow .page-tabs ul');
      const link = document.querySelector('.dx-tabrow > .dx-tab-secondary');
      const view = document.documentElement.clientWidth;
      return {
        view,
        tabs: [...document.querySelectorAll('.dx-tabrow .page-tab')].map(
          (el) => el.getBoundingClientRect().right,
        ),
        link: link?.getBoundingClientRect().right ?? Infinity,
        scrolls: ul === null ? false : ul.scrollWidth > ul.clientWidth,
        cue:
          ul === null
            ? { layers: 0, attachment: '' }
            : {
                layers: getComputedStyle(ul).backgroundImage.split('linear-gradient').length - 1,
                attachment: getComputedStyle(ul).backgroundAttachment,
              },
      };
    });

  for (const theme of ['light', 'dark']) {
    void test(`390px, ${theme}: the four tabs and Advanced fit the row, nothing off-screen (LAI-1096)`, async () => {
      const h = await open('/developer', stub('v3'));
      try {
        await h.page.setViewportSize({ width: 390, height: 844 });
        await setTheme(h.page, theme);
        await h.page.locator('[data-testid="dev-overview"]').waitFor({ timeout: 20_000 });
        const fit = await rowFit(h.page);
        assert.equal(fit.tabs.length, 4);
        for (const right of [...fit.tabs, fit.link]) {
          assert.ok(right <= fit.view, `${String(right)}px is past the ${String(fit.view)}px view`);
        }
        assert.equal(fit.scrolls, false, 'the tabs scroll at 390px');
        // At this width Advanced is *⋯*, still named Advanced: the word is there
        // for a screen reader, clipped to nothing for the eye.
        const link = advancedLink(h.page);
        assert.equal(await link.locator('.dx-tab-secondary-more').isVisible(), true);
        assert.equal(await link.locator('.dx-tab-secondary-mark').isVisible(), false);
        const word = await link
          .locator('.dx-tab-secondary-word')
          .evaluate((el) => getComputedStyle(el).clipPath);
        assert.equal(word, 'inset(50%)');
        await h.page.getByRole('link', { name: 'Advanced', exact: true }).first().waitFor();
        assert.equal(
          await h.page.locator('.dx-tabrow').getByRole('link', { name: 'Advanced' }).count(),
          1,
        );
        await link.click();
        await h.page.locator('.dev-advanced').waitFor({ timeout: 20_000 });
        assert.equal(await link.getAttribute('aria-current'), 'page');
        // *⋯* is marked as the active tab is, so a phone shows where it is.
        const [colour, accent] = await link.evaluate((el) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--accent)';
          document.body.append(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return [getComputedStyle(el).borderBottomColor, want];
        });
        assert.equal(colour, accent);
      } finally {
        await h.close();
      }
    });
  }

  void test('narrower still, tabs that do not fit scroll with a shade at the edge (LAI-1096)', async () => {
    const h = await open('/developer', stub('v3'));
    try {
      await h.page.setViewportSize({ width: 300, height: 700 });
      await h.page.locator('[data-testid="dev-overview"]').waitFor({ timeout: 20_000 });
      const fit = await rowFit(h.page);
      assert.equal(fit.scrolls, true, 'the control: at 300px the four tabs do not fit');
      // The cue: two covers that ride with the tabs, over a shade fixed at each edge.
      assert.deepEqual(fit.cue, { layers: 4, attachment: 'local, local, scroll, scroll' });
      assert.ok(fit.link <= fit.view, 'Advanced went off-screen with the tabs');
      const sideways = await h.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(sideways <= 0, `the page scrolls sideways by ${String(sideways)}px`);
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark']) {
    void test(`${theme}: a wizard's step on show is the accent's soft fill with no border; Connect's keeps its own (LAI-1096)`, async () => {
      /** The step on show: its fill, border and shadow, and the tokens to compare. */
      const current = (page: Page, scope: string) =>
        page.locator(`${scope} .conn-step[data-state="current"] .conn-rail-step`).evaluate((el) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--accent-bg)';
          probe.style.borderTopColor = 'var(--accent-border)';
          probe.style.borderTopStyle = 'solid';
          document.body.append(probe);
          const want = getComputedStyle(probe);
          const tokens = { fill: want.backgroundColor, ring: want.borderTopColor };
          probe.remove();
          const got = getComputedStyle(el);
          return {
            fill: got.backgroundColor,
            border: got.borderTopColor,
            shadow: got.boxShadow,
            tokens,
          };
        });

      const v3 = await open(
        '/developer?tab=projects',
        stub('v3', [
          agentRow({
            id: 'a1',
            last_seen_at: Date.now(),
            grants: [{ project_id: 'p1', scope: 'full' }],
          }),
        ]),
      );
      try {
        await setTheme(v3.page, theme);
        await v3.page
          .locator('.dx-rail-card .conn-step[data-state="current"]')
          .waitFor({ timeout: 20_000 });
        await settle(v3.page);
        const step = await current(v3.page, '.dx-rail-card');
        assert.equal(step.fill, step.tokens.fill, 'the step on show is not --accent-bg');
        assert.equal(step.border, 'rgba(0, 0, 0, 0)', 'the step on show has a border');
        assert.equal(step.shadow, 'none', 'the step on show is raised');
      } finally {
        await v3.close();
      }

      const classic = await open('/developer?tab=connect', stub('classic'));
      try {
        await setTheme(classic.page, theme);
        await classic.page
          .locator(
            '.conn-wizard-card .conn-step[data-state="current"], .conn-rail .conn-step[data-state="current"]',
          )
          .first()
          .waitFor({ timeout: 20_000 });
        await settle(classic.page);
        const step = await current(classic.page, '.conn-rail');
        assert.equal(step.border, step.tokens.ring, 'Connect’s step on show lost its ring');
        assert.notEqual(step.shadow, 'none');
      } finally {
        await classic.close();
      }
    });
  }
});

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

void describe(
  'evidence: the Overview in each state, light and dark, 1440 and 390 px',
  { skip: EVIDENCE === undefined },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          for (const name of Object.keys(STATES) as OverviewStateName[]) {
            const h = await open('/developer', STATES[name]());
            try {
              await h.page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
              await setTheme(h.page, theme);
              await hero(h.page).waitFor({ timeout: 20_000 });
              if (name === 'all-done') {
                await h.page
                  .locator('[data-setups] [data-repo]')
                  .first()
                  .waitFor({ timeout: 20_000 });
              }
              // The theme's colours ease in; the picture is of where they land.
              await settle(h.page);
              // The app scrolls inside its shell, so a full-page shot stops at the
              // first screen: the viewport grows by what is scrolled out of it.
              const hidden = await h.page.evaluate(() => {
                let el = document.querySelector('[data-testid="dev-overview"]')?.parentElement;
                while (el != null && el.scrollHeight <= el.clientHeight) el = el.parentElement;
                return el == null ? 0 : el.scrollHeight - el.clientHeight;
              });
              const size = h.page.viewportSize();
              if (size !== null && hidden > 0) {
                await h.page.setViewportSize({ width, height: size.height + hidden });
              }
              await h.page.screenshot({
                path: join(dir, `overview-${name}-${theme}-${String(width)}.png`),
                fullPage: true,
              });
            } finally {
              await h.close();
            }
          }
        }
      }
    });
  },
);
