/**
 * Developer access → Agents (LAI-537, D-114): register, verify as this
 * agent, rename, change access, rotate, revoke — in a real browser against a
 * stubbed `/api/v1/agents` that keeps state the way LAI-534's routes do.
 *
 * Two properties carry the task, and each is asserted against the thing that
 * would break it rather than against the happy path:
 *
 * - **The secret is shown once.** Never in the address, never in storage,
 *   and gone from the DOM once the reveal closes — read from the page's
 *   whole HTML, not from the element that showed it.
 * - **Verify is this agent only.** The stub gives the owner a fresh session
 *   and a freshly used token of their own while the agent has made no
 *   request; step 5 must stay waiting through that, and complete only when
 *   the agent's own row is stamped.
 *
 * Every step is driven from the keyboard: focus and Enter, Space and arrows,
 * never a click, except where a test is about something else.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  until,
  type ApiStub,
  type StubCall,
} from './harness.ts';
import { confirmSettled } from './confirm.ts';

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

const project = (id: string, prefix: string, name: string) => ({
  id,
  slug: name.toLowerCase(),
  prefix,
  name,
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
});

const SECRET = 'lai_FirstSecretOfTheTestAgent_ZZ9';
const ROTATED = 'lai_SecondSecretAfterRotation_QQ7';

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  project_ids: string[] | null;
  last_used_at: number | null;
  last_mcp_at: number | null;
  last_client: string | null;
  last_client_name: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

interface AgentRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  harness: string;
  device_label: string | null;
  status: 'active' | 'revoked';
  grants: { project_id: string; scope: string }[];
  tokens: TokenRow[];
  created_at: number;
  revoked_at: number | null;
  last_seen_at: number | null;
}

function tokenRow(id: string, name: string, createdAt: number): TokenRow {
  return {
    id,
    name,
    prefix: `lai_${id.slice(-4)}`,
    scope: 'full',
    project_ids: null,
    last_used_at: null,
    last_mcp_at: null,
    last_client: null,
    last_client_name: null,
    expires_at: null,
    revoked_at: null,
    created_at: createdAt,
  };
}

/** A stateful `/agents`, answering as `routes/agents.ts` does. */
function agentsApi(initial: AgentRow[] = [], over: Partial<ApiStub> = {}) {
  const agents = [...initial];
  let seq = 0;
  const one = (call: StubCall): AgentRow | undefined =>
    agents.find((a) => call.path.split('/')[4] === a.id);
  const find = (call: StubCall) => {
    const agent = one(call);
    return agent === undefined ? refuse(404, 'not_found', 'No agent with that id') : agent;
  };

  // The owner is busy the whole time: a session open, a token of their own
  // used a moment ago. Neither may complete step 5.
  const ownerToken = { ...tokenRow('t-owner', 'my laptop', 10), last_used_at: Date.now() };

  const stub: ApiStub = {
    '/api/v1/me': ME,
    '/api/v1/projects': {
      data: [project('p1', 'ONR', 'OnRoute'), project('p2', 'SKY', 'Skynet')],
      next_cursor: null,
    },
    '/api/v1/tokens': { data: [ownerToken], next_cursor: null },
    '/api/v1/presence': {
      enabled: true,
      present: [{ user_id: 'u1', is_agent: true, last_seen_at: Date.now() }],
    },
    '/api/v1/agents': (call: StubCall) => {
      if (call.method === 'POST') {
        const body = call.body as {
          display_name: string;
          harness: string;
          device_label: string | null;
          grants: { project_id: string; scope: string }[];
        };
        seq += 1;
        const now = Date.now();
        const token = tokenRow(`t-agent-${String(seq)}`, body.display_name, now);
        const agent: AgentRow = {
          id: `a${String(seq)}`,
          owner_user_id: 'u1',
          display_name: body.display_name,
          harness: body.harness,
          device_label: body.device_label,
          status: 'active',
          grants: body.grants,
          tokens: [token],
          created_at: now,
          revoked_at: null,
          last_seen_at: null,
        };
        agents.unshift(agent);
        return reply(201, { agent, token, secret: SECRET });
      }
      return { data: agents, next_cursor: null };
    },
    ...over,
  };

  for (const id of ['a1', 'a2', 'a3']) {
    stub[`/api/v1/agents/${id}`] = (call: StubCall) => {
      const agent = one(call);
      if (agent === undefined) return find(call);
      if (call.method === 'PATCH') {
        const body = call.body as { display_name?: string };
        if (body.display_name !== undefined) agent.display_name = body.display_name;
      }
      return agent;
    };
    stub[`/api/v1/agents/${id}/grants`] = (call: StubCall) => {
      const agent = one(call);
      if (agent === undefined) return find(call);
      agent.grants = (call.body as { grants: AgentRow['grants'] }).grants;
      return agent;
    };
    stub[`/api/v1/agents/${id}/rotate-token`] = (call: StubCall) => {
      const agent = one(call);
      if (agent === undefined) return find(call);
      const old = agent.tokens.find((t) => t.id === (call.body as { token_id: string }).token_id);
      if (old === undefined) return refuse(404, 'not_found', 'No token with that id');
      const now = Date.now();
      old.revoked_at = now;
      seq += 1;
      const token = tokenRow(`t-rot-${String(seq)}`, agent.display_name, now);
      agent.tokens.unshift(token);
      return reply(201, { agent, token, secret: ROTATED });
    };
    stub[`/api/v1/agents/${id}/revoke`] = (call: StubCall) => {
      const agent = one(call);
      if (agent === undefined) return find(call);
      agent.status = 'revoked';
      agent.revoked_at = Date.now();
      for (const t of agent.tokens) t.revoked_at ??= agent.revoked_at;
      return agent;
    };
  }

  return { stub, agents };
}

