/**
 * Auto-pickup and Ping on Developer access (LAI-1102, D-126), in a real
 * browser against a stubbed board — the owner's Tools tab from
 * `developer-v3-fixtures.ts`, with each tool's launcher set per test.
 *
 * - Every active tool row and the device row carry an *Auto-pickup* chip in
 *   the board's word: *on · 40 s*, *not heard since …*, *off* — never *on*
 *   for a report the board called `unknown`. Its reason is the chip's
 *   description.
 * - The tool panel's *Launcher* writes the reason out, and offers *Ping* only
 *   where the reader may ping the tool.
 * - Ping: *Waiting for …* in a polite live region, then the answer; a
 *   `pending` that comes back early keeps waiting; no answer within the wait,
 *   then expired; `429` and `404` in words. Focus never moves.
 * - 390 px, both themes: nothing scrolls sideways.
 *
 * Set `LAIKA_EVIDENCE_DIR` to also save screenshots, light and dark, at 1440
 * and 390 px.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import type { Launcher } from '../../src/api/capacity.ts';
import { NEVER_REPORTED, reported } from '../helpers/launcher.ts';
import {
  CLAUDE,
  CODEX,
  me,
  OMNIGENT,
  REVOKED,
  stub,
  unfold,
  type Agent,
} from './developer-v3-fixtures.ts';
import {
  closeBrowser,
  open,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type OpenOptions,
} from './harness.ts';

after(async () => {
  await closeBrowser();
});

const SECOND = 1000;
const MIN = 60 * SECOND;
const PAGE_NOW = Date.now();

const PROJECT = {
  id: 'p1',
  slug: 'laika',
  prefix: 'LAI',
  name: 'Laika',
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
  blocked_count: 0,
  member_count: 1,
  members: [],
  last_activity_at: 1,
};

const FULL = [{ project_id: 'p1', scope: 'full' }];

/** a1 on, granted here; a2 stale (the board says unknown); a3 never reported; r1 revoked. */
function tools(over: { a1?: Launcher; a2?: Launcher } = {}): Agent[] {
  return [
    { ...CLAUDE, grants: FULL, launcher: over.a1 ?? reported('on', Date.now() - 40 * SECOND) },
    { ...CODEX, launcher: over.a2 ?? reported('unknown', Date.now() - 6 * MIN) },
    { ...OMNIGENT, launcher: NEVER_REPORTED },
    REVOKED,
  ] as Agent[];
}

const ANSWER = {
  launcher: {
    state: 'on',
    auto_pickup: { work_requests: true, handoffs: true },
    running: 0,
    max_concurrent: 1,
  },
  harness_ready: { credential: true, argv: true, hooks: true },
  session_live: true,
  battery: { state: 'ok', percent: 64, plugged: true },
  memory: { state: 'normal' },
  cli_version: '0.4.2',
  answered_by: 'launcher',
};

const ping = (state: 'pending' | 'answered' | 'expired', expiresAt: number) => ({
  id: 'cp1',
  agent_id: 'a1',
  project_id: 'p1',
  task_id: null,
  state,
  requested_by: { user_id: 'u1', agent_id: null },
  created_at: expiresAt - MIN,
  expires_at: expiresAt,
  answered_at: state === 'answered' ? Date.now() - 2 * SECOND : null,
  answer: state === 'answered' ? ANSWER : null,
});

function board(routes: ApiStub = {}, launchers: { a1?: Launcher; a2?: Launcher } = {}): ApiStub {
  return stub({
    agents: tools(launchers),
    device: { launcher: reported('on', Date.now() - 40 * SECOND) },
    routes: {
      '/api/v1/projects': { data: [PROJECT], next_cursor: null },
      '/api/v1/agents/a1/capacity': {
        agent_id: 'a1',
        launcher: reported('on', Date.now() - 40 * SECOND),
        latest_answer: null,
        now: Date.now(),
      },
      ...routes,
    },
  });
}

