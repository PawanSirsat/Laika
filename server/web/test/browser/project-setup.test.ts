/**
 * Developer access V3 → Project setup (LAI-1052, plan §G), in a real browser.
 *
 * - The flow: project → connected tool → access as two facts → grant → the
 *   tool's prompt → *I've added it*, recorded on the board as the reader's
 *   word; a `laika project check` record shown apart from it (LAI-1066).
 * - A grant changes one project through the existing `PUT /agents/:id/grants`,
 *   every other grant carried over.
 * - Its states: no tools, no projects, a `403`, an error, a viewer.
 * - Classic untouched; preview reaches it by link; keyboard; 390 px, both themes.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save screenshots there.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, open, refuse, setTheme, type ApiStub, type StubCall } from './harness.ts';

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

interface Grant {
  project_id: string;
  scope: 'read_only' | 'full';
}

const agentRow = (over: { id: string; harness?: string; grants?: Grant[] }) => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active' as const,
  grants: [] as Grant[],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: Date.now(),
  ...over,
});

type Agent = ReturnType<typeof agentRow>;

const accessFor = (agent: Agent, role: 'member' | 'viewer' = 'member', agentsAllowed = true) => {
  const scope = agent.grants.find((g) => g.project_id === 'p1')?.scope ?? null;
  const owner = role === 'viewer' ? 'read_only' : 'full';
  const rank = { none: 0, read_only: 1, full: 2 } as const;
  const levels = [scope ?? 'none', owner, agentsAllowed ? 'full' : 'read_only'] as const;
  const effective = levels.reduce((a, b) => (rank[b] < rank[a] ? b : a));
  return {
    agent_id: agent.id,
    project: {
      id: 'p1',
      slug: 'onroute',
      name: 'OnRoute',
      prefix: 'ONR',
      agents_allowed: agentsAllowed,
    },
    member: { role, can_read: true, can_write: role !== 'viewer' },
    grant: { scope },
    effective,
    can_grant:
      role === 'viewer'
        ? { max: 'read_only', reason: 'viewer_role' }
        : { max: 'full', reason: null },
  };
};

interface World {
  agents: Agent[];
  puts: unknown[];
  /** `GET /project-setups` answers these; a `POST` appends to them. */
  setups?: Record<string, unknown>[];
  posts?: unknown[];
}

function stub(
  mode: Mode,
  world: World,
  over: ApiStub = {},
  role: 'member' | 'viewer' = 'member',
): ApiStub {
  const routes: Record<string, unknown> = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents': () => ({ data: world.agents, next_cursor: null }),
    '/api/v1/agents/devices': () => ({
      data: [
        {
          device_label: 'belka',
          display_name: 'Belka',
          recognised: true,
          last_seen_at: null,
          active_count: world.agents.length,
          revoked_count: 0,
          agents: world.agents,
        },
      ],
    }),
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
    '/api/v1/developer/compatibility': compat(mode),
    '/api/v1/project-setups': (call: StubCall) => {
      world.setups ??= [];
      if (call.method === 'POST') {
        (world.posts ??= []).push(call.body);
        const body = call.body as { agent_id: string; template_revision: number };
        const made = {
          id: `s${String(world.setups.length + 1)}`,
          agent_id: body.agent_id,
          device_label: 'Belka',
          project_id: 'p1',
          project_slug: 'onroute',
          repo_label: null,
          instructions_path: 'CLAUDE.md',
          block_found: true,
          template_revision: body.template_revision,
          project_match: null,
          prefix_match: null,
          source: 'self_reported_browser',
          checked_at: Date.now(),
        };
        world.setups.push(made);
        return made;
      }
      return { data: world.setups };
    },
  };
  for (const agent of world.agents) {
    routes[`/api/v1/agents/${agent.id}`] = () => world.agents.find((a) => a.id === agent.id);
    routes[`/api/v1/agents/${agent.id}/project-access`] = () =>
      accessFor(world.agents.find((a) => a.id === agent.id) ?? agent, role);
    routes[`/api/v1/agents/${agent.id}/grants`] = (call: StubCall) => {
      world.puts.push(call.body);
      const grants = (call.body as { grants: Grant[] }).grants;
      world.agents = world.agents.map((a) => (a.id === agent.id ? { ...a, grants } : a));
      return world.agents.find((a) => a.id === agent.id);
    };
  }
  return { ...routes, ...over };
}

after(async () => {
  await closeBrowser();
});

const here = (page: Page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

async function evidence(page: Page, name: string): Promise<void> {
  if (EVIDENCE === undefined || EVIDENCE === '') return;
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true });
}

const facts = async (page: Page) =>
  (await page.locator('.dev-setup-facts > div').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );

