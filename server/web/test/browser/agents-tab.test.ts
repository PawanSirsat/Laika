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
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  open,
  refuse,
  reply,
  setTheme,
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
const laterSecret = (seq: number): string => `lai_LaterAgentSecret_${String(seq)}_KK1`;

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
    return one(call) ?? refuse(404, 'not_found', 'No agent with that id');
  };

  // The owner is busy the whole time: a session open, a token of their own
  // used a moment ago. Neither may complete step 5.
  const ownerToken = { ...tokenRow('t-owner', 'my laptop', 10), last_used_at: Date.now() };

  const stub: Record<string, unknown> = {
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
        // The first registration's secret is SECRET; each later one has its own.
        return reply(201, { agent, token, secret: seq === 1 ? SECRET : laterSecret(seq) });
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

  return { stub: stub as ApiStub, agents };
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

/** Evidence for the PR, when `$LAIKA_SHOTS` is set: the Agents card, whole. */
const SHOTS = process.env.LAIKA_SHOTS;
async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  // Tall enough for the whole card: the page scrolls inside `main`, which
  // would otherwise clip it.
  const size = page.viewportSize();
  if (size === null) throw new Error('no viewport');
  const card = page.locator('[data-testid="agents-tab"]');
  const tall = await card.evaluate((el) => el.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, tall + 400) });
  await card.screenshot({ path: join(SHOTS, `${name}.png`) });
  await page.setViewportSize(size);
}

after(async () => {
  await closeBrowser();
});

/** The registration rail, one `"<done|current|todo> <name>"` per step. */
async function railSteps(page: Page): Promise<string[]> {
  return page
    .locator('.agents-wizard [data-reg-steps] li')
    .evaluateAll((els) =>
      els.map(
        (el) =>
          `${el.getAttribute('data-step') ?? '?'} ${el.querySelector('.reg-step-name')?.textContent ?? ''}`,
      ),
    );
}

/** The first row's readiness facts: fact → `data-reached`. */
async function readiness(page: Page): Promise<Record<string, string>> {
  return page
    .locator('.agents-row [data-readiness] [data-fact]')
    .evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => [
          el.getAttribute('data-fact') ?? '?',
          el.getAttribute('data-reached') ?? '?',
        ]),
      ),
    );
}

/** Press a button by its name, from the keyboard. */
/** Step 1's one field (D-120): the device, typed by keyboard into the wizard's only input. */
async function typeDevice(page: Page, device = 'laptop-1'): Promise<void> {
  const field = page.locator('.agents-wizard input').first();
  await field.waitFor();
  await field.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(device);
}

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

/**
 * Whether the secret is still reachable **from React's own tree** — every
 * object the root container's fibre graph reaches, hooks and props of the
 * current and the retained (alternate) trees included. DOM nodes are skipped
 * (the DOM has its own check); closures cannot be walked from script.
 *
 * `TokensScreen` measured the defect this exists for by walking the fibre tree
 * by hand (a hook still holding `{ token, secret }` after dismissal). This is
 * that walk as an instrument, and every test that uses it first proves it
 * **finds** the secret while it is showing — a walker that cannot see it
 * would report a leak as clean.
 */
/** `'found'`, `'clean'`, or why the walk could not run. */
async function secretInReact(page: Page, secret: string): Promise<string> {
  return page.evaluate((s: string) => {
    const root = document.getElementById('root') as (HTMLElement & Record<string, unknown>) | null;
    if (root === null) return 'no #root';
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (key === undefined) return 'no React container';
    const seen = new Set<object>();
    const queue: unknown[] = [root[key]];
    let visited = 0;
    while (queue.length > 0) {
      const value = queue.pop();
      if (typeof value === 'string') {
        if (value.includes(s)) return 'found';
        continue;
      }
      if (typeof value !== 'object' || value === null) continue;
      if (seen.has(value) || value instanceof Node || value === window) continue;
      seen.add(value);
      visited += 1;
      if (visited > 3_000_000) return 'budget exhausted';
      if (value instanceof Map || value instanceof Set) for (const item of value) queue.push(item);
      let keys: string[];
      try {
        keys = Object.keys(value);
      } catch {
        continue;
      }
      for (const k of keys) {
        try {
          queue.push((value as Record<string, unknown>)[k]);
        } catch {
          // A getter that throws holds nothing we can read.
        }
      }
    }
    return 'clean';
  }, secret);
}

/**
 * Watch the wizard until it leaves, remembering whether **the last DOM it had
 * before it was removed** still carried the secret (review round 1). Closing
 * must commit a blanked render first and unmount after; unmounting at once
 * removes a wizard whose last frame still shows the token. The answer is read
 * with {@link lastWizardFrameHadSecret}.
 */
async function watchWizardFrames(page: Page, secret: string): Promise<void> {
  await page.evaluate((s: string) => {
    const w = window as unknown as { __wizardHadSecret?: boolean; __wizardGone?: boolean };
    w.__wizardGone = false;
    const look = (): void => {
      const wizard = document.querySelector('.agents-wizard');
      if (wizard === null) {
        w.__wizardGone = true;
        observer.disconnect();
        return;
      }
      w.__wizardHadSecret = (wizard.textContent ?? '').includes(s);
    };
    const observer = new MutationObserver(look);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    look();
  }, secret);
}

async function lastWizardFrameHadSecret(page: Page): Promise<boolean | 'still open'> {
  return page.evaluate(() => {
    const w = window as unknown as { __wizardHadSecret?: boolean; __wizardGone?: boolean };
    return w.__wizardGone === true ? w.__wizardHadSecret === true : 'still open';
  });
}

/** How many agent-list reads the tab has settled, applied or dropped. */
async function readsSettled(page: Page): Promise<number> {
  return Number(
    (await page.locator('[data-testid="agents-tab"]').getAttribute('data-reads-settled')) ?? NaN,
  );
}

