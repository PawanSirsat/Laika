/**
 * *Save checkpoints automatically* on the Agents tab (LAI-1007, D-115 item 2;
 * API by LAI-545), in a real browser against a stubbed `/api/v1/agents` and a
 * stateful `/checkpoint-consent` that answers as `services/checkpoints.ts`.
 *
 * Two properties carry the task, each asserted against what would break it:
 *
 * - **The switch shows the server's answer, never a guess.** The `PUT` is
 *   held in the browser while the test reads the switch: still off, saying
 *   *Saving…*. Only the answer turns it on, and a refusal leaves it off with
 *   the server's reason beside it.
 * - **Only the owner sees it.** An agent of somebody else's in the list gets
 *   no switch, and its consent is never even asked for.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page, Route } from 'playwright';
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

interface Consent {
  given: boolean;
  given_by_user_id: string | null;
  given_at: number | null;
  withdrawn_at: number | null;
}

const NEVER: Consent = { given: false, given_by_user_id: null, given_at: null, withdrawn_at: null };

function agentRow(id: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id,
    owner_user_id: 'u1',
    owner_display_name: 'Ada Lovelace',
    display_name: `agent ${id}`,
    harness: 'claude-code',
    device_label: `device-${id}`,
    status: 'active',
    grants: [{ project_id: 'p1', scope: 'full' }],
    tokens: [
      {
        id: `t-${id}`,
        name: `agent ${id}`,
        prefix: `lai_${id}`,
        scope: 'full',
        project_ids: null,
        last_used_at: null,
        last_mcp_at: null,
        last_client: null,
        last_client_name: null,
        expires_at: null,
        revoked_at: null,
        created_at: now - 60_000,
      },
    ],
    created_at: now - 60_000,
    revoked_at: null,
    last_seen_at: null,
    ...over,
  };
}

type Agent = ReturnType<typeof agentRow>;

/** `/agents` and each agent's consent, kept as the server keeps them. */
function consentApi(agents: Agent[], consents: Record<string, Consent> = {}) {
  const held: Record<string, Consent> = { ...consents };
  let seq = 0;
  const stub: Record<string, unknown> = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [PROJECT], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/presence': { enabled: true, present: [] },
    '/api/v1/agents/devices': { data: [] },
    '/api/v1/agents': (call: StubCall) => {
      if (call.method === 'POST') {
        seq += 1;
        const body = call.body as { harness: string; device_label: string | null };
        const agent = agentRow(`n${String(seq)}`, {
          harness: body.harness,
          device_label: body.device_label,
        });
        agents.unshift(agent);
        return reply(201, {
          agent,
          token: agent.tokens[0],
          secret: 'lai_ConsentTestSecret_ZZ9',
        });
      }
      return { data: agents, next_cursor: null };
    },
  };
  for (const id of [...agents.map((a) => a.id), 'n1']) {
    stub[`/api/v1/agents/${id}`] = () =>
      agents.find((a) => a.id === id) ?? refuse(404, 'agent_not_found', 'No agent with that id');
    stub[`/api/v1/agents/${id}/checkpoint-consent`] = (call: StubCall) => {
      const agent = agents.find((a) => a.id === id);
      // Another person's agent is no agent at all (§4.63).
      if (agent?.owner_user_id !== ME.id) {
        return refuse(404, 'agent_not_found', 'No agent with that id');
      }
      const now = Date.now();
      const was = held[id] ?? NEVER;
      if (call.method === 'PUT') {
        held[id] = { given: true, given_by_user_id: ME.id, given_at: now, withdrawn_at: null };
      } else if (call.method === 'DELETE' && was.given) {
        held[id] = { ...was, given: false, withdrawn_at: now };
      }
      return held[id] ?? NEVER;
    };
  }
  return { stub: stub as ApiStub, held };
}

const SHOTS = process.env.LAIKA_SHOTS;
async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
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

const switchOf = (page: Page, agentId: string) =>
  page.locator(`[data-consent="${agentId}"]`).getByRole('switch');

const stateOf = (page: Page, agentId: string) =>
  page.locator(`[data-consent="${agentId}"] [data-consent-state]`);