void describe('Project setup, v3', () => {
  void test('a check that found no block leads; a tool with no access cannot be recorded (LAI-1073)', async () => {
    const base = {
      agent_id: 'a1',
      device_label: 'Belka',
      project_id: 'p1',
      project_slug: 'onroute',
      instructions_path: 'CLAUDE.md',
      checked_at: Date.now() - 60_000,
    };
    const world: World = {
      agents: [agentRow({ id: 'a1' })],
      puts: [],
      setups: [
        {
          ...base,
          id: 's1',
          repo_label: 'onroute-app',
          block_found: false,
          template_revision: null,
          project_match: null,
          prefix_match: null,
          source: 'local_check',
        },
        {
          ...base,
          id: 's2',
          repo_label: null,
          block_found: true,
          template_revision: 2,
          project_match: null,
          prefix_match: null,
          source: 'self_reported_browser',
        },
      ],
    };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      await h.page.locator('[data-step="record"] [data-status]').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('[data-step="record"] [data-status]').getAttribute('data-status'),
        'missing',
      );
      // No grant here: the button says why and records nothing.
      const button = h.page.getByRole('button', { name: 'I’ve added it' });
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      await h.page.locator('[data-note="record-needs-access"]').waitFor();
      await button.click({ force: true });
      assert.equal(world.posts, undefined);
    } finally {
      await h.close();
    }
  });

  void test('a laika project check record is shown apart from the reader’s word, and drives Update available', async () => {
    const local = {
      id: 's1',
      agent_id: 'a1',
      device_label: 'Belka',
      project_id: 'p1',
      project_slug: 'onroute',
      repo_label: 'onroute-app',
      instructions_path: 'CLAUDE.md',
      block_found: true,
      template_revision: 1,
      project_match: null,
      prefix_match: true,
      source: 'local_check',
      checked_at: Date.now() - 60_000,
    };
    const self = {
      ...local,
      id: 's2',
      repo_label: null,
      template_revision: 2,
      prefix_match: null,
      source: 'self_reported_browser',
    };
    const world: World = {
      agents: [agentRow({ id: 'a1', grants: [{ project_id: 'p1', scope: 'full' }] })],
      puts: [],
      setups: [local, self],
    };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      await h.page.locator('[data-step="record"] [data-status]').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('[data-step="record"] [data-status]').getAttribute('data-status'),
        'update-available',
      );
      assert.match(
        await h.page.locator('[data-step="record"] [data-status]').innerText(),
        /names another project or task-key prefix/,
      );
      const checked = await h.page.locator('[data-source="local_check"]').innerText();
      assert.match(checked, /Checked by laika project check on Belka at /);
      assert.match(
        checked,
        /onroute-app: as of the last check, instructions template revision 1 in CLAUDE\.md/,
      );
      const mine = await h.page.locator('[data-source="self_reported_browser"]').innerText();
      assert.match(mine, /Recorded by you at .+ — not verified/);
      assert.doesNotMatch(mine, /Checked/);
      await evidence(h.page, 'project-setup-records');

      // Presence off: the server sends no time, and the page shows none.
      world.setups = [
        { ...local, template_revision: 2, checked_at: null },
        { ...self, checked_at: null },
      ];
      await h.page.reload();
      await h.page.locator('[data-step="record"] [data-status="current"]').waitFor({
        timeout: 20_000,
      });
      assert.equal(
        (
          await h.page.locator('[data-source="local_check"] .dev-setup-record-source').innerText()
        ).trim(),
        'Checked by laika project check on Belka',
      );
      assert.equal(
        (
          await h.page
            .locator('[data-source="self_reported_browser"] .dev-setup-record-source')
            .innerText()
        ).trim(),
        'Recorded by you — not verified',
      );
    } finally {
      await h.close();
    }
  });

  void test('the whole flow: two facts, a one-project grant, the prompt, a self-report', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', grants: [{ project_id: 'p9', scope: 'read_only' }] })],
      puts: [],
    };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
      assert.deepEqual(await facts(h.page), [
        'You Member of OnRoute',
        'Claude Code · Belka No access',
        'In effect No access',
      ]);
      // Least privilege: No access is selected, with what that means.
      assert.equal(await h.page.getByRole('radio', { name: 'No access' }).isChecked(), true);
      await h.page.locator('[data-note="no-access"]').waitFor();

      // The tool's own file and a prompt with no secret in it.
      const prompt = await h.page.locator('.conn-project-prompt').innerText();
      assert.match(prompt, /by updating \.\/CLAUDE\.md/);
      assert.match(prompt, /Project slug: `onroute`/);
      assert.doesNotMatch(prompt, /lai_/);
      assert.match(prompt, /do not commit or push/);
      assert.equal(await h.page.locator('[data-step="repo-mcp"]').count(), 0);

      await h.page.getByRole('radio', { name: 'Full' }).check();
      await h.page.getByRole('button', { name: 'Save access' }).click();
      await h.page.getByText('Saved.').waitFor({ timeout: 20_000 });
      assert.deepEqual(world.puts, [
        {
          grants: [
            { project_id: 'p9', scope: 'read_only' },
            { project_id: 'p1', scope: 'full' },
          ],
        },
      ]);
      assert.equal((await facts(h.page))[1], 'Claude Code · Belka Full');
      await h.page
        .locator('[role="status"]')
        .filter({ hasText: 'now has Full in OnRoute' })
        .waitFor({ timeout: 5_000 });

      // Nothing recorded is said as such, with the command that finds out.
      await h.page.locator('[data-status="not-recorded"]').waitFor();
      assert.match(
        await h.page.locator('[data-step="record"]').innerText(),
        /laika project check --project onroute/,
      );
      // The reader's word goes to the board, and comes back as theirs.
      await h.page.getByRole('button', { name: 'I’ve added it' }).click();
      const recorded = await h.page.locator('[data-status="current"]').innerText();
      assert.match(recorded, /Recorded by you/);
      assert.match(recorded, /not verified/);
      assert.doesNotMatch(recorded, /\bVerified\b/);
      assert.deepEqual(world.posts, [
        {
          agent_id: 'a1',
          project_slug: 'onroute',
          template_revision: 2,
          instructions_path: 'CLAUDE.md',
        },
      ]);
      assert.match(
        await h.page.locator('[data-source="self_reported_browser"]').innerText(),
        /Recorded by you at .+ — not verified/,
      );
      assert.equal(await h.page.locator('[data-source="local_check"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a grant made elsewhere after the page loaded survives Save (the merge re-reads)', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', grants: [{ project_id: 'p9', scope: 'read_only' }] })],
      puts: [],
    };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
      // Another tab, or the Devices screen, gives the tool p8 meanwhile.
      world.agents = world.agents.map((a) => ({
        ...a,
        grants: [...a.grants, { project_id: 'p8', scope: 'full' }],
      }));
      await h.page.getByRole('radio', { name: 'Read only' }).check();
      await h.page.getByRole('button', { name: 'Save access' }).click();
      await h.page.getByText('Saved.').waitFor({ timeout: 20_000 });
      assert.deepEqual(world.puts, [
        {
          grants: [
            { project_id: 'p9', scope: 'read_only' },
            { project_id: 'p8', scope: 'full' },
            { project_id: 'p1', scope: 'read_only' },
          ],
        },
      ]);
    } finally {
      await h.close();
    }
  });

  void test('the Overview’s Set up a project lands here', async () => {
    const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
    // The Overview reads the Devices tab's `GET /devices` (LAI-1079): a1 on
    // Belka with a live credential it has used, so its next step is a project.
    const connected = {
      ...agentRow({ id: 'a1' }),
      tokens: [{ id: 't1', prefix: 'lai_abcd', expires_at: null, revoked_at: null }],
    };
    const device = {
      id: 'd1',
      display_name: 'Belka',
      device_label: 'belka',
      kind: 'local',
      origin: 'paired',
      status: 'active',
      confirmed: true,
      confirmed_at: 1,
      paired_at: 1,
      key_fingerprint: null,
      last_seen_at: null,
      active_count: 1,
      revoked_count: 0,
      agents: [connected],
      created_at: 1,
      revoked_at: null,
    };
    const h = await open(
      '/developer',
      stub('v3', world, { '/api/v1/devices': { data: [device] } }),
    );
    try {
      await h.page.getByRole('link', { name: 'Set up a project →', exact: true }).click();
      await h.page.locator('.dev-setup').waitFor({ timeout: 20_000 });
      assert.match(here(h.page), /tab=projects/);
    } finally {
      await h.close();
    }
  });

  void test('a viewer: Full is disabled with the reason', async () => {
    const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
    const h = await open('/developer?tab=projects', stub('v3', world, {}, 'viewer'));
    try {
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.getByRole('radio', { name: 'Full' }).isDisabled(), true);
      assert.equal(await h.page.getByRole('radio', { name: 'Read only' }).isDisabled(), false);
      await h.page
        .getByText('You are a viewer here, so a tool of yours can at most read.')
        .waitFor();
      assert.match((await facts(h.page))[0] ?? '', /Viewer of OnRoute · you can read, not change/);
    } finally {
      await h.close();
    }
  });

  void test('each tool gets its own file; a repo-config tool gets the separate step', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', harness: 'codex' }), agentRow({ id: 'a2', harness: 'vscode' })],
      puts: [],
    };
    const h = await open('/developer?tab=projects&tool=a1', stub('v3', world));
    try {
      await h.page.locator('.conn-project-prompt').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.conn-project-prompt').innerText(), /\.\/AGENTS\.md/);
      await h.page.goto(`${h.origin}/developer?tab=projects&tool=a2`);
      await h.page.locator('[data-step="repo-mcp"]').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.conn-project-prompt').innerText(),
        /\.\/\.github\/copilot-instructions\.md/,
      );
      assert.match(
        await h.page.locator('[data-step="repo-mcp"]').innerText(),
        /laika connect vscode --project/,
      );
    } finally {
      await h.close();
    }
  });

  void test('no tools yet: an empty state that goes to Add a tool', async () => {
    const h = await open('/developer?tab=projects', stub('v3', { agents: [], puts: [] }));
    try {
      await h.page.getByText('No connected tools yet').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Add a tool' }).click();
      await h.page.waitForURL(/tab=tools&add=tool/, { timeout: 20_000 });
    } finally {
      await h.close();
    }
  });

  void test('no projects: says so', async () => {
    const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
    const h = await open(
      '/developer?tab=projects',
      stub('v3', world, { '/api/v1/projects': { data: [], next_cursor: null } }),
    );
    try {
      await h.page.getByText('No projects to set up').waitFor({ timeout: 20_000 });
    } finally {
      await h.close();
    }
  });

  void test('the access check refused 403, and failing with a retry', async () => {
    const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
    let calls = 0;
    const h = await open(
      '/developer?tab=projects',
      stub('v3', world, {
        '/api/v1/agents/a1/project-access': () => {
          calls += 1;
          return calls === 1
            ? refuse(503, 'unavailable', 'Try again shortly.')
            : accessFor(world.agents[0]!);
        },
      }),
    );
    try {
      await h.page.getByRole('button', { name: 'Try again' }).click({ timeout: 20_000 });
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
    } finally {
      await h.close();
    }
    const denied = await open(
      '/developer?tab=projects',
      stub('v3', world, {
        '/api/v1/agents/a1/project-access': refuse(403, 'forbidden', 'Not yours.'),
      }),
    );
    try {
      await denied.page.locator('.state-forbidden').waitFor({ timeout: 20_000 });
      assert.match(
        await denied.page.locator('.state-forbidden .state-headline').innerText(),
        /You do not have access to Claude Code · Belka’s access to OnRoute/,
      );
      assert.equal(await denied.page.locator('.dev-setup-facts').count(), 0);
    } finally {
      await denied.close();
    }
  });

  void test('keyboard only: arrows choose a grant, Save keeps focus, the result is heard', async () => {
    const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
      await h.page.getByRole('radio', { name: 'No access' }).focus();
      await h.page.keyboard.press('ArrowDown');
      assert.equal(await h.page.getByRole('radio', { name: 'Read only' }).isChecked(), true);
      const save = h.page.getByRole('button', { name: 'Save access' });
      await save.focus();
      await h.page.keyboard.press('Enter');
      await h.page.getByText('Saved.').waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent ?? ''),
        'Save access',
      );
      assert.deepEqual(world.puts, [{ grants: [{ project_id: 'p1', scope: 'read_only' }] }]);
    } finally {
      await h.close();
    }
  });
});