const row = (page: Page, id: string) => page.locator(`.dv3-tool[data-agent="${id}"]`);
const panel = (page: Page) => page.locator('.side-panel[data-panel="tool"]');
const pingButton = (page: Page) =>
  panel(page).getByRole('button', { name: 'Ping Claude Code · Belka' });
const status = (page: Page) => panel(page).locator('.agent-ping-status');
/** The polite live region inside it: what is read out, and only on a change of outcome. */
const live = (page: Page) => panel(page).locator('.agent-ping-live');

async function openTools(routes: ApiStub = {}, options: OpenOptions = {}): Promise<Harness> {
  const h = await open('/developer?tab=tools', board(routes), options);
  await row(h.page, 'a1').locator('[data-auto-pickup]').waitFor({ timeout: 20_000 });
  return h;
}

/** Tool details for a1, its Launcher section — one folded row since LAI-1100 — open. */
async function openPanel(routes: ApiStub = {}, options: OpenOptions = {}): Promise<Harness> {
  const h = await open('/developer?tab=tools&agent=a1', board(routes), options);
  await unfold(panel(h.page), 'launcher');
  await pingButton(h.page).waitFor({ timeout: 10_000 });
  return h;
}

/** The chip's words, and its description through `aria-describedby`. */
async function chip(
  page: Page,
  id: string,
): Promise<{ state: string; word: string; reason: string }> {
  const at = row(page, id).locator('[data-auto-pickup]');
  const anchor = at.locator('.dv3-hint-anchor');
  const tip = (await anchor.getAttribute('aria-describedby')) ?? '';
  return {
    state: (await at.getAttribute('data-auto-pickup')) ?? '',
    word: (await anchor.innerText()).trim(),
    reason: ((await page.locator(`[id="${tip}"]`).textContent()) ?? '').trim(),
  };
}

const focusedOnPing = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

void describe('the Auto-pickup chip says the board’s word', () => {
  void test('Tools: on with its age, a stale report not heard since, never reported off', async () => {
    const h = await openTools();
    try {
      const on = await chip(h.page, 'a1');
      assert.equal(on.state, 'on');
      assert.match(on.word, /^Auto-pickup: on · \d+ s$/);
      assert.match(
        on.reason,
        /^The launcher on Belka reported just now that it is running\. It starts work requests and hand-offs /,
      );

      // Reported six minutes ago: the board says unknown, and so does the chip.
      const stale = await chip(h.page, 'a2');
      assert.equal(stale.state, 'unknown');
      assert.match(stale.word, /^Auto-pickup: not heard since \d{1,2}:\d{2} (AM|PM)$/);
      assert.doesNotMatch(stale.word, /: on\b/);
      assert.match(stale.reason, /stopped reporting over three minutes ago/);

      const never = await chip(h.page, 'a3');
      assert.equal(never.state, 'off');
      assert.equal(never.word, 'Auto-pickup: off');
      assert.match(never.reason, /`laika agent launcher enable` on that device turns it on\.$/);
    } finally {
      await h.close();
    }
  });

  void test('a stale report the reader’s clock calls fresh is still not on', async () => {
    // A second old, on a word the board already turned: the word decides.
    const fresh = await open(
      '/developer?tab=tools',
      board({}, { a2: reported('unknown', Date.now() - SECOND) }),
    );
    try {
      await row(fresh.page, 'a2').locator('[data-auto-pickup]').waitFor({ timeout: 20_000 });
      const w = await chip(fresh.page, 'a2');
      assert.equal(w.state, 'unknown');
      assert.match(w.word, /^Auto-pickup: not heard since /);
    } finally {
      await fresh.close();
    }
  });

  void test('Devices: the device’s own launcher, on the row and in its details', async () => {
    const h = await open('/developer?tab=devices&device=d1', board());
    try {
      const at = h.page.locator('.dv3-device[data-device="d1"] [data-auto-pickup]');
      await at.waitFor({ timeout: 20_000 });
      assert.equal(await at.getAttribute('data-auto-pickup'), 'on');
      assert.match((await at.innerText()).trim(), /^Auto-pickup: on · \d+ s$/);
      // In the device's Device section, one folded row since LAI-1100.
      await unfold(h.page.locator('.side-panel[data-panel="device"]'), 'device');
      const tile = h.page.locator('.side-panel [data-detail="auto-pickup"]');
      await tile.waitFor({ timeout: 10_000 });
      assert.match(await tile.innerText(), /Auto-pickup: on · \d+ s/);
      assert.match(await tile.innerText(), /The launcher on Belka reported/);
    } finally {
      await h.close();
    }
  });
});