function existing(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'a1',
    owner_user_id: 'u1',
    display_name: 'codex on Linux',
    harness: 'codex',
    device_label: 'build box',
    status: 'active',
    grants: [{ project_id: 'p1', scope: 'read_only' }],
    tokens: [tokenRow('t-a1', 'codex on Linux', 1_000)],
    created_at: 1_000,
    revoked_at: null,
    last_seen_at: null,
    ...over,
  };
}

after(async () => {
  await closeBrowser();
});

/** Press a button by its name, from the keyboard. */
async function press(page: Page, name: string | RegExp, scope = 'body'): Promise<void> {
  const button = page.locator(scope).getByRole('button', { name, exact: typeof name === 'string' });
  await button.focus();
  await page.keyboard.press('Enter');
}

/** The secret anywhere the reader or a script could get it back from. */
async function secretSurvives(page: Page, secret: string): Promise<string[]> {
  return page.evaluate((s: string) => {
    const where: string[] = [];
    if (document.documentElement.outerHTML.includes(s)) where.push('DOM');
    if (window.location.href.includes(s)) where.push('URL');
    if (history.state !== null && JSON.stringify(history.state).includes(s)) where.push('history');
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i) ?? '';
        if (key.includes(s) || (store.getItem(key) ?? '').includes(s)) where.push('storage');
      }
    }
    return where;
  }, secret);
}

const focusedText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');