/** Hold one method's consent request in the browser until `release` is called. */
async function holdConsent(page: Page, method: string) {
  let release: (() => void) | undefined;
  let arrived = false;
  await page.route('**/api/v1/agents/*/checkpoint-consent', async (route: Route) => {
    if (route.request().method() !== method) {
      await route.fallback();
      return;
    }
    arrived = true;
    await new Promise<void>((done) => {
      release = done;
    });
    await route.fallback();
  });
  return {
    arrived: () => arrived,
    release: () => {
      release?.();
    },
  };
}

void describe('Save checkpoints automatically (LAI-1007)', () => {
  void test('the owner turns it on and off from the keyboard; it moves only on the server’s answer', async () => {
    const api = consentApi([agentRow('a1')]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      const control = switchOf(page, 'a1');
      await control.waitFor({ timeout: 20_000 });
      // A real labelled switch: its name says what it allows, its state is announced.
      assert.equal(await control.getAttribute('aria-checked'), 'false');
      assert.equal(
        await page.getByRole('switch', { name: 'Save checkpoints automatically' }).count(),
        1,
      );
      assert.match(
        await page.locator('[data-consent="a1"]').innerText(),
        /push work in progress to the task’s branch[\s\S]*never to master/,
      );
      assert.equal(await stateOf(page, 'a1').innerText(), 'Off — never given.');

      const hold = await holdConsent(page, 'PUT');
      await control.focus();
      await page.keyboard.press('Space');
      await until(() => hold.arrived());
      assert.ok(hold.arrived(), 'Space sent no PUT');
      // Held: the switch has not guessed. It says it is saving, and is still off.
      await page.locator('[data-consent="a1"] .agents-consent-saving').waitFor();
      assert.equal(await control.getAttribute('aria-checked'), 'false');
      assert.equal(await stateOf(page, 'a1').getAttribute('data-consent-state'), 'off');
      // A second press while saving sends nothing more.
      await page.keyboard.press('Space');
      hold.release();

      await until(async () => (await control.getAttribute('aria-checked')) === 'true');
      assert.equal(await control.getAttribute('aria-checked'), 'true');
      assert.match(await stateOf(page, 'a1').innerText(), /^On — given .+ by you\.$/);
      assert.equal(
        h.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/checkpoint-consent')).length,
        1,
      );
      // Focus stayed on the switch through the save.
      assert.equal(await control.evaluate((el) => el === document.activeElement), true);
      await shoot(page, 'desktop-light-on');

      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.keyboard.press('Enter');
      await until(async () => (await control.getAttribute('aria-checked')) === 'false');
      assert.equal(await control.getAttribute('aria-checked'), 'false');
      assert.match(await stateOf(page, 'a1').innerText(), /^Off — withdrawn .+\.$/);
      assert.equal(
        h.calls.filter((c) => c.method === 'DELETE' && c.path.endsWith('/checkpoint-consent'))
          .length,
        1,
      );
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a refusal is said inline with the server’s reason, and the switch stays where it was', async () => {
    const api = consentApi([agentRow('a1')]);
    const h = await open('/developer?tab=agents', {
      ...api.stub,
      '/api/v1/agents/a1/checkpoint-consent': (call: StubCall) =>
        call.method === 'GET'
          ? NEVER
          : refuse(403, 'forbidden', 'Consent is given from a signed-in session, not a token'),
    });
    const { page } = h;
    try {
      const control = switchOf(page, 'a1');
      await control.waitFor({ timeout: 20_000 });
      await control.focus();
      await page.keyboard.press('Space');
      const refusal = page.locator('[data-consent="a1"] [data-consent-refusal]');
      await refusal.waitFor();
      assert.equal(await refusal.getAttribute('role'), 'alert');
      assert.equal(
        await refusal.innerText(),
        'Consent is given from a signed-in session, not a token',
      );
      assert.equal(await control.getAttribute('aria-checked'), 'false');
      assert.equal(await stateOf(page, 'a1').innerText(), 'Off — never given.');
    } finally {
      await h.close();
    }
  });

  void test('another person’s agent shows no switch, and its consent is never asked for', async () => {
    const api = consentApi([
      agentRow('a1'),
      agentRow('a2', { owner_user_id: 'u2', owner_display_name: 'Grace Hopper' }),
    ]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      await switchOf(page, 'a1').waitFor({ timeout: 20_000 });
      await page.locator('[data-agent="a2"]').waitFor();
      assert.equal(await page.locator('[data-agent="a2"] [data-consent]').count(), 0);
      assert.equal(await page.locator('[data-agent="a2"] [role="switch"]').count(), 0);
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/agents/a2/checkpoint-consent').length,
        0,
      );
    } finally {
      await h.close();
    }
  });

  void test('a revoked agent shows its last state, read only', async () => {
    const api = consentApi(
      [agentRow('a1', { status: 'revoked', revoked_at: Date.now() - 1_000 })],
      {
        a1: {
          given: true,
          given_by_user_id: 'u1',
          given_at: Date.now() - 86_400_000,
          withdrawn_at: null,
        },
      },
    );
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    try {
      const control = switchOf(page, 'a1');
      await control.waitFor({ timeout: 20_000 });
      assert.equal(await control.getAttribute('aria-checked'), 'true');
      assert.equal(await control.isDisabled(), true);
      assert.equal(
        await page.locator('[data-consent="a1"] [data-consent-locked]').innerText(),
        'Read only: this agent is revoked.',
      );
      await control.click({ force: true });
      await page.keyboard.press('Space');
      assert.equal(
        h.calls.filter((c) => c.method !== 'GET' && c.path.endsWith('/checkpoint-consent')).length,
        0,
      );
    } finally {
      await h.close();
    }
  });

  void test('both themes, 390 px and desktop, fit without sideways scrolling', async () => {
    const api = consentApi([agentRow('a1'), agentRow('a3', { status: 'revoked' })], {
      a1: {
        given: true,
        given_by_user_id: 'u1',
        given_at: Date.now() - 3_600_000,
        withdrawn_at: null,
      },
    });
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    try {
      await switchOf(page, 'a1').waitFor({ timeout: 20_000 });
      await switchOf(page, 'a3').waitFor();
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setTheme(page, theme);
        for (const width of [1280, 390]) {
          // Laid out afresh at each width, so the theme menu's dispatch on a
          // phone leaves no off-canvas sidebar over the shot.
          await page.setViewportSize({ width, height: 900 });
          await page.reload();
          await switchOf(page, 'a3').waitFor({ timeout: 20_000 });
          assert.ok(
            (await overflow()) <= 0,
            `${theme} at ${String(width)}px scrolls sideways by ${String(await overflow())}px`,
          );
          await shoot(page, `${width === 390 ? 'mobile' : 'desktop'}-${theme}`);
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('the wizard’s last step says so, and its link focuses the new agent’s switch', async () => {
    const api = consentApi([]);
    const h = await open('/developer?tab=agents', api.stub);
    const { page } = h;
    const press = async (name: string, scope = 'body') => {
      const button = page.locator(scope).getByRole('button', { name, exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
    };
    try {
      await page.getByRole('button', { name: '+ Register an agent' }).waitFor({ timeout: 20_000 });
      await press('+ Register an agent');
      const field = page.locator('.agents-wizard input').first();
      await field.waitFor();
      await field.focus();
      await page.keyboard.type('laptop-1');
      await press('Continue', '.agents-wizard');
      await page.locator('.agents-grant').first().waitFor();
      await press('Continue', '.agents-wizard');
      await press('Register and create its credential');
      await page.locator('[data-testid="agent-secret"]').waitFor();
      await press('Continue', '.agents-wizard');
      await page.locator('.agents-setup .conn-setup').first().waitFor();
      await press('Continue', '.agents-wizard');

      const pointer = page.locator('.agents-verify [data-consent-pointer]');
      await pointer.waitFor();
      assert.match(await pointer.innerText(), /Automatic checkpoints stay off until you turn on/);
      await switchOf(page, 'n1').waitFor();
      const link = pointer.getByRole('link', { name: 'Save checkpoints automatically' });
      await link.focus();
      await page.keyboard.press('Enter');
      await until(() => switchOf(page, 'n1').evaluate((el) => el === document.activeElement));
      assert.equal(
        await switchOf(page, 'n1').evaluate((el) => el === document.activeElement),
        true,
      );
      await shoot(page, 'wizard-step-5');
    } finally {
      await h.close();
    }
  });
});