const focusedText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');

void describe('the Agents tab (LAI-537)', () => {
  void test('is the second Developer access tab, and says when there are none', async () => {
    const { stub } = agentsApi();
    const h = await open('/developer?tab=agents', stub);
    try {
      await h.page.locator('.agents .state-empty').first().waitFor({ timeout: 20_000 });
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
      await until(async () => (await focusedText(page)) === 'Harness and device');
      assert.equal(await focusedText(page), 'Harness and device');
      // The rail is LAI-536's RegistrationSteps (LAI-565), and the tab draws
      // no rail of its own beside it.
      assert.deepEqual(await railSteps(page), [
        'current Harness and device',
        'todo Projects and permissions',
        'todo Credential',
        'todo Harness instructions',
        'todo Verify a request from this agent',
      ]);
      assert.equal(await page.locator('.agents-wizard .agents-rail, .agents-rail-step').count(), 0);
      // D-120: no name field. The one input is the device, and the step
      // says what every screen will call the agent: its harness and device.
      assert.equal(await page.locator('.agents-wizard input').count(), 1);
      assert.equal(
        await page.locator('.agents-wizard').getByRole('button', { name: 'Continue' }).isDisabled(),
        true,
        'Continue is open with no device',
      );
      await typeDevice(page, 'laptop-1');
      assert.equal(
        await page.locator('[data-agent-label-preview]').innerText(),
        'Shown everywhere as Claude Code · laptop-1',
      );
      assert.equal(await page.locator('[data-cloud-note]').count(), 0);
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
        display_name: 'claude-code on laptop-1',
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
      // Steps 1 and 2 are closed now: the agent exists. The rail says they
      // are done, and Back, the only way to them, is gone.
      assert.deepEqual((await railSteps(page)).slice(0, 3), [
        'done Harness and device',
        'done Projects and permissions',
        'current Credential',
      ]);
      assert.equal(
        await page.locator('.agents-wizard').getByRole('button', { name: 'Back' }).count(),
        0,
      );

      // Step 4 — the harness blocks carry the agent's token.
      await press(page, 'Continue', '.agents-wizard');
      await page.locator('.agents-setup .conn-setup').first().waitFor();
      assert.match(await page.locator('.agents-setup').innerText(), new RegExp(SECRET));
      // Its badge says whose token: the agent's, not the reader's (LAI-583).
      const tags = await page
        .locator('.agents-setup .conn-block-tag')
        .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
      assert.ok(tags.length > 0, 'no block is marked as carrying a token');
      assert.deepEqual(new Set(tags), new Set(['carries the agent’s token']));
      // The walker's positive control: while it shows, React holds it.
      assert.equal(await secretInReact(page, SECRET), 'found');

      // While the wizard holds this agent's secret, its row cannot rotate or
      // revoke it (review round 1).
      const row = page.locator('.agents-row[data-agent="a1"]');
      await row.waitFor();
      assert.equal(await row.getByRole('button', { name: 'Rotate token' }).isDisabled(), true);
      assert.equal(await row.getByRole('button', { name: 'Revoke' }).isDisabled(), true);
      assert.match(await row.innerText(), /Finish or close its registration above/);

      // Step 5 — the owner is active, the agent is not: still waiting.
      await press(page, 'Continue', '.agents-wizard');
      // The card's title is the rail's current step, from the same list.
      await until(async () => (await focusedText(page)) === 'Verify a request from this agent');
      assert.equal(
        (await railSteps(page)).at(-1),
        `current ${await page.locator('#agents-step-title').innerText()}`,
      );
      const polls = () =>
        h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/agents/a1');
      await until(() => polls().length >= 1);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'watching');
      assert.match(await page.locator('.agents-verify').innerText(), /Waiting for a request/);

      // The agent is stamped — but not through the token minted here. That is
      // what any of its other credentials would do; it must not verify.
      const agent = api.agents[0];
      assert.ok(agent !== undefined);
      agent.last_seen_at = Date.now();
      const before = polls().length;
      await until(() => polls().length >= before + 1, 15_000);
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'watching');

      // A request on the minted token itself arrives.
      const minted = agent.tokens[0];
      assert.ok(minted !== undefined);
      minted.last_used_at = Date.now();
      await until(
        async () =>
          (await page.locator('.agents-verify').getAttribute('data-state')) === 'verified',
        15_000,
      );
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'verified');

      // Done — the secret leaves the page with the wizard, and focus goes back.
      // Blanked first, then removed: the wizard's last frame has no secret.
      await watchWizardFrames(page, SECRET);
      assert.equal(await lastWizardFrameHadSecret(page), 'still open');
      await press(page, 'Done', '.agents-wizard');
      await page.locator('.agents-wizard').waitFor({ state: 'detached' });
      assert.equal(
        await lastWizardFrameHadSecret(page),
        false,
        'the wizard was removed while still showing the secret',
      );
      assert.deepEqual(await secretSurvives(page, SECRET), [], 'the secret survived closing');
      assert.equal(await secretInReact(page, SECRET), 'clean', 'React still holds the secret');
      await until(async () => (await focusedText(page)) === '+ Register an agent');
      // Released: the row can rotate and revoke again.
      assert.equal(
        await row.getByRole('button', { name: 'Rotate token' }).isDisabled(),
        false,
        'rotate stayed disabled after the wizard closed',
      );
      assert.equal(await focusedText(page), '+ Register an agent');
      assert.equal(
        await page.locator('.agents-row .agents-row-name').innerText(),
        'Claude Code · laptop-1',
      );
      assert.deepEqual(await readiness(page), {
        credential_created: 'true',
        connected: 'true',
        ready_for_recovery: 'false',
      });
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
      // Readiness is LAI-536's AgentReadiness (LAI-565): a token, never used.
      assert.deepEqual(await readiness(page), {
        credential_created: 'true',
        connected: 'false',
        ready_for_recovery: 'false',
      });
      assert.match(
        await page.locator('.agents-row [data-fact="connected"]').innerText(),
        /Connected — not yet/,
      );
      assert.equal(await page.locator('.agents-state').count(), 0, 'the tab drew its own pill');
      // The row is named by harness and device (D-120), and its mark is its only one.
      assert.equal(
        (await page.locator('.agents-row .agents-row-name').innerText()).trim(),
        'Codex · build box',
      );
      assert.equal(await page.locator('.agents-row .agent-mark').count(), 1);
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

      assert.equal(await secretInReact(page, ROTATED), 'found');
      await press(page, 'Done', '.agents-row');
      await page.locator('[data-testid="agent-secret"]').waitFor({ state: 'detached' });
      assert.deepEqual(await secretSurvives(page, ROTATED), []);
      await until(async () => (await secretInReact(page, ROTATED)) === 'clean');
      assert.equal(await secretInReact(page, ROTATED), 'clean');
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
      // Named by its harness and device (D-120), never its registered name.
      const asked = await page.locator('[data-confirm-dialog]').innerText();
      assert.match(asked, /Revoke Codex · build box\?/);
      assert.doesNotMatch(asked, /codex on Linux/);
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
      // Revoked is said in words, and no readiness claims anything of it.
      assert.match(await page.locator('.agents-row .agents-revoked').innerText(), /^Revoked/);
      assert.equal(await page.locator('.agents-row [data-readiness]').count(), 0);
      // A revoked agent offers nothing more to do.
      assert.equal(await page.locator('.agents-row-actions').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a seen agent whose token expired says none live, and still connected', async () => {
    const lapsed = { ...tokenRow('t-a1', 'codex on Linux', 1_000), expires_at: 2_000 };
    const api = agentsApi([existing({ tokens: [lapsed], last_seen_at: 1_500 })]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });
      // LAI-318: a credential that stopped working is not one never created,
      // and the token lapsing does not unsay that Laika saw the agent.
      assert.deepEqual(await readiness(page), {
        credential_created: 'false',
        connected: 'true',
        ready_for_recovery: 'false',
      });
      const credential = await page
        .locator('.agents-row [data-fact="credential_created"]')
        .innerText();
      assert.match(credential, /Credential created — none live/);
      assert.match(
        credential,
        /No live credential: every token for this agent has expired or been revoked/,
      );
      const row = await page.locator('.agents-row [data-readiness]').innerText();
      assert.doesNotMatch(row, /No token yet/);
      assert.doesNotMatch(row, /has not seen a request/);
    } finally {
      await h.close();
    }
  });

  void test('rename and manage access send exactly what was changed', async () => {
    // Rename is offered only to a legacy duplicate (D-120), where the typed
    // name is the mark that tells two agents on one pair apart.
    const api = agentsApi([
      existing(),
      existing({ id: 'a2', display_name: 'by hand', tokens: [tokenRow('t-a2', 'by hand', 1_000)] }),
    ]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.locator('.agents-row').first().waitFor({ timeout: 20_000 });
      assert.equal(await page.locator('.agents-row[data-duplicate]').count(), 2);

      await press(page, 'Rename', '.agents-row[data-agent="a1"]');
      await page.locator('.agents-panel input').waitFor();
      await page.keyboard.type('codex builder');
      await page.keyboard.press('Enter');
      await until(() => h.calls.some((c) => c.method === 'PATCH'));
      assert.deepEqual(h.calls.find((c) => c.method === 'PATCH')?.body, {
        display_name: 'codex builder',
      });
      // Wait on the name itself, with the row's own 20 s budget (LAI-581).
      // `until` gives up quietly: a PATCH answered after its default 5 s left
      // the old name on screen and failed the read below under a full gate.
      // Focus comes back in the same answer, so it is asserted after.
      const rowName = page.locator('.agents-row[data-agent="a1"] .agents-row-name');
      await until(async () => (await rowName.innerText()).includes('codex builder'), 20_000);
      assert.equal(await rowName.innerText(), 'Codex · build box (codex builder)');
      assert.equal(await focusedText(page), 'Rename');

      await press(page, 'Manage access', '.agents-row[data-agent="a1"]');
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
      assert.match(
        await page.locator('.agents-row[data-agent="a1"]').innerText(),
        /Skynet \(read only\)/,
      );
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
      existing({ device_label: 'a-very-long-device-name-that-must-wrap-somewhere-sensible' }),
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
        if (step === 1) await typeDevice(page, 'a-very-long-device-name-that-must-wrap-somewhere');
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

  /** Register through the UI and stop at `step` (4 or 5), keyboard only. */
  async function registerTo(page: Page, step: 4 | 5): Promise<void> {
    await page.getByRole('button', { name: '+ Register an agent' }).waitFor({ timeout: 20_000 });
    await press(page, '+ Register an agent');
    await typeDevice(page);
    await press(page, 'Continue', '.agents-wizard');
    await page.locator('.agents-grant').first().waitFor();
    await press(page, 'Continue', '.agents-wizard');
    await press(page, 'Register and create its credential');
    await page.locator('[data-testid="agent-secret"]').waitFor();
    await press(page, 'Continue', '.agents-wizard');
    await page.locator('.agents-setup .conn-setup').first().waitFor();
    if (step === 5) {
      await press(page, 'Continue', '.agents-wizard');
      await page.locator('.agents-verify').waitFor();
    }
  }

  void test('Close on a step showing the secret blanks it, commits, and only then unmounts', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await registerTo(page, 4);
      assert.match(await page.locator('.agents-wizard').innerText(), new RegExp(SECRET));
      await watchWizardFrames(page, SECRET);
      assert.equal(await lastWizardFrameHadSecret(page), 'still open');

      await press(page, 'Close', '.agents-wizard');
      await page.locator('.agents-wizard').waitFor({ state: 'detached' });
      assert.equal(
        await lastWizardFrameHadSecret(page),
        false,
        'the wizard was removed while still showing the secret',
      );
      assert.deepEqual(await secretSurvives(page, SECRET), []);
      await until(async () => (await secretInReact(page, SECRET)) === 'clean');
      assert.equal(await secretInReact(page, SECRET), 'clean');
    } finally {
      await h.close();
    }
  });

  void test('Cancel while registering: the late answer keeps no secret and locks no row', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let posted = false;
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub, {
      before: async (p) => {
        await p.route('**/api/v1/agents', async (route) => {
          if (route.request().method() === 'POST') {
            posted = true;
            await gate;
          }
          await route.fallback();
        });
      },
    });
    const { page } = h;
    try {
      await page.getByRole('button', { name: '+ Register an agent' }).waitFor({ timeout: 20_000 });
      await press(page, '+ Register an agent');
      await typeDevice(page);
      await press(page, 'Continue', '.agents-wizard');
      await page.locator('.agents-grant').first().waitFor();
      await press(page, 'Continue', '.agents-wizard');
      await press(page, 'Register and create its credential');
      await until(() => posted);
      assert.ok(posted, 'the registration request was never sent');

      // Cancel while the server has not answered.
      await press(page, 'Cancel', '.agents-wizard');
      await page.locator('.agents-wizard').waitFor({ state: 'detached' });

      // The server answers now: the agent exists, with a secret nobody saw.
      release();
      const row = page.locator('.agents-row[data-agent="a1"]');
      await row.waitFor({ timeout: 15_000 });
      assert.equal(await page.locator('.agents-wizard').count(), 0, 'a wizard reopened');
      assert.deepEqual(await secretSurvives(page, SECRET), [], 'the late secret reached the page');
      assert.equal(await secretInReact(page, SECRET), 'clean', 'React holds the late secret');
      // No wizard holds it, so its row is not locked.
      assert.equal(await row.getByRole('button', { name: 'Rotate token' }).isDisabled(), false);
      assert.equal(await row.getByRole('button', { name: 'Revoke' }).isDisabled(), false);
      assert.doesNotMatch(await row.innerText(), /Finish or close its registration/);
      // And the reader is told it exists with a credential nobody holds.
      assert.match(
        await page.locator('.agents [role="status"]').innerText(),
        /never shown and nobody holds it/,
      );
    } finally {
      await h.close();
    }
  });

  /**
   * Hold the register POST (and, when `holdList` is armed, list reads) at the
   * page. A held list read is **fetched at once and answered later**, so its
   * answer is a picture of the server from before the held POST reached it —
   * the stale read review round 3 found.
   */
  async function holdRequests(page: Page) {
    let releasePost: () => void = () => undefined;
    const postGate = new Promise<void>((done) => {
      releasePost = done;
    });
    let releaseList: () => void = () => undefined;
    const listGate = new Promise<void>((done) => {
      releaseList = done;
    });
    // `heldLists` counts snapshots **already captured** — incremented only
    // after `route.fetch()` has answered, so a test that waits on it knows the
    // stale picture exists (review round 4).
    const state = { posts: 0, holdPosts: 1, holdList: false, heldLists: 0 };
    await page.route(
      (url) => url.pathname === '/api/v1/agents',
      async (route) => {
        const method = route.request().method();
        if (method === 'POST') {
          state.posts += 1;
          if (state.posts <= state.holdPosts) await postGate;
          await route.fallback();
          return;
        }
        if (method === 'GET' && state.holdList) {
          const answer = await route.fetch();
          state.heldLists += 1;
          await listGate;
          await route.fulfill({ response: answer });
          return;
        }
        await route.fallback();
      },
    );
    return { state, releasePost, releaseList };
  }

  async function toStep3(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: '+ Register an agent' }).waitFor({ timeout: 20_000 });
    await press(page, '+ Register an agent');
    // The device is the one field, and with the harness it is the label.
    await typeDevice(page, name);
    await press(page, 'Continue', '.agents-wizard');
    await page.locator('.agents-grant').first().waitFor();
    await press(page, 'Continue', '.agents-wizard');
  }

  void test('a list read asked before a late registration answers never erases its row', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      const held = await holdRequests(page);
      await toStep3(page, 'late bot');
      await press(page, 'Register and create its credential');
      await until(() => held.state.posts === 1);

      // Cancel's reload is asked now — before the agent exists — and held.
      held.state.holdList = true;
      const settledBefore = await readsSettled(page);
      await press(page, 'Cancel', '.agents-wizard');
      await page.locator('.agents-wizard').waitFor({ state: 'detached' });
      await until(() => held.state.heldLists >= 1);
      assert.ok(held.state.heldLists >= 1, 'the Cancel reload was never captured');

      // The registration answers: the row appears, unlocked.
      held.releasePost();
      const row = page.locator('.agents-row[data-agent="a1"]');
      await row.waitFor({ timeout: 15_000 });

      // Then the older read lands. It must not erase the newer row — read once
      // the page has handled it, not after a guessed delay.
      held.releaseList();
      await until(async () => (await readsSettled(page)) === settledBefore + 1, 15_000);
      assert.equal(await readsSettled(page), settledBefore + 1, 'the stale read never settled');
      assert.equal(await row.count(), 1, 'the older list read erased the late row');
      assert.equal(await row.getByRole('button', { name: 'Rotate token' }).isDisabled(), false);
      assert.equal(await row.getByRole('button', { name: 'Revoke' }).isDisabled(), false);
      assert.match(await page.locator('.agents [role="status"]').innerText(), /late bot/);

      // Rotating the unseen token is acting on the notice: it goes.
      held.state.holdList = false;
      await press(page, 'Rotate token', '.agents-row[data-agent="a1"]');
      await confirmSettled(page);
      await page.locator('[data-confirm-ok] button').click();
      await page.locator('[data-testid="agent-secret"]').waitFor();
      assert.equal(await page.locator('.agents [role="status"]').count(), 0, 'the notice stayed');
    } finally {
      await h.close();
    }
  });

  /**
   * Every page of every list read held at the page, each answered when the
   * test says and how (review round 4). Nothing reaches the stub.
   *
   * **Why two pages.** `api/client.ts` shares an identical GET still in flight
   * (`sharedCache`), so two reads of the same first page are one request with
   * one outcome — they cannot cross. They can when the list pages: an older
   * read still on its second page and a reload's first page are different
   * requests, which is the case a long list meets.
   */
  async function holdListReads(page: Page) {
    type Answer = { readonly ok: true; readonly cursor: string | null } | { readonly ok: false };
    const reads: { url: string; answer: (how: Answer) => Promise<void> }[] = [];
    await page.route(
      (url) => url.pathname === '/api/v1/agents',
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await new Promise<void>((asked) => {
          reads.push({
            url: route.request().url(),
            answer: async (how) => {
              await (how.ok
                ? route.fulfill({ json: { data: [existing()], next_cursor: how.cursor } })
                : route.fulfill({
                    status: 500,
                    json: { error: { code: 'internal', message: 'The board fell over' } },
                  }));
              asked();
            },
          });
        });
      },
    );
    return reads;
  }

  /**
   * The older read on its second page, the newer (Cancel's) on its first,
   * both unanswered. Each request is awaited by count, never by a delay.
   */
  async function twoReadsInFlight(
    page: Page,
    reads: Awaited<ReturnType<typeof holdListReads>>,
  ): Promise<void> {
    await until(() => reads.length === 1, 20_000);
    assert.equal(reads.length, 1, 'the first list read was never asked');
    await reads[0]?.answer({ ok: true, cursor: 'page-2' });
    await until(() => reads.length === 2);
    assert.match(reads[1]?.url ?? '', /cursor=page-2/, 'the older read did not page');

    await page.getByRole('button', { name: '+ Register an agent' }).waitFor({ timeout: 20_000 });
    await press(page, '+ Register an agent');
    await page.locator('.agents-wizard').waitFor();
    await press(page, 'Cancel', '.agents-wizard');
    await page.locator('.agents-wizard').waitFor({ state: 'detached' });
    await until(() => reads.length === 3);
    assert.equal(reads.length, 3, 'Cancel asked no second list read');
    assert.doesNotMatch(reads[2]?.url ?? '', /cursor=/, 'the reload did not start at page one');
    assert.equal(await readsSettled(page), 0);
  }

  void test('an older failed read never hides a newer list', async () => {
    let reads: Awaited<ReturnType<typeof holdListReads>> = [];
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub, {
      before: async (p) => {
        reads = await holdListReads(p);
      },
    });
    const { page } = h;
    try {
      await twoReadsInFlight(page, reads);
      // The newer read succeeds first …
      await reads[2]?.answer({ ok: true, cursor: null });
      await until(async () => (await readsSettled(page)) === 1);
      await page.locator('.agents-row[data-agent="a1"]').waitFor();
      // … then the older one fails on its second page. Handled, and inert.
      await reads[1]?.answer({ ok: false });
      await until(async () => (await readsSettled(page)) === 2);
      assert.equal(await readsSettled(page), 2, 'the stale failure never settled');
      assert.equal(await page.locator('.agents-row[data-agent="a1"]').count(), 1);
      assert.equal(
        await page.locator('.agents > .state').count(),
        0,
        'a stale failure hid the list',
      );
    } finally {
      await h.close();
    }
  });

  void test('an older successful read never clears a newer failure', async () => {
    let reads: Awaited<ReturnType<typeof holdListReads>> = [];
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub, {
      before: async (p) => {
        reads = await holdListReads(p);
      },
    });
    const { page } = h;
    try {
      await twoReadsInFlight(page, reads);
      // The newer read fails first …
      await reads[2]?.answer({ ok: false });
      await until(async () => (await readsSettled(page)) === 1);
      await page.locator('.agents > .state').waitFor();
      // … then the older one completes. Its picture is stale: the failure stands.
      await reads[1]?.answer({ ok: true, cursor: null });
      await until(async () => (await readsSettled(page)) === 2);
      assert.equal(await readsSettled(page), 2, 'the stale success never settled');
      assert.equal(await page.locator('.agents > .state').count(), 1, 'a stale success cleared it');
      assert.equal(await page.locator('.agents-row').count(), 0, 'a stale list was shown');
    } finally {
      await h.close();
    }
  });

  void test('registration pending, tab left and come back: the agent is listed, nothing leaks', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      const held = await holdRequests(page);
      await toStep3(page, 'wandering bot');
      await press(page, 'Register and create its credential');
      await until(() => held.state.posts === 1);

      await page.locator('.page-tab', { hasText: 'Projects' }).click();
      await page.locator('[data-testid="agents-tab"]').waitFor({ state: 'detached' });
      // It answers while nobody is looking.
      held.releasePost();
      await until(() => api.agents.length === 1);

      await page.locator('.page-tab', { hasText: 'Agents' }).click();
      const row = page.locator('.agents-row[data-agent="a1"]');
      await row.waitFor({ timeout: 15_000 });
      assert.equal(await page.locator('.agents-wizard').count(), 0);
      assert.equal(await row.getByRole('button', { name: 'Rotate token' }).isDisabled(), false);
      assert.deepEqual(await secretSurvives(page, SECRET), []);
      assert.equal(await secretInReact(page, SECRET), 'clean');
    } finally {
      await h.close();
    }
  });

  void test('two wizard lifetimes: a late first answer leaves the second wizard alone', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      const held = await holdRequests(page);
      // The first wizard registers and is cancelled while its request is held.
      await toStep3(page, 'first bot');
      await press(page, 'Register and create its credential');
      await until(() => held.state.posts === 1);
      await press(page, 'Cancel', '.agents-wizard');
      await page.locator('.agents-wizard').waitFor({ state: 'detached' });

      // The second registers and gets its secret first: it reaches the server
      // first, so it is a1 and holds SECRET.
      await toStep3(page, 'second bot');
      await press(page, 'Register and create its credential');
      await page.locator('[data-testid="agent-secret"]').waitFor();
      assert.equal(await page.locator('[data-testid="agent-secret"]').innerText(), SECRET);

      // Now the first answers late, as a2, with a secret nobody may see.
      held.releasePost();
      const late = page.locator('.agents-row[data-agent="a2"]');
      await late.waitFor({ timeout: 15_000 });

      // The second wizard is untouched: same secret, its own row still held.
      assert.equal(await page.locator('[data-testid="agent-secret"]').innerText(), SECRET);
      const own = page.locator('.agents-row[data-agent="a1"]');
      assert.equal(await own.getByRole('button', { name: 'Rotate token' }).isDisabled(), true);
      // The late one is unlocked, announced, and its secret is nowhere.
      assert.equal(await late.getByRole('button', { name: 'Rotate token' }).isDisabled(), false);
      assert.match(await page.locator('.agents [role="status"]').innerText(), /first bot/);
      assert.deepEqual(await secretSurvives(page, laterSecret(2)), []);
      assert.equal(await secretInReact(page, laterSecret(2)), 'clean');
    } finally {
      await h.close();
    }
  });

  void test('leaving the tab mid-wizard takes the secret off the page and out of React', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await registerTo(page, 4);
      assert.equal(await secretInReact(page, SECRET), 'found');

      // Away, through the page's own tab — the wizard unmounts with no close.
      await page.locator('.page-tab', { hasText: 'Projects' }).click();
      await page.locator('[data-testid="agents-tab"]').waitFor({ state: 'detached' });
      assert.deepEqual(await secretSurvives(page, SECRET), [], 'the secret survived leaving');
      await until(async () => (await secretInReact(page, SECRET)) === 'clean');
      assert.equal(await secretInReact(page, SECRET), 'clean', 'React still holds the secret');

      // And back: nothing to see again.
      await page.locator('.page-tab', { hasText: 'Agents' }).click();
      await page.locator('.agents-row').waitFor();
      assert.equal(await page.locator('.agents-wizard').count(), 0);
      assert.deepEqual(await secretSurvives(page, SECRET), []);
    } finally {
      await h.close();
    }
  });

  void test('a credential replaced while verifying is never verified, and its secret leaves', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await registerTo(page, 5);
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'watching');

      // Rotated elsewhere (another tab, the CLI): the minted token is revoked,
      // and the replacement is used at once — the agent is stamped.
      const agent = api.agents[0];
      const minted = agent?.tokens[0];
      assert.ok(agent !== undefined && minted !== undefined);
      const now = Date.now();
      minted.revoked_at = now;
      agent.tokens.unshift({
        ...tokenRow('t-elsewhere', agent.display_name, now),
        last_used_at: now,
      });
      agent.last_seen_at = now;

      await until(
        async () =>
          (await page.locator('.agents-verify').getAttribute('data-state')) === 'replaced',
        15_000,
      );
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'replaced');
      assert.match(await page.locator('.agents-verify').innerText(), /rotated or revoked/);
      // The stale secret is no longer on the page, in the setup blocks either.
      assert.deepEqual(await secretSurvives(page, SECRET), [], 'the revoked secret is still shown');
      await press(page, 'Back', '.agents-wizard');
      await page.locator('.agents-setup').waitFor();
      assert.doesNotMatch(await page.locator('.agents-setup').innerText(), new RegExp(SECRET));
    } finally {
      await h.close();
    }
  });

  void test('Manage access: a failed project load shows a retry, and nothing can be saved', async () => {
    // Every read of the list fails until the test says otherwise — the
    // sidebar reads it too, so "the first call" is not this tab's.
    let failing = true;
    const api = agentsApi([existing()], {
      '/api/v1/projects': () => {
        return failing
          ? refuse(503, 'unavailable', 'Try again')
          : {
              data: [project('p1', 'ONR', 'OnRoute'), project('p2', 'SKY', 'Skynet')],
              next_cursor: null,
            };
      },
    });
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });
      await press(page, 'Manage access', '.agents-row');
      const panel = page.locator('.agents-panel');
      await panel.locator('.state').waitFor();
      assert.match(await panel.innerText(), /your projects/);
      assert.equal(await panel.getByRole('button', { name: 'Save access' }).isDisabled(), true);
      // The agent's grant is not reported as on a project the reader cannot see.
      assert.doesNotMatch(await panel.innerText(), /cannot see any more/);

      failing = false;
      await panel.locator('.state-retry').click();
      await panel.locator('input[name="grant-p2"]').first().waitFor();
      // Loaded, unchanged: still nothing to save.
      assert.equal(await panel.getByRole('button', { name: 'Save access' }).isDisabled(), true);
      assert.equal(h.calls.filter((c) => c.method === 'PUT').length, 0);
    } finally {
      await h.close();
    }
  });

  void test('Manage access while projects are still loading: Save stays off, no grants sent', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const api = agentsApi([existing()]);
    const h = await open('/developer?tab=agents', api.stub, {
      before: async (p) => {
        await p.route('**/api/v1/projects**', async (route) => {
          await gate;
          await route.fallback();
        });
      },
    });
    const { page } = h;
    try {
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });
      await press(page, 'Manage access', '.agents-row');
      const panel = page.locator('.agents-panel');
      await panel.waitFor();
      assert.equal(await panel.locator('.agents-grant').count(), 0);
      const save = panel.getByRole('button', { name: 'Save access' });
      assert.equal(await save.isDisabled(), true, 'Save is enabled before projects loaded');
      await save.click({ force: true });
      assert.equal(h.calls.filter((c) => c.method === 'PUT').length, 0);

      release();
      await panel.locator('input[name="grant-p2"]').first().waitFor();
      await panel.locator('input[name="grant-p2"]').nth(1).check();
      assert.equal(await save.isDisabled(), false);
    } finally {
      await h.close();
    }
  });

  void test('a stalled verify request ends at the deadline: no overlap, no pile-up', async () => {
    const api = agentsApi();
    const h = await open('/developer?tab=agents', api.stub, {
      before: async (p) => {
        await p.clock.install();
      },
    });
    const { page } = h;
    let asked = 0;
    let open_ = 0;
    let most = 0;
    const isPoll = (url: string, method: string) =>
      method === 'GET' && new URL(url).pathname === '/api/v1/agents/a1';
    try {
      await registerTo(page, 4);
      // From here every poll hangs: the server never answers.
      await page.route('**/api/v1/agents/a1', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        asked += 1;
        open_ += 1;
        most = Math.max(most, open_);
        // Never fulfilled; the page's own timeout abandons it.
      });
      page.on('requestfailed', (request) => {
        if (isPoll(request.url(), request.method())) open_ -= 1;
      });

      await press(page, 'Continue', '.agents-wizard');
      await page.locator('.agents-verify[data-state="watching"]').waitFor();
      // Three minutes and a bit, in steps, so each abandoned request settles
      // and the next is scheduled as it would be in real time.
      for (let t = 0; t < 185_000; t += 2_500) {
        await page.clock.runFor(2_500);
        await page.waitForTimeout(15);
      }
      await until(
        async () => (await page.locator('.agents-verify').getAttribute('data-state')) === 'spent',
      );
      assert.equal(await page.locator('.agents-verify').getAttribute('data-state'), 'spent');
      // 10s timeout + 5s spacing over 180s is twelve; the first fix's
      // interval would have fired 36 times and the original 1,001.
      assert.ok(asked >= 3, `only ${String(asked)} polls: the watch stopped retrying`);
      assert.ok(asked <= 14, `${String(asked)} polls in three minutes: it is piling up`);
      assert.equal(most, 1, 'two polls were in flight at once');

      // And it stays stopped.
      const after = asked;
      for (let t = 0; t < 30_000; t += 5_000) {
        await page.clock.runFor(5_000);
        await page.waitForTimeout(15);
      }
      assert.equal(asked, after, 'it kept polling after the deadline');
    } finally {
      await h.close();
    }
  });
});

