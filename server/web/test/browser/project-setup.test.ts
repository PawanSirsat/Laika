/**
 * Developer access V3 → Project setup (LAI-1052, plan §G), in a real browser,
 * as the owner's design's three-step wizard (LAI-1082).
 *
 * - The flow: project → connected tool → access as a chip and two facts →
 *   grant → *Continue* → the tool's prompt → *I ran this prompt* → *I've added
 *   it*, recorded on the board as the reader's word → *Finish* → done; a
 *   `laika project check` record shown apart from it (LAI-1066).
 * - The step is in the address (`?step=`), replaced rather than pushed, and
 *   the rail and *Back* move it; *Continue* waits for a grant; *done* waits
 *   for a record; *Checked* comes only from a local check, which step 3 reads
 *   again on focus.
 * - A grant changes one project through the existing `PUT /agents/:id/grants`,
 *   every other grant carried over.
 * - The setups list across projects (LAI-1077), the aside, and its states: no
 *   tools, no projects, a `403`, an error, a viewer.
 * - Classic untouched; preview reaches it by link; keyboard; 390 px, both themes.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save screenshots there.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { barePull, hazardsIn } from '../routes/screens/developer/v3/shell-words.ts';
import {
  closeBrowser,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';

type Mode = 'classic' | 'preview' | 'v3';

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [
    { project_id: 'p1', role: 'member' },
    { project_id: 'p2', role: 'member' },
  ],
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

const ATLAS = {
  ...PROJECT,
  id: 'p2',
  slug: 'atlas',
  prefix: 'ATL',
  name: 'Atlas',
  last_activity_at: 1,
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

const agentRow = (over: {
  id: string;
  harness?: string;
  grants?: Grant[];
  status?: 'active' | 'revoked';
  device_label?: string;
}) => ({
  owner_user_id: 'u1',
  owner_display_name: 'Ada Lovelace',
  display_name: over.id,
  harness: 'claude-code',
  device_label: 'Belka',
  status: 'active' as 'active' | 'revoked',
  grants: [] as Grant[],
  tokens: [],
  created_at: 1,
  revoked_at: null,
  last_seen_at: Date.now(),
  ...over,
});

type Agent = ReturnType<typeof agentRow>;

const FULL: Grant[] = [{ project_id: 'p1', scope: 'full' }];

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
  /** The space's *coding tools allowed* switch; on unless a test says. */
  agentsAllowed?: boolean;
}

function stub(
  mode: Mode,
  world: World,
  over: ApiStub = {},
  role: 'member' | 'viewer' = 'member',
): ApiStub {
  const routes: Record<string, unknown> = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [PROJECT, ATLAS], next_cursor: null },
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
      accessFor(
        world.agents.find((a) => a.id === agent.id) ?? agent,
        role,
        world.agentsAllowed ?? true,
      );
    routes[`/api/v1/agents/${agent.id}/grants`] = (call: StubCall) => {
      world.puts.push(call.body);
      const grants = (call.body as { grants: Grant[] }).grants;
      world.agents = world.agents.map((a) => (a.id === agent.id ? { ...a, grants } : a));
      return world.agents.find((a) => a.id === agent.id);
    };
  }
  return { ...routes, ...over };
}

/** A `laika project check` record that found the current block. */
const checked = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  agent_id: 'a1',
  device_label: 'Belka',
  project_id: 'p1',
  project_slug: 'onroute',
  repo_label: 'onroute-app',
  instructions_path: 'CLAUDE.md',
  block_found: true,
  template_revision: 2,
  project_match: true,
  prefix_match: true,
  source: 'local_check',
  checked_at: Date.now() - 60_000,
  ...over,
});

after(async () => {
  await closeBrowser();
});

const here = (page: Page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};

const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

const facts = async (page: Page) =>
  (await page.locator('.dev-setup-facts > div').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );

/** The wizard card on show: `1`, `2` or `3`. */
const card = (page: Page, step: 1 | 2 | 3) =>
  page.locator(`[data-wizard="project-setup"] .conn-wizard-card[data-step="${String(step)}"]`);

const grantChip = (page: Page) => page.locator('[data-fact="grant"] .dx-chip');

/** A grant's tile: its radio is visually hidden inside, so a person clicks this. */
const grantTile = (page: Page, grant: 'none' | 'read_only' | 'full') =>
  page.locator(`label[data-grant="${grant}"]`);