void describe('Ping is offered only where the reader may ping', () => {
  void test('a granted tool: the Launcher section, its reason written out, and Ping', async () => {
    const h = await openPanel();
    try {
      const section = panel(h.page).locator('[data-launcher]');
      assert.equal(
        await section.locator('[data-auto-pickup]').getAttribute('data-auto-pickup'),
        'on',
      );
      assert.match(await section.innerText(), /It starts work requests and hand-offs/);
      assert.equal(await pingButton(h.page).count(), 1);
      // The live region is there before anything is said in it.
      assert.equal(await live(h.page).getAttribute('role'), 'status');
      assert.equal(await live(h.page).getAttribute('aria-live'), 'polite');
      assert.equal((await status(h.page).innerText()).trim(), '');
    } finally {
      await h.close();
    }
  });

  void test('a tool with no space it could be selected in: no Ping, and why', async () => {
    const h = await open('/developer?tab=tools&agent=a2', board());
    try {
      const section = await unfold(panel(h.page), 'launcher');
      assert.equal(await section.getAttribute('data-launcher'), '');
      await section.locator('[data-ping-none]').waitFor({ timeout: 10_000 });
      assert.equal(await section.getByRole('button', { name: /^Ping/ }).count(), 0);
      assert.equal(
        await section.locator('[data-ping-none]').getAttribute('data-ping-none'),
        'no-space',
      );
      assert.match(await section.innerText(), /has no space you could select it in/);
      assert.equal(
        h.calls.filter((c) => c.path.startsWith('/api/v1/agents/a2/capacity')).length,
        0,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('Ping is not offered to a viewer, and the note says so (review round 1)', () => {
  void test('an organisation viewer is told their role, not the tool’s access', async () => {
    const h = await open(
      '/developer?tab=tools&agent=a1',
      board({ '/api/v1/me': { ...me, org_role: 'viewer' } }),
    );
    try {
      const section = await unfold(panel(h.page), 'launcher');
      const none = section.locator('[data-ping-none]');
      await none.waitFor({ timeout: 10_000 });
      assert.equal(await none.getAttribute('data-ping-none'), 'viewer');
      assert.equal(
        (await none.innerText()).trim(),
        'Your role in this organisation is viewer, and pinging a tool is for members and above. You can still see Claude Code · Belka’s launcher above.',
      );
      assert.equal(await section.getByRole('button', { name: /^Ping/ }).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('Ping', () => {
  void test('waiting, then the answer; focus stays on Ping; presence is read again', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const h = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(201, { ping: ping('answered', Date.now() + MIN), created: true }),
    });
    try {
      await h.page.route('**/api/v1/agents/a1/capacity-pings', async (route) => {
        await held;
        await route.continue();
      });
      const reads = () => h.calls.filter((c) => c.path === '/api/v1/devices').length;
      const before = reads();
      await pingButton(h.page).focus();
      await h.page.keyboard.press('Enter');
      await until(async () => (await status(h.page).innerText()).includes('Waiting'));
      assert.equal((await status(h.page).innerText()).trim(), 'Waiting for Claude Code · Belka…');
      assert.equal(await pingButton(h.page).getAttribute('aria-disabled'), 'true');
      release();
      const facts = status(h.page).locator('[data-answer]');
      await facts.first().waitFor({ timeout: 10_000 });
      assert.deepEqual(
        await facts.evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.trim())),
        [
          'Online — its launcher answered',
          'Auto-pickup: on, for work requests and hand-offs',
          'Free runs: 1 of 1',
          'Tool ready to run',
          'Battery: 64 %, plugged in',
          'Memory: normal',
          'Laika CLI 0.4.2',
        ],
      );
      assert.match(await status(h.page).innerText(), /Claude Code · Belka answered \d+ s ago/);
      // The age moves on screen and is not read out (review round 1): it is
      // outside the live region, which holds the answer and no clock.
      const age = status(h.page).locator('.agent-ping-age');
      assert.match(await age.innerText(), /^Claude Code · Belka answered \d+ s ago$/);
      assert.equal(await age.evaluate((el) => el.closest('[aria-live]') === null), true);
      assert.doesNotMatch(await live(h.page).innerText(), /ago|\d+ s\b/);
      assert.match(await live(h.page).innerText(), /Claude Code · Belka answered\./);
      const post = h.calls.find((c) => c.method === 'POST');
      assert.deepEqual(post?.body, { project: 'laika', wait_ms: 8000 });
      assert.equal(await focusedOnPing(h.page), 'Ping Claude Code · Belka');
      await until(() => reads() > before);
      assert.ok(reads() > before, 'the list was not read again after the answer');
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a pending that comes back early keeps waiting, then shows the answer', async () => {
    // The board answers a repeat at once with the ping as it stands (LAI-1038).
    let gets = 0;
    const h = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(200, { ping: ping('pending', Date.now() + MIN), created: false }),
      '/api/v1/capacity-pings/cp1': () => {
        gets += 1;
        return { ping: ping(gets < 3 ? 'pending' : 'answered', Date.now() + MIN) };
      },
    });
    try {
      await h.page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { __pingStates: string[] }).__pingStates = seen;
        const box = document.querySelector('.side-panel .agent-ping');
        if (box === null) throw new Error('no ping');
        new MutationObserver(() => {
          seen.push(box.getAttribute('data-ping') ?? '');
        }).observe(box, { attributes: true, attributeFilter: ['data-ping'] });
      });
      await pingButton(h.page).click();
      await status(h.page).locator('[data-answer="online"]').waitFor({ timeout: 10_000 });
      const states = await h.page.evaluate(
        () => (window as unknown as { __pingStates: string[] }).__pingStates,
      );
      assert.ok(
        !states.includes('pending'),
        `it said no answer inside the wait: ${states.join(', ')}`,
      );
      assert.equal(states.at(-1), 'answered');
      assert.ok(gets >= 3, `asked again ${String(gets)} times`);
    } finally {
      await h.close();
    }
  });

  void test('no answer within the wait says so, then the ping expires', async () => {
    let expiresAt = 0;
    const h = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () => {
        expiresAt = Date.now() + 10 * SECOND;
        return reply(201, { ping: ping('pending', expiresAt), created: true });
      },
      '/api/v1/capacity-pings/cp1': () => ({
        ping: ping(Date.now() < expiresAt ? 'pending' : 'expired', expiresAt),
      }),
    });
    try {
      await pingButton(h.page).click();
      await until(async () => (await status(h.page).innerText()).includes('No answer'), 12_000);
      assert.equal(
        (await status(h.page).innerText()).trim(),
        'No answer within 8 s — the device may be offline or its launcher is off. Still listening until the ping expires.',
      );
      await until(async () => (await status(h.page).innerText()).includes('Expired'), 8_000);
      assert.match(await status(h.page).innerText(), /^Expired: no answer within a minute/);
      assert.equal(await pingButton(h.page).getAttribute('aria-disabled'), null);
    } finally {
      await h.close();
    }
  });

  void test('429 names the wait and holds the button; 404 says it cannot be pinged here', async () => {
    const limited = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(
          429,
          {
            error: {
              code: 'rate_limited',
              message: 'Too many capacity pings for this agent',
              details: { reason: 'capacity_ping_rate', retry_after_seconds: 12 },
            },
          },
          { 'Retry-After': '12' },
        ),
    });
    try {
      await pingButton(limited.page).click();
      await until(async () => (await status(limited.page).innerText()).includes('Too many'));
      assert.equal(
        (await status(limited.page).innerText()).trim(),
        'Too many pings for Claude Code · Belka — try again in 12 s.',
      );
      assert.equal(await pingButton(limited.page).getAttribute('aria-disabled'), 'true');
    } finally {
      await limited.close();
    }

    const refused = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(404, { error: { code: 'not_found', message: 'No such agent' } }),
    });
    try {
      await pingButton(refused.page).click();
      await until(async () => (await status(refused.page).innerText()).includes('cannot'));
      assert.match(
        await status(refused.page).innerText(),
        /^Claude Code · Belka cannot be pinged here: the board knows no agent of yours/,
      );
    } finally {
      await refused.close();
    }
  });

  void test('an earlier answer shows until the reader asks, called stale past five minutes', async () => {
    const old = { ...ping('answered', PAGE_NOW), answered_at: Date.now() - 12 * MIN };
    const h = await openPanel({
      '/api/v1/agents/a1/capacity': {
        agent_id: 'a1',
        launcher: reported('on', Date.now() - 40 * SECOND),
        latest_answer: old,
        now: Date.now(),
      },
    });
    try {
      await status(h.page).locator('[data-answer="online"]').waitFor({ timeout: 10_000 });
      assert.match(
        await status(h.page).innerText(),
        /^Stale: Claude Code · Belka answered 12 min ago/,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a background read that fails changes nothing (review round 1, B1)', () => {
  void test('B1: a failed presence re-read keeps the list, and focus on the row control', async () => {
    const h = await openTools();
    try {
      const details = h.page.locator('[data-details="tools:a1"]');
      await details.focus();
      let failed = 0;
      h.page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === '/api/v1/devices') failed += 1;
      });
      await h.page.route('**/api/v1/devices', (route) => route.abort('internetdisconnected'));
      // The window coming back is one of the re-read's triggers.
      await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await until(() => failed > 0);
      assert.ok(failed > 0, 'the background read never went out');
      // Long enough for an error state to take the list's place, if it were going to.
      const errorShown = () => h.page.locator('.state-error').isVisible();
      await until(errorShown, 1500);
      assert.equal(await errorShown(), false, 'a failed background read replaced the list');
      assert.equal(await row(h.page, 'a1').isVisible(), true);
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-details') ?? null),
        'tools:a1',
        'focus left the row control',
      );
      // The next read that works brings it up to date, and focus stays.
      await h.page.unroute('**/api/v1/devices');
      const reads = () => h.calls.filter((c) => c.path === '/api/v1/devices').length;
      const before = reads();
      await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await until(() => reads() > before);
      assert.ok(reads() > before, 'the next read did not go out');
      assert.equal(
        await h.page.evaluate(() => document.activeElement?.getAttribute('data-details') ?? null),
        'tools:a1',
      );
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

const pingState = (page: Page) => panel(page).locator('.agent-ping').getAttribute('data-ping');

/** Record each outcome the Ping takes, with when, from the moment this runs. */
async function recordOutcomes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: { state: string; at: number }[] = [];
    const start = Date.now();
    (window as unknown as { __ping: typeof seen }).__ping = seen;
    const box = document.querySelector('.side-panel .agent-ping');
    if (box === null) throw new Error('no ping');
    new MutationObserver(() => {
      seen.push({ state: box.getAttribute('data-ping') ?? '', at: Date.now() - start });
    }).observe(box, { attributes: true, attributeFilter: ['data-ping'] });
  });
}