void describe('Project setup in the other modes', () => {
  void test('classic: the Projects tab is the classic card, no new flow, no banner', async () => {
    const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
    const h = await open('/developer?tab=projects', stub('classic', world));
    try {
      await h.page.getByRole('heading', { name: 'Add this project' }).waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.dev-setup').count(), 0);
      assert.equal(await h.page.locator('.dev-v3-banner').count(), 0);
      assert.equal(world.puts.length, 0);
      assert.ok(!h.calls.some((c) => c.path.includes('project-access')));
    } finally {
      await h.close();
    }
  });

  void test('preview: classic by default, the new flow one link away', async () => {
    const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
    const h = await open('/developer?tab=projects', stub('preview', world));
    try {
      await h.page.getByRole('heading', { name: 'Add this project' }).waitFor({ timeout: 20_000 });
      await h.page.getByRole('link', { name: 'Open the preview' }).click();
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
      assert.match(here(h.page), /setup=v3/);
    } finally {
      await h.close();
    }
  });
});

void describe('Project setup, both themes', () => {
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) {
      void test(`${theme}, ${String(width)}px: no sideways scroll`, async () => {
        const world: World = { agents: [agentRow({ id: 'a1' })], puts: [] };
        const h = await open('/developer?tab=projects', stub('v3', world));
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await setTheme(h.page, theme);
          await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
          const wide = await h.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert.ok(wide <= 0, `scrolls sideways by ${String(wide)}px`);
          await evidence(h.page, `project-setup-${theme}-${String(width)}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});