const continueButton = (page: Page) => page.getByRole('button', { name: 'Continue to prompt' });
const finishButton = (page: Page) => page.getByRole('button', { name: 'Finish' });
const footNote = (page: Page) => page.locator('.dx-wizard-note');

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
    const h = await open('/developer?tab=projects&step=3', stub('v3', world));
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
    const local = checked({ id: 's1', template_revision: 1, project_match: null });
    const self = {
      ...local,
      id: 's2',
      repo_label: null,
      template_revision: 2,
      prefix_match: null,
      source: 'self_reported_browser',
    };
    const world: World = {
      agents: [agentRow({ id: 'a1', grants: FULL })],
      puts: [],
      setups: [local, self],
    };
    const h = await open('/developer?tab=projects&step=3', stub('v3', world));
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
      const local1 = await h.page.locator('[data-source="local_check"]').innerText();
      assert.match(local1, /Checked by laika project check on Belka at /);
      assert.match(
        local1,
        /onroute-app: as of the last check, instructions template revision 1 in CLAUDE\.md/,
      );
      const mine = await h.page.locator('[data-source="self_reported_browser"]').innerText();
      assert.match(mine, /Recorded by you at .+ — not verified/);
      assert.doesNotMatch(mine, /Checked/);

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

  void test('the whole flow: a grant, Continue, the prompt, a self-report, done', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', grants: [{ project_id: 'p9', scope: 'read_only' }] })],
      puts: [],
    };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      // Step 1, with no grant: the facts, the chip, the warning, the grants open.
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
      assert.equal(await card(h.page, 1).count(), 1);
      assert.equal(
        (await card(h.page, 1).locator('.conn-eyebrow').textContent())?.trim(),
        'Step 1 of 3 · Project',
      );
      assert.deepEqual(await facts(h.page), ['You Member', 'In effect No access']);
      assert.equal((await grantChip(h.page).innerText()).trim(), 'No access');
      await h.page.locator('[data-note="grant-required"]').waitFor();
      // Least privilege: No access is selected, with what that means.
      assert.equal(await h.page.getByRole('radio', { name: 'No access' }).isChecked(), true);
      await h.page.locator('[data-note="no-access"]').waitFor();
      // Continue waits for a grant, and says so.
      assert.equal(await continueButton(h.page).getAttribute('aria-disabled'), 'true');
      assert.equal(
        (await footNote(h.page).innerText()).trim(),
        'Give Claude Code · Belka access to OnRoute to continue.',
      );
      await continueButton(h.page).click({ force: true });
      assert.equal(param(h.page, 'step'), null);
      assert.equal(await card(h.page, 1).count(), 1);

      await grantTile(h.page, 'full').click();
      assert.equal(await h.page.getByRole('radio', { name: 'Full' }).isChecked(), true);
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
      assert.equal((await grantChip(h.page).innerText()).trim(), 'Full access');
      assert.deepEqual(await facts(h.page), ['You Member', 'In effect Full']);
      await h.page
        .locator('[role="status"]')
        .filter({ hasText: 'now has Full in OnRoute' })
        .waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('[data-note="grant-required"]').count(), 0);
      assert.equal(await continueButton(h.page).getAttribute('aria-disabled'), 'false');
      assert.equal(
        (await footNote(h.page).innerText()).trim(),
        'Existing permissions stay as they are.',
      );

      // Step 2: the tool's own file and a prompt with no secret in it.
      await continueButton(h.page).click();
      await card(h.page, 2).waitFor({ timeout: 5_000 });
      assert.equal(param(h.page, 'step'), '2');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.textContent ?? ''),
        'Copy the setup prompt for Claude Code',
      );
      assert.equal(
        (await h.page.locator('[data-detail="project"] dd').innerText()).trim(),
        'OnRoute · onroute',
      );
      assert.equal(
        (await h.page.locator('[data-detail="target"] dd').innerText()).trim(),
        'CLAUDE.md',
      );
      const prompt = await h.page.locator('.conn-project-prompt').innerText();
      assert.match(prompt, /by updating \.\/CLAUDE\.md/);
      assert.match(prompt, /Project slug: `onroute`/);
      assert.doesNotMatch(prompt, /lai_/);
      assert.match(prompt, /do not commit or push/);
      assert.equal(await h.page.locator('[data-step="repo-mcp"]').count(), 0);
      assert.equal(await h.page.locator('[data-note="needs-grant"]').count(), 0);
      assert.equal(
        (await footNote(h.page).innerText()).trim(),
        'No password or token in this prompt.',
      );
      // The block itself, for someone who edits the file by hand.
      await h.page.getByText('Or edit the file yourself').click();
      assert.match(await h.page.locator('.conn-project-block').innerText(), /laika:begin/);

      // Step 3: nothing recorded is said as such, with the command that finds out.
      await h.page.getByRole('button', { name: 'I ran this prompt' }).click();
      await card(h.page, 3).waitFor({ timeout: 5_000 });
      assert.equal(param(h.page, 'step'), '3');
      await h.page.locator('[data-status="not-recorded"]').waitFor({ timeout: 20_000 });
      // With the tool from step 1: two tools on a device and no --harness record nothing.
      assert.match(
        await h.page.locator('[data-step="record"]').innerText(),
        /laika project check --project onroute --harness claude-code/,
      );
      assert.equal(await finishButton(h.page).getAttribute('aria-disabled'), 'true');
      assert.equal(
        (await footNote(h.page).innerText()).trim(),
        'Run the check, or record it yourself, to finish.',
      );
      await finishButton(h.page).click({ force: true });
      assert.equal(param(h.page, 'step'), '3');

      // The reader's word goes to the board, and comes back as theirs.
      await h.page.getByRole('button', { name: 'I’ve added it' }).click();
      const recorded = await h.page.locator('[data-status="current"]').innerText();
      assert.match(recorded, /Recorded by you/);
      assert.match(recorded, /not verified/);
      assert.doesNotMatch(recorded, /\bVerified\b|Checked/);
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

      // Done: what was set up, and that nobody checked it.
      assert.equal(await finishButton(h.page).getAttribute('aria-disabled'), 'false');
      await finishButton(h.page).click();
      await h.page.locator('.dx-ps-done').waitFor({ timeout: 5_000 });
      assert.equal(param(h.page, 'step'), 'done');
      assert.equal(
        (await h.page.locator('.dx-ps-done-eyebrow').textContent())?.trim(),
        'Repository set up',
      );
      assert.equal(
        (await h.page.locator('.dx-ps-done-title').innerText()).trim(),
        'OnRoute · Claude Code · Belka',
      );
      assert.equal(
        (await h.page.locator('[data-detail="verification"] dd').innerText()).trim(),
        'Recorded by you — not verified',
      );
      assert.equal(
        (await h.page.locator('[data-detail="project"] dd').innerText()).trim(),
        'onroute (ONR)',
      );
      assert.equal(
        (await h.page.locator('[data-detail="file"] dd').innerText()).trim(),
        'CLAUDE.md',
      );
      assert.match(
        await h.page.locator('[data-note="done"]').innerText(),
        /With Full access, Claude Code can .+ in OnRoute, as you\. A person still marks work Done\./,
      );
      assert.equal(
        await h.page.getByRole('link', { name: 'Back to overview' }).getAttribute('href'),
        '/developer?tab=overview',
      );

      // Set up another: step 1 again, the same tool.
      await h.page.getByRole('button', { name: 'Set up another repository' }).click();
      await card(h.page, 1).waitFor({ timeout: 5_000 });
      assert.equal(param(h.page, 'step'), null);
      assert.equal(param(h.page, 'project'), null);
      assert.equal((await grantChip(h.page).innerText()).trim(), 'Full access');
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
      await grantTile(h.page, 'read_only').click();
      assert.equal(await h.page.getByRole('radio', { name: 'Read only' }).isChecked(), true);
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
      assert.equal((await grantChip(h.page).innerText()).trim(), 'Read only');
    } finally {
      await h.close();
    }
  });

  void test('a grant already there: a chip, the grants behind Change, and Continue open', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', grants: FULL })],
      puts: [],
      agentsAllowed: false,
    };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      await h.page.locator('.dev-setup-facts').waitFor({ timeout: 20_000 });
      assert.equal((await grantChip(h.page).innerText()).trim(), 'Full access');
      // The space turns tools off, so less is in effect than the grant, and why.
      assert.deepEqual(await facts(h.page), [
        'You Member',
        'In effect Read only — never more than you, and the space, allow',
      ]);
      await h.page.locator('[data-note="agents-off"]').waitFor();
      assert.equal(
        await h.page
          .locator('[data-note="agents-off"]')
          .getByRole('link', { name: 'Space settings → Access' })
          .getAttribute('href'),
        '/spaces/onroute/settings?tab=access',
      );
      assert.equal(await h.page.locator('[data-note="grant-required"]').count(), 0);
      // The grants wait behind Change.
      assert.equal(await h.page.getByRole('radio').count(), 0);
      const change = h.page.getByRole('button', { name: 'Change' });
      assert.equal(await change.getAttribute('aria-expanded'), 'false');
      await change.click();
      assert.equal(await change.getAttribute('aria-expanded'), 'true');
      assert.equal(await h.page.getByRole('radio', { name: 'Full' }).isChecked(), true);
      assert.equal(await h.page.getByRole('radio').count(), 3);
      assert.equal(await continueButton(h.page).getAttribute('aria-disabled'), 'false');
      await change.click();
      assert.equal(await h.page.getByRole('radio').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the step is in the address: replaced, kept on reload, moved by the rail and Back', async () => {
    const world: World = { agents: [agentRow({ id: 'a1', grants: FULL })], puts: [] };
    const h = await open(
      '/developer?tab=projects&project=onroute&tool=a1&step=2',
      stub('v3', world),
    );
    try {
      await card(h.page, 2).waitFor({ timeout: 20_000 });
      await h.page.reload();
      await card(h.page, 2).waitFor({ timeout: 20_000 });
      const length = await h.page.evaluate(() => history.length);

      // The rail: a step before this one opens; one after it does not.
      const rail = h.page.getByRole('navigation', { name: 'Project setup steps' });
      assert.equal(
        await rail.getByRole('button', { name: /^Step 3: Review & verify/ }).isDisabled(),
        true,
      );
      await rail.getByRole('button', { name: /^Step 1: Choose project & tool/ }).click();
      await card(h.page, 1).waitFor({ timeout: 5_000 });
      assert.equal(param(h.page, 'step'), null);
      assert.equal(param(h.page, 'project'), 'onroute');
      assert.equal(param(h.page, 'tool'), 'a1');

      await continueButton(h.page).click();
      await card(h.page, 2).waitFor({ timeout: 5_000 });
      await h.page.getByRole('button', { name: 'I ran this prompt' }).click();
      await card(h.page, 3).waitFor({ timeout: 5_000 });
      assert.equal(param(h.page, 'step'), '3');
      // The footer's Back.
      await h.page.getByRole('button', { name: 'Back', exact: true }).click();
      await card(h.page, 2).waitFor({ timeout: 5_000 });
      assert.equal(param(h.page, 'step'), '2');
      await h.page.getByRole('button', { name: 'Back', exact: true }).click();
      await card(h.page, 1).waitFor({ timeout: 5_000 });
      // Every move replaced the address: Back in the browser leaves the page.
      assert.equal(await h.page.evaluate(() => history.length), length);
      assert.equal(await h.page.getByRole('button', { name: 'Back', exact: true }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('done waits for a record: an address that skips it lands on step 3', async () => {
    const world: World = { agents: [agentRow({ id: 'a1', grants: FULL })], puts: [] };
    const h = await open('/developer?tab=projects&step=done', stub('v3', world));
    try {
      await card(h.page, 3).waitFor({ timeout: 20_000 });
      await until(() => param(h.page, 'step') === '3');
      assert.equal(param(h.page, 'step'), '3');
      assert.equal(await h.page.locator('.dx-ps-done').count(), 0);
      assert.equal(await finishButton(h.page).getAttribute('aria-disabled'), 'true');
    } finally {
      await h.close();
    }
  });

  void test('Checked comes only from a local check, which step 3 reads again on focus', async () => {
    const world: World = { agents: [agentRow({ id: 'a1', grants: FULL })], puts: [], setups: [] };
    const h = await open('/developer?tab=projects&step=3', stub('v3', world));
    try {
      await h.page.locator('[data-status="not-recorded"]').waitFor({ timeout: 20_000 });
      // laika project check runs in a terminal; the page hears of it on focus.
      world.setups = [checked()];
      await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await h.page.locator('[data-status="current"]').waitFor({ timeout: 5_000 });
      const status = await h.page.locator('[data-status="current"]').innerText();
      assert.match(status, /^Checked/);
      assert.match(status, /laika project check found the current block on your device/);
      assert.equal(
        await h.page.locator('.conn-rail-step[aria-current="step"] .conn-rail-sub').innerText(),
        'Checked',
      );

      await finishButton(h.page).click();
      await h.page.locator('.dx-ps-done').waitFor({ timeout: 5_000 });
      assert.match(
        (await h.page.locator('[data-detail="verification"] dd').innerText()).trim(),
        /^Checked on Belka at \d+ \w+, \d+:\d\d [AP]M$/,
      );

      // Step 3 has closed, so a focus reads nothing again.
      const reads = () =>
        h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/project-setups').length;
      const before = reads();
      await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await h.page.waitForTimeout(400);
      assert.equal(reads(), before);
    } finally {
      await h.close();
    }
  });

  void test('under the command: which CLI it needs, naming the board’s commit (LAI-1084)', async () => {
    const world: World = { agents: [agentRow({ id: 'a1', grants: FULL })], puts: [], setups: [] };
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const h = await open(
      '/developer?tab=projects&step=3',
      stub('v3', world, {
        '/api/v1/developer/compatibility': {
          ...compat('v3'),
          cli: {
            source: {
              type: 'git',
              url: 'https://github.com/PawanSirsat/Laika.git',
              commit,
              path: 'cli',
            },
          },
        },
      }),
    );
    try {
      const hint = h.page.locator('[data-way="check"] [data-note="cli-match"]');
      await hint.waitFor({ timeout: 20_000 });
      await until(async () => (await hint.innerText()).includes('0123456'));
      assert.equal(
        (await hint.innerText()).replace(/\s+/g, ' ').trim(),
        'This needs a Laika CLI that matches this board (commit 0123456). Check with laika version: if it prints a commit, laika update brings it to this board’s. If either says unknown command, your CLI predates this board: How to update your Laika CLI, below, shows where it comes from and installs a current one beside it, wherever the old one is.',
      );
      // Directly under the command it is about.
      assert.equal(
        await hint.evaluate((el) => el.previousElementSibling?.textContent?.includes('--harness')),
        true,
      );
      assert.deepEqual(await hint.locator('code').allInnerTexts(), [
        '0123456',
        'laika version',
        'laika update',
      ]);
      // LAI-1093: the guide itself, right under the hint — and, open, the fresh
      // install from this board's own source rather than a pull of ~/laika.
      const help = h.page.locator('[data-way="check"] [data-update-cli="project-setup"]');
      assert.equal(
        await hint.evaluate((el) => el.nextElementSibling?.getAttribute('data-update-cli')),
        'project-setup',
      );
      assert.equal(await help.locator('summary').innerText(), 'How to update your Laika CLI');
      await help.locator('summary').click();
      const older = help.locator('[data-guide-step="older"] pre');
      await older.first().waitFor();
      await until(async () => (await older.count()) === 5);
      assert.equal(await older.first().innerText(), 'ls -l "$(command -v laika)"');
      assert.equal(
        await older.nth(1).innerText(),
        `git clone https://github.com/PawanSirsat/Laika.git ~/laika &&\ngit -C ~/laika checkout --detach ${commit} &&\n~/laika/plugin/scripts/install.sh --no-credential`,
      );
      const step = h.page.locator('[data-way="check"]');
      assert.equal(barePull(await step.innerText()), undefined);
      assert.doesNotMatch(await step.innerText(), /pull --ff-only/);
      assert.deepEqual(hazardsIn(await step.locator('pre').allInnerTexts()), []);
    } finally {
      await h.close();
    }
  });

  void test('a board that does not say its commit: the same hint, naming none', async () => {
    const world: World = { agents: [agentRow({ id: 'a1', grants: FULL })], puts: [], setups: [] };
    const h = await open('/developer?tab=projects&step=3', stub('v3', world));
    try {
      const hint = h.page.locator('[data-way="check"] [data-note="cli-match"]');
      await hint.waitFor({ timeout: 20_000 });
      // The page read the answer twice: once for the mode, once for this hint.
      const asked = () =>
        h.calls.filter((c) => c.path === '/api/v1/developer/compatibility').length;
      await until(() => asked() >= 2);
      assert.ok(asked() >= 2, `the hint never asked the board (${String(asked())} reads)`);
      await h.page.waitForTimeout(300);
      const text = (await hint.innerText()).replace(/\s+/g, ' ').trim();
      assert.match(
        text,
        /^This needs a Laika CLI that matches this board\. Check with laika version: /,
      );
      // No commit is named: "if it prints a commit" is the CLI's, not the board's.
      assert.doesNotMatch(text, /\(commit|[0-9a-f]{7}/);
    } finally {
      await h.close();
    }
  });

  void test('a tool laika tool add refuses gets no command: the device cannot check it yet (LAI-1091)', async () => {
    // --harness antigravity exits 2 and records nothing; `other` is Copilot.
    for (const harness of ['antigravity', 'other']) {
      const world: World = {
        agents: [agentRow({ id: 'a1', harness, grants: FULL })],
        puts: [],
        setups: [],
      };
      const h = await open('/developer?tab=projects&step=3', stub('v3', world));
      try {
        const way = h.page.locator('[data-way="check"]');
        const note = way.locator('[data-note="no-device-check"]');
        await note.waitFor({ timeout: 20_000 });
        assert.match(
          await note.innerText(),
          /Laika can’t check .+’s repository from your device yet\s+Record it yourself instead, with I’ve added it below\./,
        );
        // Nowhere in the step, the Not recorded chip's reason included.
        await way.locator('[data-status="not-recorded"]').waitFor({ timeout: 20_000 });
        assert.doesNotMatch(await way.innerText(), /laika project check|Recommended/);
        assert.match(
          await way.locator('[data-status="not-recorded"]').innerText(),
          /Record it yourself with I’ve added it/,
        );
        assert.equal(await way.locator('[data-note="cli-match"]').count(), 0);
        // The catalogue's manual note, for a tool that has one.
        assert.equal(
          await note.locator('[data-note="manual"]').count(),
          harness === 'antigravity' ? 1 : 0,
          harness,
        );
        // And the way it points to is there, and the only one the foot names.
        await h.page.getByRole('button', { name: 'I’ve added it' }).waitFor({ timeout: 5_000 });
        assert.equal((await footNote(h.page).innerText()).trim(), 'Record it yourself to finish.');
      } finally {
        await h.close();
      }
    }
  });

  void test('the reader’s word alone is never Checked', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', grants: FULL })],
      puts: [],
      setups: [
        checked({
          id: 's1',
          source: 'self_reported_browser',
          repo_label: null,
          prefix_match: null,
        }),
      ],
    };
    const h = await open('/developer?tab=projects&step=done', stub('v3', world));
    try {
      await h.page.locator('.dx-ps-done').waitFor({ timeout: 20_000 });
      assert.equal(
        (await h.page.locator('[data-detail="verification"] dd').innerText()).trim(),
        'Recorded by you — not verified',
      );
      assert.doesNotMatch(await h.page.locator('.dx-ps-done').innerText(), /Checked/);
    } finally {
      await h.close();
    }
  });

  void test('a tool with no instructions file gets the bare block', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', harness: 'claude-desktop', grants: FULL })],
      puts: [],
    };
    const h = await open('/developer?tab=projects&step=2', stub('v3', world));
    try {
      await card(h.page, 2).waitFor({ timeout: 20_000 });
      await h.page.locator('.conn-project-block').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.conn-project-prompt').count(), 0);
      assert.equal(await h.page.getByText('Or edit the file yourself').count(), 0);
      assert.match(await h.page.locator('.conn-project-block').innerText(), /laika:begin/);
      assert.equal(
        (await h.page.locator('.dx-focus-title').innerText()).trim(),
        'Claude Desktop has no instructions file',
      );
      assert.equal(
        (await h.page.locator('[data-detail="target"] dt').innerText()).trim(),
        'Where it goes',
      );
    } finally {
      await h.close();
    }
  });

  void test('the setups list: every project’s records, newest first, each opening its step 3', async () => {
    const world: World = {
      agents: [
        agentRow({ id: 'a1', grants: FULL }),
        agentRow({ id: 'a2', harness: 'codex', device_label: 'Strelka', status: 'revoked' }),
      ],
      puts: [],
      setups: [
        checked({ id: 'r1', agent_id: 'a1' }),
        checked({
          id: 'r2',
          agent_id: 'a1',
          project_id: 'p2',
          project_slug: 'atlas',
          repo_label: null,
          source: 'self_reported_browser',
        }),
        checked({ id: 'r3', agent_id: 'a2', repo_label: 'old', template_revision: 1 }),
      ],
    };
    const urls: string[] = [];
    const h = await open('/developer?tab=projects', stub('v3', world), {
      before: (page) => {
        page.on('request', (request) => {
          if (request.url().includes('/api/v1/project-setups')) urls.push(request.url());
        });
        return Promise.resolve();
      },
    });
    try {
      await card(h.page, 1).waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'View existing setups' }).click();
      await h.page.locator('[data-setup="r1"]').waitFor({ timeout: 20_000 });
      assert.equal(param(h.page, 'view'), 'setups');
      // The list's read names no project: it is every project's.
      assert.ok(
        urls.some((u) => new URL(u).search === ''),
        `no read across projects in ${urls.join(', ')}`,
      );

      const rows = h.page.locator('.dx-ps-setups > li');
      assert.deepEqual(
        await rows.evaluateAll((items) =>
          items.map((li) => (li as HTMLElement).dataset.setup ?? (li as HTMLElement).dataset.row),
        ),
        ['new', 'r1', 'r2', 'r3'],
      );
      const text = async (id: string) =>
        (await h.page.locator(`[data-setup="${id}"]`).innerText()).replace(/\s+/g, ' ').trim();
      assert.match(
        await text('r1'),
        /^OnRoute · onroute-app Claude Code · Belka · CLAUDE\.md · checked on Belka Checked Open/,
      );
      assert.match(
        await text('r2'),
        /^Atlas Claude Code · Belka · CLAUDE\.md · your word, not verified Recorded by you Open/,
      );
      assert.doesNotMatch(await text('r2'), /Checked/);
      assert.match(await text('r3'), /Codex · Strelka · disconnected .*Update available$/);
      // A disconnected tool cannot be set up again.
      assert.equal(await h.page.locator('[data-setup="r3"]').getByRole('button').count(), 0);

      await h.page.getByRole('button', { name: 'Open Atlas' }).click();
      await card(h.page, 3).waitFor({ timeout: 20_000 });
      assert.equal(param(h.page, 'view'), null);
      assert.equal(param(h.page, 'project'), 'atlas');
      assert.equal(param(h.page, 'tool'), 'a1');
      assert.equal(param(h.page, 'step'), '3');

      // The list and the wizard push, so the browser’s Back returns to the list.
      await h.page.goBack();
      await h.page.locator('[data-row="new"]').waitFor({ timeout: 20_000 });
      await h.page.getByRole('button', { name: 'Set up a new repository' }).click();
      await card(h.page, 1).waitFor({ timeout: 20_000 });
      assert.equal(param(h.page, 'view'), null);
      assert.equal(param(h.page, 'step'), null);
    } finally {
      await h.close();
    }
  });

  // LAI-1087: at 11.75rem every name and every line under it broke in two.
  void test('each step’s name and its line are one line in the rail, beside the aside and without it', async () => {
    const world: World = { agents: [agentRow({ id: 'a1', grants: FULL })], puts: [] };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      for (const [width, aside] of [
        [1440, true],
        [1366, true],
        [1280, false],
      ] as const) {
        await h.page.setViewportSize({ width, height: 900 });
        await card(h.page, 1).waitFor({ timeout: 20_000 });
        await until(async () => (await h.page.locator('.dx-aside').isVisible()) === aside);
        assert.equal(
          await h.page.locator('.dx-aside').isVisible(),
          aside,
          `the aside at ${String(width)}px`,
        );
        const lines = await h.page
          .locator('.dx-rail-card .conn-rail-name, .dx-rail-card .conn-rail-sub')
          .evaluateAll((els) =>
            els.map((el) => ({
              text: (el.textContent ?? '').replace(/^Step \d: /, ''),
              lines: Math.round(
                el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
              ),
            })),
          );
        assert.deepEqual(
          lines.map((l) => l.text),
          [
            'Choose project & tool',
            'Full access · OnRoute',
            'Copy project prompt',
            'Paste in the repository',
            'Review & verify',
            'Check before working',
          ],
        );
        for (const l of lines) {
          assert.equal(l.lines, 1, `${String(width)}px: “${l.text}” is ${String(l.lines)} lines`);
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('the aside is beside the step on a desktop, gone at 1040 px; the rail is a strip on a phone', async () => {
    const world: World = { agents: [agentRow({ id: 'a1', grants: FULL })], puts: [] };
    const h = await open('/developer?tab=projects', stub('v3', world));
    try {
      await h.page.setViewportSize({ width: 1440, height: 900 });
      await card(h.page, 1).waitFor({ timeout: 20_000 });
      const aside = h.page.locator('.dx-aside');
      assert.equal(await aside.isVisible(), true);
      assert.deepEqual(
        (await aside.locator('.dx-label').allTextContents()).map((t) => t.trim()),
        ['What stays separate', 'What the prompt changes'],
      );
      assert.match(await aside.innerText(), /It carries no token/);
      await h.page.setViewportSize({ width: 1040, height: 900 });
      await until(async () => !(await aside.isVisible()));
      assert.equal(await aside.isVisible(), false);
      assert.equal(await h.page.locator('.dx-rail-title').isVisible(), true);

      await h.page.setViewportSize({ width: 390, height: 844 });
      await until(async () => !(await h.page.locator('.dx-rail-title').isVisible()));
      assert.equal(await h.page.locator('.dx-rail-title').isVisible(), false);
      assert.equal(
        await h.page
          .locator('.dx-rail-card .conn-steps')
          .evaluate((el) => getComputedStyle(el).display),
        'flex',
      );
      // A row of three, not a column: every step starts at the same height.
      const tops = await h.page
        .locator('.dx-rail-card .conn-step')
        .evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().top)));
      assert.equal(tops.length, 3);
      assert.equal(new Set(tops).size, 1, `steps at ${tops.join(', ')}`);
      const box = async (sel: string) => (await h.page.locator(sel).boundingBox())?.y ?? -1;
      assert.ok(
        (await box('.dx-rail-card')) < (await box('.conn-wizard-card')),
        'the strip sits over the card',
      );
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
      assert.equal((await facts(h.page))[0], 'You Viewer · you can read, not change');
    } finally {
      await h.close();
    }
  });

  void test('each tool gets its own file; a repo-config tool gets the separate step', async () => {
    const world: World = {
      agents: [agentRow({ id: 'a1', harness: 'codex' }), agentRow({ id: 'a2', harness: 'vscode' })],
      puts: [],
    };
    const h = await open('/developer?tab=projects&tool=a1&step=2', stub('v3', world));
    try {
      await h.page.locator('.conn-project-prompt').waitFor({ timeout: 20_000 });
      assert.match(await h.page.locator('.conn-project-prompt').innerText(), /\.\/AGENTS\.md/);
      // No grant yet: step 2 still shows the prompt, and says what is missing.
      await h.page.locator('[data-note="needs-grant"]').waitFor();
      await h.page.goto(`${h.origin}/developer?tab=projects&tool=a2&step=2`);
      await h.page.locator('[data-step="repo-mcp"]').waitFor({ timeout: 20_000 });
      assert.match(
        await h.page.locator('.conn-project-prompt').innerText(),
        /\.\/\.github\/copilot-instructions\.md/,
      );
      assert.match(
        await h.page.locator('[data-step="repo-mcp"]').innerText(),
        /laika connect vscode --project/,
      );
      assert.match(
        await h.page.locator('[data-step="repo-mcp"] .dx-note-title').innerText(),
        /Project-scoped configuration/,
      );
      // Its link back to step 1.
      await h.page.getByRole('button', { name: 'Give it access in step 1' }).click();
      await card(h.page, 1).waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('no tools yet: an empty state that goes to Add a tool', async () => {
    const h = await open('/developer?tab=projects', stub('v3', { agents: [], puts: [] }));
    try {
      await h.page.getByText('No connected tools yet').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.dx-empty').count(), 1);
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
      assert.equal(await continueButton(denied.page).getAttribute('aria-disabled'), 'true');
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
      void test(`${theme}, ${String(width)}px: no sideways scroll on any step`, async () => {
        const world: World = {
          agents: [agentRow({ id: 'a1', grants: FULL })],
          puts: [],
          setups: [checked()],
        };
        const h = await open('/developer?tab=projects', stub('v3', world));
        try {
          await h.page.setViewportSize({ width, height: 900 });
          await setTheme(h.page, theme);
          for (const step of ['1', '2', '3', 'done', 'setups']) {
            const query = step === 'setups' ? 'view=setups' : `step=${step}`;
            await h.page.goto(`${h.origin}/developer?tab=projects&${query}`);
            await h.page
              .locator(
                step === 'done'
                  ? '.dx-ps-done [data-detail="verification"]'
                  : step === 'setups'
                    ? '[data-setup="c1"]'
                    : `.conn-wizard-card[data-step="${step}"] .dx-ps-auth, .conn-wizard-card[data-step="${step}"] .conn-block, .conn-wizard-card[data-step="${step}"] [data-status]`,
              )
              .first()
              .waitFor({ timeout: 20_000 });
            const wide = await h.page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            assert.ok(wide <= 0, `${step} scrolls sideways by ${String(wide)}px`);
          }
        } finally {
          await h.close();
        }
      });
    }
  }
});

void describe(
  'evidence: every state, light and dark, 1440 and 390 px',
  { skip: EVIDENCE === undefined || EVIDENCE === '' },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      // The page scrolls inside the app's shell, so a full-page shot stops at
      // the viewport: the viewport grows to the content for the shot instead.
      const shot = async (page: Page, name: string, theme: string, width: number) => {
        const height = page.viewportSize()?.height ?? 900;
        const tall = await page.evaluate(() => {
          let most = document.documentElement.scrollHeight;
          for (const el of document.querySelectorAll('*')) {
            const { overflowY } = getComputedStyle(el);
            const scrolls = overflowY === 'auto' || overflowY === 'scroll';
            if (scrolls && el.clientHeight > window.innerHeight / 2) {
              most = Math.max(most, el.getBoundingClientRect().top + el.scrollHeight);
            }
          }
          return Math.ceil(most);
        });
        await page.setViewportSize({ width, height: Math.max(height, tall) });
        await page.waitForTimeout(150);
        await page.screenshot({
          path: join(dir, `project-setup-${name}-${theme}-${String(width)}.png`),
          fullPage: true,
        });
        await page.setViewportSize({ width, height });
      };
      const settle = async (page: Page, selector: string) => {
        await page.locator(selector).first().waitFor({ timeout: 20_000 });
        await page.waitForTimeout(250);
      };
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          const height = width === 390 ? 844 : 900;

          // Step 1 with no grant.
          const fresh = await open(
            '/developer?tab=projects',
            stub('v3', { agents: [agentRow({ id: 'a1' })], puts: [] }),
          );
          try {
            await fresh.page.setViewportSize({ width, height });
            await setTheme(fresh.page, theme);
            await settle(fresh.page, '[data-note="grant-required"]');
            await shot(fresh.page, 'step1-ungranted', theme, width);
          } finally {
            await fresh.close();
          }

          const world: World = {
            agents: [
              agentRow({ id: 'a1', grants: FULL }),
              agentRow({ id: 'a2', harness: 'codex', device_label: 'Strelka', grants: FULL }),
            ],
            puts: [],
            setups: [],
          };
          const h = await open('/developer?tab=projects&tool=a1', stub('v3', world));
          try {
            await h.page.setViewportSize({ width, height });
            await setTheme(h.page, theme);
            await settle(h.page, '.dx-ps-auth');
            await shot(h.page, 'step1-granted', theme, width);
            await h.page.goto(`${h.origin}/developer?tab=projects&tool=a1&step=2`);
            await settle(h.page, '.conn-project-prompt');
            await shot(h.page, 'step2', theme, width);
            await h.page.goto(`${h.origin}/developer?tab=projects&tool=a1&step=3`);
            await settle(h.page, '[data-status="not-recorded"]');
            await shot(h.page, 'step3-before', theme, width);
            world.setups = [checked()];
            await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await settle(h.page, '[data-status="current"]');
            await shot(h.page, 'step3-after', theme, width);
            await finishButton(h.page).click();
            await settle(h.page, '.dx-ps-done [data-detail="verification"]');
            await shot(h.page, 'done', theme, width);
            world.setups = [
              checked(),
              checked({
                id: 'c2',
                agent_id: 'a2',
                project_id: 'p2',
                project_slug: 'atlas',
                repo_label: 'atlas-web',
                instructions_path: 'AGENTS.md',
                source: 'self_reported_browser',
              }),
              checked({ id: 'c3', repo_label: 'onroute-api', template_revision: 1 }),
            ];
            await h.page.goto(`${h.origin}/developer?tab=projects&view=setups`);
            await settle(h.page, '[data-setup="c3"]');
            await shot(h.page, 'list', theme, width);
          } finally {
            await h.close();
          }

          const none = await open('/developer?tab=projects', stub('v3', { agents: [], puts: [] }));
          try {
            await none.page.setViewportSize({ width, height });
            await setTheme(none.page, theme);
            await settle(none.page, '.dx-empty');
            await shot(none.page, 'no-tools', theme, width);
          } finally {
            await none.close();
          }
        }
      }
    });
  },
);