const outcomes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ping: { state: string; at: number }[] }).__ping);

void describe('a check that fails (review round 1, B2)', () => {
  void test('B2: a check that fails inside the wait keeps waiting, says so, and the answer still arrives', async () => {
    let gets = 0;
    const h = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(200, { ping: ping('pending', Date.now() + MIN), created: false }),
      '/api/v1/capacity-pings/cp1': () => ({ ping: ping('answered', Date.now() + MIN) }),
    });
    try {
      // The first two checks fail; the board is back for the third.
      await h.page.route('**/api/v1/capacity-pings/cp1', async (route) => {
        gets += 1;
        if (gets <= 2) await route.abort('internetdisconnected');
        else await route.continue();
      });
      await recordOutcomes(h.page);
      await pingButton(h.page).click();
      await until(async () => (await live(h.page).innerText()).includes('did not answer'), 5_000);
      assert.equal(
        (await live(h.page).innerText()).trim(),
        'Waiting for Claude Code · Belka… The board did not answer the last check; asking again.',
      );
      await status(h.page).locator('[data-answer="online"]').waitFor({ timeout: 10_000 });
      const seen = await outcomes(h.page);
      assert.ok(
        !seen.some((o) => o.state === 'pending'),
        `it said no answer inside the wait: ${JSON.stringify(seen)}`,
      );
      assert.equal(seen.at(-1)?.state, 'answered');
      assert.ok(gets >= 3, `asked ${String(gets)} times`);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('B2: checks that keep failing retry until the ping expires, then say so, and Ping is offered again', async () => {
    let gets = 0;
    const h = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(201, { ping: ping('pending', Date.now() + 11 * SECOND), created: true }),
    });
    try {
      await h.page.route('**/api/v1/capacity-pings/cp1', async (route) => {
        gets += 1;
        await route.abort('internetdisconnected');
      });
      await recordOutcomes(h.page);
      await pingButton(h.page).click();
      // After the wait: no answer, the failing checks said, and Ping offered again.
      await until(
        async () => (await live(h.page).innerText()).includes('could not be reached'),
        12_000,
      );
      assert.match(
        (await live(h.page).innerText()).trim(),
        /^No answer within 8 s, and the board could not be reached to check again\. Retrying until the ping expires at \d{1,2}:\d{2}:\d{2} (AM|PM)\.$/,
      );
      assert.equal(await pingButton(h.page).getAttribute('aria-disabled'), null);
      const first = (await outcomes(h.page)).find((o) => o.state === 'pending');
      assert.ok(
        first !== undefined && first.at >= 7_500,
        `no answer said early: ${JSON.stringify(first)}`,
      );
      // Then at the expiry: expired, answered or not unknown.
      await until(async () => (await pingState(h.page)) === 'expired', 8_000);
      assert.equal(
        (await live(h.page).innerText()).trim(),
        'The ping expired while the board could not be reached, so whether Claude Code · Belka answered is unknown. Ping again to ask.',
      );
      assert.equal(await pingButton(h.page).getAttribute('aria-disabled'), null);
      assert.ok(gets >= 4, `retried ${String(gets)} times`);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

/** Record each different thing the live region says, in order, from the moment this runs. */
async function recordSaid(page: Page): Promise<void> {
  await page.evaluate(() => {
    const said: string[] = [];
    (window as unknown as { __said: string[] }).__said = said;
    const region = document.querySelector('.side-panel .agent-ping-live');
    if (region === null) throw new Error('no live region');
    new MutationObserver(() => {
      const text = (region.textContent ?? '').trim();
      if (said.at(-1) !== text) said.push(text);
    }).observe(region, { childList: true, subtree: true, characterData: true });
  });
}

const said = (page: Page) =>
  page.evaluate(() => (window as unknown as { __said: string[] }).__said);

const WAITING = 'Waiting for Claude Code · Belka…';
const WAITING_LOST =
  'Waiting for Claude Code · Belka… The board did not answer the last check; asking again.';

void describe('LAI-1108: Ping review follow-ups (PR #255)', () => {
  void test('LAI-1108 (k): an idle Ping is as tall as its button — no empty row under it', async () => {
    const h = await openPanel();
    try {
      assert.equal(await pingState(h.page), 'idle');
      const box = await panel(h.page).locator('.agent-ping').boundingBox();
      const button = await pingButton(h.page).boundingBox();
      assert.ok(box !== null && button !== null, 'the Ping or its button is not drawn');
      assert.ok(
        Math.abs(box.height - button.height) <= 0.5,
        `the idle Ping is ${String(box.height)}px tall, its button ${String(button.height)}px`,
      );
      // The live region is still in the tree, ready before it fills.
      assert.equal(await live(h.page).getAttribute('aria-live'), 'polite');
    } finally {
      await h.close();
    }
  });

  void test('LAI-1108 (i): a check that never comes back is a failed check, and the answer still arrives', async () => {
    let gets = 0;
    let free: () => void = () => undefined;
    const hung = new Promise<void>((done) => {
      free = done;
    });
    const h = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(200, { ping: ping('pending', Date.now() + MIN), created: false }),
      '/api/v1/capacity-pings/cp1': () => ({ ping: ping('answered', Date.now() + MIN) }),
    });
    try {
      // The first check is never answered; the board is back for the next.
      await h.page.route('**/api/v1/capacity-pings/cp1', async (route) => {
        gets += 1;
        if (gets === 1) {
          await hung;
          await route.abort('failed').catch(() => undefined);
          return;
        }
        await route.continue();
      });
      await pingButton(h.page).click();
      // The first check goes out a second in and times out five later.
      await until(async () => (await live(h.page).innerText()).includes('did not answer'), 9_000);
      assert.equal((await live(h.page).innerText()).trim(), WAITING_LOST);
      await status(h.page).locator('[data-answer="online"]').waitFor({ timeout: 15_000 });
      assert.ok(gets >= 2, `asked ${String(gets)} times`);
      assert.equal(await pingButton(h.page).getAttribute('aria-disabled'), null);
    } finally {
      free();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('LAI-1108 (i): a ping the board never answers fails after the wait and a margin, and Ping is offered again', async () => {
    let free: () => void = () => undefined;
    const hung = new Promise<void>((done) => {
      free = done;
    });
    const h = await openPanel();
    try {
      await h.page.route('**/api/v1/agents/a1/capacity-pings', async (route) => {
        await hung;
        await route.abort('failed').catch(() => undefined);
      });
      const clicked = Date.now();
      await pingButton(h.page).click();
      await until(async () => (await live(h.page).innerText()).includes('failed'), 16_000);
      assert.equal(
        (await live(h.page).innerText()).trim(),
        'The ping failed: the board did not answer within 13 s. Ping again to ask.',
      );
      const after = Date.now() - clicked;
      assert.ok(after >= 12_500, `given up after ${String(after)} ms, before the wait and margin`);
      assert.equal(await pingButton(h.page).getAttribute('aria-disabled'), null);
    } finally {
      free();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('LAI-1108 (l): a board that flaps inside the wait is said lost once, not on every flap', async () => {
    let gets = 0;
    const h = await openPanel({
      '/api/v1/agents/a1/capacity-pings': () =>
        reply(200, { ping: ping('pending', Date.now() + MIN), created: false }),
      '/api/v1/capacity-pings/cp1': () => ({
        ping: ping(gets < 5 ? 'pending' : 'answered', Date.now() + MIN),
      }),
    });
    try {
      // Checks 1 and 3 fail, 2 and 4 find it still pending, 5 the answer:
      // all a second or so apart, inside the eight-second wait.
      await h.page.route('**/api/v1/capacity-pings/cp1', async (route) => {
        gets += 1;
        if (gets === 1 || gets === 3) await route.abort('internetdisconnected');
        else await route.continue();
      });
      await recordSaid(h.page);
      await pingButton(h.page).click();
      await status(h.page).locator('[data-answer="online"]').waitFor({ timeout: 12_000 });
      const lines = await said(h.page);
      assert.ok(gets >= 5, `asked ${String(gets)} times`);
      assert.deepEqual(lines.slice(0, 2), [WAITING, WAITING_LOST], JSON.stringify(lines));
      assert.equal(
        lines.filter((line) => line === WAITING_LOST).length,
        1,
        `the lost check was said again: ${JSON.stringify(lines)}`,
      );
      assert.ok(
        !lines.slice(2).includes(WAITING),
        `a recovered check was said inside the wait: ${JSON.stringify(lines)}`,
      );
      assert.match(lines.at(-1) ?? '', /Claude Code · Belka answered\./);
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

void describe('390 px, both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: chips and an answer stay on screen`, async () => {
      const h = await openPanel(
        {
          '/api/v1/agents/a1/capacity-pings': () =>
            reply(201, { ping: ping('answered', Date.now() + MIN), created: true }),
        },
        {
          before: async (page) => {
            await page.setViewportSize({ width: 390, height: 844 });
          },
        },
      );
      try {
        await setTheme(h.page, theme);
        await pingButton(h.page).click();
        await status(h.page).locator('[data-answer="cli"]').waitFor({ timeout: 10_000 });
        const wide = await h.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(wide <= 0, `the page scrolls sideways by ${String(wide)}px`);
        const over = await panel(h.page)
          .locator('[data-launcher]')
          .evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(over <= 0, `the Launcher section overflows by ${String(over)}px`);
      } finally {
        await h.close();
      }
    });
  }
});

const EVIDENCE = process.env.LAIKA_EVIDENCE_DIR;

/** Theme colours ease in; a screenshot taken mid-way shows neither theme. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => setTimeout(done, 600)));

void describe('evidence: Auto-pickup and Ping', { skip: EVIDENCE === undefined }, () => {
  void test('screenshots', async () => {
    const dir = EVIDENCE ?? '';
    mkdirSync(dir, { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      for (const width of [1440, 390] as const) {
        const tag = `${theme}-${String(width)}`;
        const options: OpenOptions = {
          before: async (page) => {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          },
        };
        const list = await openTools({}, options);
        try {
          await setTheme(list.page, theme);
          await settled(list.page);
          await list.page.screenshot({
            path: join(dir, `tools-auto-pickup-${tag}.png`),
            fullPage: true,
          });
          await row(list.page, 'a2').locator('.dv3-hint-anchor').last().focus();
          await until(() => row(list.page, 'a2').locator('[role="tooltip"]').last().isVisible());
          await list.page.screenshot({ path: join(dir, `tools-stale-reason-${tag}.png`) });
        } finally {
          await list.close();
        }
        const devices = await open('/developer?tab=devices&device=d1', board(), options);
        try {
          await unfold(devices.page.locator('.side-panel[data-panel="device"]'), 'device');
          await devices.page
            .locator('.side-panel [data-detail="auto-pickup"]')
            .waitFor({ timeout: 20_000 });
          await setTheme(devices.page, theme);
          await settled(devices.page);
          await devices.page.screenshot({ path: join(dir, `device-auto-pickup-${tag}.png`) });
        } finally {
          await devices.close();
        }
        const details = await openPanel(
          {
            '/api/v1/agents/a1/capacity-pings': () =>
              reply(201, { ping: ping('answered', Date.now() + MIN), created: true }),
          },
          options,
        );
        try {
          await setTheme(details.page, theme);
          await pingButton(details.page).click();
          await status(details.page).locator('[data-answer="cli"]').waitFor({ timeout: 10_000 });
          await settled(details.page);
          await details.page.screenshot({ path: join(dir, `tool-ping-answer-${tag}.png`) });
        } finally {
          await details.close();
        }
      }
    }
  });
});