void describe('the Agents tab (LAI-537)', () => {
  void test('is the second Developer access tab, and says when there are none', async () => {
    const { stub } = agentsApi();
    const h = await open('/developer?tab=agents', stub);
    try {
      await h.page
        .locator('.agents .state-empty')
        .first()
        .waitFor({ timeout: 20_000 });
      const tabs = (await h.page.locator('.page-tab').allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(tabs, ['Connect', 'Agents', 'Projects', 'Activity', 'Tokens']);
      assert.match(await h.page.locator('.agents').innerText(), /No agents registered yet/);
    } finally {
      await h.close();
    }
  });

  void test('registers in five keyboard steps; the secret is shown once; verify waits for this agent', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.getByRole('button', { name: '+ Register an agent' }).waitFor({ timeout: 20_000 });
      await press(page, '+ Register an agent');

      // Step 1 — focus lands on the step's title, inside the wizard.
      await until(async () => (await focusedText(page)) === 'Name, harness and device');
      assert.equal(await focusedText(page), 'Name, harness and device');
      const name = page.locator('.agents-wizard input').first();
      await name.focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('reviewer bot');
      await page.locator('.agents-wizard input').nth(1).focus();
      await page.keyboard.type('laptop-1');
      await press(page, 'Continue', '.agents-wizard');

      // Step 2 — OnRoute: No access → Read only → Full, by arrow keys.
      await page.locator('.agents-grant').first().waitFor();
      await page.locator('input[name="grant-p1"]').first().focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('input[name="grant-p1"]').nth(2).isChecked(), true);
      await press(page, 'Continue', '.agents-wizard');

      // Step 3 — nothing is registered until the reader asks.
      assert.equal(h.calls.filter((c) => c.method === 'POST').length, 0);
      await press(page, 'Register and create its credential');
      await page.locator('[data-testid="agent-secret"]').waitFor();
      const posted = h.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/agents');
      assert.deepEqual(posted?.body, {
        display_name: 'reviewer bot',
        harness: 'claude-code',
        device_label: 'laptop-1',
        grants: [{ project_id: 'p1', scope: 'full' }],
      });
      assert.equal(await page.locator('[data-testid="agent-secret"]').innerText(), SECRET);
      assert.deepEqual(
        (await secretSurvives(page, SECRET)).filter((w) => w !== 'DOM'),
        [],
        'the secret reached the address or storage',
      );
      // Steps 1 and 2 are closed now: the agent exists.
      assert.equal(await page.locator('.agents-rail-step').nth(0).isDisabled(), true);

      // Step 4 — the harness blocks carry the agent's token.
      await press(page, 'Continue', '.agents-wizard');
      await page.locator('.agents-setup .conn-setup').first().waitFor();
      assert.match(await page.locator('.agents-setup').innerText(), new RegExp(SECRET));

      // Step 5 — the owner is active, the agent is not: still waiting.
      await press(page, 'Continue', '.agents-wizard');
      const polls = () =>
        h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/agents/a1');
      await until(() => polls().length >= 1);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'watching');
      assert.match(await page.locator('.agents-verify').innerText(), /Waiting for a request/);

      // A request authenticated as this agent arrives.
      const agent = api.agents[0];
      assert.ok(agent !== undefined);
      agent.last_seen_at = Date.now();
      await until(
        async () =>
          (await page.locator('.agents-verify').getAttribute('data-state')) === 'verified',
        15_000,
      );
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'verified');

      // Done — the secret leaves the page with the wizard, and focus goes back.
      await press(page, 'Done', '.agents-wizard');
      await page.locator('.agents-wizard').waitFor({ state: 'detached' });
      assert.deepEqual(await secretSurvives(page, SECRET), [], 'the secret survived closing');
      await until(async () => (await focusedText(page)) === '+ Register an agent');
      assert.equal(await focusedText(page), '+ Register an agent');
      assert.match(await page.locator('.agents-row').innerText(), /reviewer bot/);
      assert.match(await page.locator('.agents-row .agents-state').innerText(), /Connected/);
    } finally {
      await h.close();
    }
  });

  void test('rotate asks first, shows the new secret once, and forgets it on Done', async () => {
    const api = agentsApi([existing()]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });
      assert.match(
        await page.locator('.agents-row .agents-state').innerText(),
        /Credential created/,
      );
      assert.match(await page.locator('.agents-row').innerText(), /self-reported/);

      await press(page, 'Rotate token', '.agents-row');
      await confirmSettled(page);
      // useDialogFocus: focus is inside the dialog, on Cancel.
      assert.equal(await focusedText(page), 'Cancel');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.locator('[data-testid="agent-secret"]').waitFor();

      const rotate = h.calls.find((c) => c.path === '/api/v1/agents/a1/rotate-token');
      assert.deepEqual(rotate?.body, { token_id: 't-a1' });
      assert.equal(await page.locator('[data-testid="agent-secret"]').innerText(), ROTATED);
      assert.equal(api.agents[0]?.tokens.find((t) => t.id === 't-a1')?.revoked_at !== null, true);

      await press(page, 'Done', '.agents-row');
      await page.locator('[data-testid="agent-secret"]').waitFor({ state: 'detached' });
      assert.deepEqual(await secretSurvives(page, ROTATED), []);
      await until(async () => (await focusedText(page)) === 'Rotate token');
      assert.equal(await focusedText(page), 'Rotate token');
    } finally {
      await h.close();
    }
  });

  void test('revoke asks through the dialog; Escape keeps it, confirming revokes it', async () => {
    const api = agentsApi([existing()]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });
      await press(page, 'Revoke', '.agents-row');
      await confirmSettled(page);
      assert.match(await page.locator('[data-confirm-dialog]').innerText(), /codex on Linux/);
      await page.keyboard.press('Escape');
      await page.locator('[data-confirm-dialog]').waitFor({ state: 'detached' });
      assert.equal(h.calls.filter((c) => c.path.endsWith('/revoke')).length, 0);
      // Focus came back to the control that opened it.
      await until(async () => (await focusedText(page)) === 'Revoke');
      assert.equal(await focusedText(page), 'Revoke');

      await page.keyboard.press('Enter');
      await confirmSettled(page);
      await page.locator('[data-confirm-ok] button').focus();
      await page.keyboard.press('Enter');
      await until(
        async () => (await page.locator('.agents-row').getAttribute('data-state')) === 'revoked',
      );
      assert.match(await page.locator('.agents-row .agents-state').innerText(), /Revoked/);
      // A revoked agent offers nothing more to do.
      assert.equal(await page.locator('.agents-row-actions').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('rename and manage access send exactly what was changed', async () => {
    const api = agentsApi([existing()]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });

      await press(page, 'Rename', '.agents-row');
      await page.locator('.agents-panel input').waitFor();
      await page.keyboard.type('codex builder');
      await page.keyboard.press('Enter');
      await until(() => h.calls.some((c) => c.method === 'PATCH'));
      assert.deepEqual(h.calls.find((c) => c.method === 'PATCH')?.body, {
        display_name: 'codex builder',
      });
      await until(async () => (await focusedText(page)) === 'Rename');
      assert.match(await page.locator('.agents-row-name').innerText(), /codex builder/);

      await press(page, 'Manage access', '.agents-row');
      await page.locator('.agents-panel input[name="grant-p2"]').first().waitFor();
      // Skynet: No access → Read only.
      await page.locator('.agents-panel input[name="grant-p2"]').first().focus();
      await page.keyboard.press('ArrowRight');
      await press(page, 'Save access', '.agents-panel');
      await until(() => h.calls.some((c) => c.method === 'PUT'));
      assert.deepEqual(h.calls.find((c) => c.method === 'PUT')?.body, {
        grants: [
          { project_id: 'p1', scope: 'read_only' },
          { project_id: 'p2', scope: 'read_only' },
        ],
      });
      await until(async () => (await page.locator('.agents-panel').count()) === 0);
      assert.match(await page.locator('.agents-row').innerText(), /Skynet \(read only\)/);
    } finally {
      await h.close();
    }
  });

  void test('a refused list is the permission-denied state, never an empty one', async () => {
    const { stub } = agentsApi([], {
      '/api/v1/agents': refuse(403, 'forbidden', 'Not allowed'),
    });
    const h = await open('/developer?tab=agents', stub);
    try {
      await h.page.locator('.agents .state-forbidden').waitFor({ timeout: 20_000 });
      assert.doesNotMatch(await h.page.locator('.agents').innerText(), /No agents registered/);
    } finally {
      await h.close();
    }
  });

  void test('without agent.manage_own the list is read only, and says why', async () => {
    const api = agentsApi([existing()]);
    const permissions = {
      org_roles: ['owner', 'admin', 'member', 'viewer'],
      project_roles: ['lead', 'member', 'viewer'],
      permissions: [],
      me: {
        org_role: 'member',
        credential: 'token',
        project_scope: 'all',
        implicit_project_role: null,
        actions: ['org.read', 'agent.read_own'],
        projects: [],
      },
    };
    const h = await open('/developer?tab=agents', {
      ...api.stub,
      '/api/v1/permissions': permissions,
    });
    try {
      await h.page.locator('.agents-row').waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.agents-note').count()) > 0);
      assert.match(
        await h.page.locator('.agents').innerText(),
        /needs a signed-in browser session/,
      );
      assert.equal(await h.page.getByRole('button', { name: '+ Register an agent' }).count(), 0);
      assert.equal(await h.page.locator('.agents-row-actions').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('390 px: the list and every wizard step fit without sideways scrolling', async () => {
    const api = agentsApi([
      existing({ display_name: 'a-very-long-agent-name-that-must-wrap-somewhere-sensible' }),
    ]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });
      assert.ok(
        (await overflow()) <= 0,
        `the list scrolls sideways by ${String(await overflow())}px`,
      );

      await press(page, '+ Register an agent');
      for (const step of [1, 2, 3, 4, 5]) {
        await page.locator(`.agents-wizard[data-step="${String(step)}"]`).waitFor();
        assert.ok((await overflow()) <= 0, `step ${String(step)} scrolls sideways`);
        if (step === 3) {
          await press(page, 'Register and create its credential');
          await page.locator('[data-testid="agent-secret"]').waitFor();
        }
        if (step < 5) await press(page, 'Continue', '.agents-wizard');
      }
    } finally {
      await h.close();
    }
  });
});