void describe(
  'LAI-1093 evidence: the check step’s CLI hint and its guide, light and dark, 1440 and 390 px',
  { skip: EVIDENCE === undefined || EVIDENCE === '' },
  () => {
    void test('screenshots', async () => {
      const dir = EVIDENCE ?? '';
      mkdirSync(dir, { recursive: true });
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1440, 390] as const) {
          const world: World = {
            agents: [agentRow({ id: 'a1', grants: FULL })],
            puts: [],
            setups: [],
          };
          const h = await open(
            '/developer?tab=projects&step=3',
            stub('v3', world, {
              '/api/v1/developer/compatibility': {
                ...compat('v3'),
                cli: {
                  source: {
                    type: 'git',
                    url: 'https://github.com/PawanSirsat/Laika.git',
                    commit: '0123456789abcdef0123456789abcdef01234567',
                    path: 'cli',
                  },
                },
              },
            }),
          );
          try {
            await h.page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
            await setTheme(h.page, theme);
            const way = h.page.locator('[data-way="check"]');
            await way.locator('[data-note="cli-match"]').waitFor({ timeout: 20_000 });
            await way.locator('[data-update-cli="project-setup"] > summary').click();
            await way.locator('[data-guide-step="older"] pre').first().waitFor();
            await h.page.setViewportSize({ width, height: 3200 });
            await h.page.waitForTimeout(200);
            await way.screenshot({
              path: join(dir, `project-setup-check-hint-${theme}-${String(width)}.png`),
            });
          } finally {
            await h.close();
          }
        }
      }
    });
  },
);