void describe('one agent per harness per device (D-120, LAI-1001)', () => {
  /** An active Claude Code agent registered as "Polly" on Belka. */
  const polly = (over: Partial<AgentRow> = {}): AgentRow =>
    existing({
      display_name: 'Polly',
      harness: 'claude-code',
      device_label: 'Belka',
      tokens: [tokenRow('t-a1', 'Polly', 1_000)],
      ...over,
    });

  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 390],
  ] as const) {
    void test(`${theme} ${String(width)}: the list says the pair is taken; Go to it and Rotate its token`, async () => {
      const api = agentsApi([polly()]);
      const h = await open('/developer?tab=agents', api.stub);
      const { page } = h;
      try {
        await page.setViewportSize({ width, height: 900 });
        await setTheme(page, theme);
        const row = page.locator('.agents-row[data-agent="a1"]');
        await row.waitFor({ timeout: 20_000 });
        // The label is the pair, never the registered name.
        assert.equal(await row.locator('.agents-row-name').innerText(), 'Claude Code · Belka');
        assert.doesNotMatch(await row.innerText(), /Polly/);

        await press(page, '+ Register an agent');
        await typeDevice(page, ' belka ');
        const notice = page.locator('[data-agent-exists="a1"]');
        await notice.waitFor();
        assert.match(await notice.innerText(), /You already have Claude Code · Belka\./);
        assert.equal(
          await page
            .locator('.agents-wizard')
            .getByRole('button', { name: 'Continue' })
            .isDisabled(),
          true,
          'a taken pair can still be continued past',
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          0,
        );
        await shoot(page, `wizard-pair-taken-${theme}-${String(width)}`);

        // Go to it: the row comes into view and takes focus, by keyboard.
        await notice.getByRole('link', { name: 'Go to Claude Code · Belka' }).focus();
        await page.keyboard.press('Enter');
        await until(async () => row.evaluate((el) => el === document.activeElement));
        assert.equal(await row.evaluate((el) => el === document.activeElement), true);

        // Rotate its token: that row's own question, about that agent.
        await press(page, 'Rotate its token', '[data-agent-exists="a1"]');
        await confirmSettled(page);
        assert.match(
          await page.locator('[data-confirm-dialog]').innerText(),
          /Rotate Claude Code · Belka’s credential\?/,
        );
        await page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();
        await page.locator('[data-testid="agent-secret"]').waitFor();
        assert.deepEqual(
          h.calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body]),
          [['/api/v1/agents/a1/rotate-token', { token_id: 't-a1' }]],
          'something other than the one rotation was sent',
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('the server’s 409 names an agent the list missed: the notice, no secret, no row', async () => {
    // The list is a picture from before: the server knows the pair is taken.
    const api = agentsApi([polly({ device_label: 'Strelka' })], {
      '/api/v1/agents': (call: StubCall) =>
        call.method === 'POST'
          ? reply(409, {
              error: {
                code: 'conflict',
                message: 'You already have an active claude-code agent on this device ("Polly")',
                details: {
                  reason: 'agent_exists_for_harness_device',
                  agent_id: 'a1',
                  harness: 'claude-code',
                  device_label: 'belka',
                },
              },
            })
          : { data: api.agents, next_cursor: null },
    });
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.locator('.agents-row').waitFor({ timeout: 20_000 });
      await press(page, '+ Register an agent');
      await typeDevice(page, 'Belka');
      assert.equal(await page.locator('[data-agent-exists]').count(), 0);
      await press(page, 'Continue', '.agents-wizard');
      await page.locator('.agents-grant').first().waitFor();
      await press(page, 'Continue', '.agents-wizard');
      await press(page, 'Register and create its credential');

      const notice = page.locator('[data-agent-exists="a1"]');
      await notice.waitFor();
      // The label of the agent the server named, as the list knows it.
      assert.match(await notice.innerText(), /You already have Claude Code · Strelka\./);
      assert.equal(await notice.getByRole('link').getAttribute('href'), '#agent-a1');
      assert.equal(await notice.getByRole('button', { name: 'Rotate its token' }).count(), 1);
      assert.equal(await page.locator('[data-testid="agent-secret"]').count(), 0);
      assert.equal(await page.locator('.agents-wizard .agents-error').count(), 0);
      assert.equal(await page.locator('.agents-row').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('Cloud: the 24-hour rule is said first, asked for, and a refusal says it', async () => {
    let refuseNext = true;
    const plain = agentsApi([]);
    const base = plain.stub['/api/v1/agents'] as (call: StubCall) => unknown;
    const api = { ...plain, stub: { ...plain.stub } as Record<string, unknown> };
    api.stub['/api/v1/agents'] = (call: StubCall) => {
      if (call.method === 'POST' && refuseNext) {
        refuseNext = false;
        return reply(422, {
          error: {
            code: 'unprocessable',
            message: 'A cloud agent’s token may live at most 24 hours',
            details: { reason: 'cloud_token_expiry_too_long' },
          },
        });
      }
      return base(call);
    };
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await page.getByRole('button', { name: '+ Register an agent' }).waitFor({ timeout: 20_000 });
      await press(page, '+ Register an agent');
      await typeDevice(page, 'Cloud');
      await page.locator('[data-cloud-note]').waitFor();
      assert.match(await page.locator('[data-cloud-note]').innerText(), /expires within 24 hours/);
      assert.equal(
        await page.locator('[data-agent-label-preview]').innerText(),
        'Shown everywhere as Claude Code · Cloud',
      );
      await shoot(page, 'wizard-cloud-light-1440');
      await press(page, 'Continue', '.agents-wizard');
      await page.locator('.agents-grant').first().waitFor();
      await press(page, 'Continue', '.agents-wizard');
      assert.match(await page.locator('.agents-summary').innerText(), /Within 24 hours/);

      const before = Date.now();
      await press(page, 'Register and create its credential');
      const error = page.locator('.agents-wizard .agents-error');
      await error.waitFor();
      assert.match(await error.innerText(), /may live at most 24 hours/);
      await shoot(page, 'wizard-cloud-refused-light-1440');

      await press(page, 'Register and create its credential');
      await page.locator('[data-testid="agent-secret"]').waitFor();
      const sent = h.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/agents');
      assert.equal(sent.length, 2);
      for (const call of sent) {
        const body = call.body as { expires_at?: number; device_label: string };
        assert.equal(body.device_label, 'Cloud');
        assert.ok(typeof body.expires_at === 'number', 'no expiry was asked for');
        assert.ok(body.expires_at > before, 'the expiry is not in the future');
        assert.ok(body.expires_at <= Date.now() + 24 * 3_600_000, 'the expiry is past a day');
      }
    } finally {
      await h.close();
    }
  });

  void test('a Cloud agent whose token expired is rotated, never revoked and registered again', async () => {
    const expired = { ...tokenRow('t-a1', 'claude-code on Cloud', 1_000), expires_at: 2_000 };
    const api = agentsApi([
      existing({
        harness: 'claude-code',
        device_label: 'Cloud',
        display_name: 'claude-code on Cloud',
        tokens: [expired],
      }),
    ]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      const row = page.locator('.agents-row[data-agent="a1"]');
      await row.waitFor({ timeout: 20_000 });
      assert.match(await row.locator('[data-cloud-expired]').innerText(), /Rotate it/);
      assert.equal(await row.getByRole('button', { name: 'Rotate token' }).isDisabled(), false);

      // The wizard's notice on that pair offers the same rotation, not a revoke.
      await press(page, '+ Register an agent');
      await typeDevice(page, 'Cloud');
      const notice = page.locator('[data-agent-exists="a1"]');
      await notice.waitFor();
      assert.doesNotMatch(await notice.innerText(), /Revoke it/);
      await press(page, 'Rotate its token', '[data-agent-exists="a1"]');
      await confirmSettled(page);
      const before = Date.now();
      await page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();
      await page.locator('[data-testid="agent-secret"]').waitFor();
      const sent = h.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/rotate-token'));
      assert.equal(sent.length, 1);
      const body = sent[0]?.body as { token_id: string; expires_at?: number };
      assert.equal(body.token_id, 't-a1');
      assert.ok(typeof body.expires_at === 'number' && body.expires_at > before);
      assert.ok(body.expires_at <= Date.now() + 24 * 3_600_000, 'the new expiry is past a day');
    } finally {
      await h.close();
    }
  });
});
