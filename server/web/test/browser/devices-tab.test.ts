/**
 * Developer access → Agents → *Your devices* (LAI-591; API by LAI-590), in a
 * real browser against a stubbed `/api/v1/agents/devices` that keeps state the
 * way LAI-590's routes do.
 *
 * What carries the task, each asserted against the thing that would break it:
 *
 * - **Grouped from the answer.** Every device name, count and time on screen is
 *   the stub's; the fixtures use names no default could produce.
 * - **Not recognised** is a word, and *This is mine* clears it only once the
 *   server confirmed — a refused confirm leaves it standing.
 * - **Revoke device** names every agent it will end before anything happens;
 *   cancel sends nothing; a refusal keeps the question open with the server's
 *   words and changes nothing; confirm shows the agents revoked without a
 *   reload of the page.
 * - **Keyboard**: the dialog takes focus, holds it, and gives it back.
 * - **Both themes**, 1440 and 390, nothing scrolling sideways. Screenshots go
 *   to `$LAIKA_SHOTS` when it is set — the PR's evidence.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  defaultPermissions,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { confirmSettled } from './confirm.ts';

const SHOTS = process.env.LAIKA_SHOTS;

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  org_role: 'member',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'member' }],
};

const MIN = 60_000;
const HOUR = 60 * MIN;

interface AgentRow {
  id: string;
  owner_user_id: string;
  display_name: string;
  harness: string;
  device_label: string | null;
  status: 'active' | 'revoked';
  grants: { project_id: string; scope: string }[];
  tokens: {
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
  }[];
  created_at: number;
  revoked_at: number | null;
  last_seen_at: number | null;
}

function agentRow(
  id: string,
  harness: string,
  device: string | null,
  over: Partial<AgentRow> = {},
): AgentRow {
  const revoked = over.status === 'revoked';
  return {
    id,
    owner_user_id: 'u1',
    display_name: `${harness} on ${device ?? 'nothing'}`,
    harness,
    device_label: device,
    status: 'active',
    grants: [],
    tokens: [
      {
        id: `t-${id}`,
        name: id,
        prefix: `lai_${id}`,
        scope: 'full',
        project_ids: null,
        last_used_at: null,
        last_mcp_at: null,
        last_client: null,
        last_client_name: null,
        expires_at: null,
        revoked_at: revoked ? 5 : null,
        created_at: 1,
      },
    ],
    created_at: 1,
    revoked_at: revoked ? 5 : null,
    last_seen_at: null,
    ...over,
  };
}

/** The seed: a recognised laptop, an unrecognised one, and one with nothing left running. */
function seed(now: number): AgentRow[] {
  return [
    agentRow('k1', 'omnigent', 'Kestrel-Mk2', { last_seen_at: now - 2 * MIN }),
    agentRow('k2', 'claude-code', 'Kestrel-Mk2', { last_seen_at: now - 9 * MIN }),
    agentRow('k3', 'codex', 'Kestrel-Mk2', { status: 'revoked', last_seen_at: now - 30 * HOUR }),
    agentRow('q1', 'cursor', 'Quokka Box', { last_seen_at: now - 3 * HOUR }),
    agentRow('o1', 'zed', 'Old Tablet', { status: 'revoked', last_seen_at: null }),
  ];
}

/** `GET /agents/devices` and its two writes, answering as `services/agents.ts` does. */
function devicesApi(
  agents: AgentRow[],
  recognised: Set<string>,
  over: Partial<Record<string, unknown>> = {},
) {
  const key = (label: string | null): string => (label ?? '').trim().toLowerCase();
  const list = () => {
    const groups = new Map<string, Record<string, unknown> & { agents: AgentRow[] }>();
    for (const a of agents) {
      const k = key(a.device_label);
      let g = groups.get(k);
      if (g === undefined) {
        g = {
          device_label: k === '' ? null : k,
          display_name: k === '' ? 'Unnamed device' : (a.device_label ?? '').trim(),
          recognised: recognised.has(k),
          last_seen_at: null,
          active_count: 0,
          revoked_count: 0,
          agents: [],
        };
        groups.set(k, g);
      }
      if (a.last_seen_at !== null) {
        g.last_seen_at = Math.max((g.last_seen_at as number | null) ?? 0, a.last_seen_at);
      }
      if (a.status === 'active') (g.active_count as number) += 1;
      else (g.revoked_count as number) += 1;
      g.agents.push(a);
    }
    return { data: [...groups.values()] };
  };
  const stub: Record<string, unknown> = {
    '/api/v1/me': ME,
    '/api/v1/projects': { data: [], next_cursor: null },
    '/api/v1/tokens': { data: [], next_cursor: null },
    '/api/v1/agents': () => ({ data: agents, next_cursor: null }),
    '/api/v1/agents/devices': list,
    '/api/v1/agents/devices/confirm': (call: StubCall) => {
      const k = key((call.body as { device_label: string | null }).device_label);
      if (!agents.some((a) => key(a.device_label) === k)) {
        return refuse(404, 'not_found', 'Unknown device');
      }
      recognised.add(k);
      return { device_label: k === '' ? null : k, recognised: true };
    },
    '/api/v1/agents/devices/revoke': (call: StubCall) => {
      const k = key((call.body as { device_label: string | null }).device_label);
      const on = agents.filter((a) => key(a.device_label) === k);
      if (on.length === 0) return refuse(404, 'not_found', 'Unknown device');
      const ids: string[] = [];
      for (const a of on) {
        if (a.status !== 'active') continue;
        a.status = 'revoked';
        a.revoked_at = Date.now();
        for (const t of a.tokens) t.revoked_at ??= a.revoked_at;
        ids.push(a.id);
      }
      return { revoked_agent_ids: ids };
    },
    ...over,
  };
  return stub as ApiStub;
}

after(async () => {
  await closeBrowser();
});

async function openAt(stub: ApiStub, width = 1440): Promise<Harness> {
  return open('/developer?tab=agents', stub, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
}

const section = (page: Page) => page.locator('[data-testid="devices-section"]');
const group = (page: Page, label: string) => page.locator(`.devices-group[data-device="${label}"]`);

function posts(h: Harness, path: string): StubCall[] {
  return h.calls.filter((c) => c.method === 'POST' && c.path === path);
}

async function sideways(page: Page): Promise<number> {
  return page.evaluate(() => {
    const roots = [
      document.documentElement,
      ...document.querySelectorAll<HTMLElement>('main, .page'),
    ];
    return Math.max(...roots.map((el) => el.scrollWidth - el.clientWidth));
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  const size = page.viewportSize();
  if (size === null) throw new Error('no viewport');
  const tall = await section(page).evaluate((el) => el.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, tall + 400) });
  await section(page).screenshot({ path: join(SHOTS, `${name}.png`) });
  await page.setViewportSize(size);
}

void describe('Your devices', () => {
  void test('groups by device from the answer: names, counts, last seen and the badge', async () => {
    const now = Date.now();
    const h = await openAt(devicesApi(seed(now), new Set(['kestrel-mk2', 'old tablet'])));
    const { page } = h;
    try {
      await group(page, 'kestrel-mk2').waitFor({ timeout: 20_000 });
      assert.deepEqual(await page.locator('.devices-group .devices-name').allInnerTexts(), [
        'Kestrel-Mk2',
        'Quokka Box',
        'Old Tablet',
      ]);

      const kestrel = group(page, 'kestrel-mk2');
      assert.match(await kestrel.locator('.devices-facts').innerText(), /2 active · 1 revoked/);
      // The newest agent on the device, not the first or the oldest.
      assert.equal(await kestrel.locator('time').innerText(), '2 min ago');
      assert.deepEqual(await kestrel.locator('.devices-agent-name').allInnerTexts(), [
        'Omnigent · Kestrel-Mk2',
        'Claude Code · Kestrel-Mk2',
        'Codex · Kestrel-Mk2',
      ]);
      assert.equal(await kestrel.locator('[data-unrecognised]').count(), 0);

      const quokka = group(page, 'quokka box');
      assert.equal(await quokka.locator('[data-unrecognised]').innerText(), 'Not recognised');
      assert.match(await quokka.locator('.devices-facts').innerText(), /3 h ago[\s\S]*1 active/);
      assert.equal(await quokka.getByRole('button', { name: /This is mine/ }).count(), 1);

      // Nothing running: one muted row, closed, with no revoke to offer.
      const old = group(page, 'old tablet');
      assert.equal(await old.evaluate((el) => el.classList.contains('devices-group-muted')), true);
      assert.equal(
        await old.locator('details').evaluate((d) => (d as HTMLDetailsElement).open),
        false,
      );
      assert.match(
        await old.locator('summary').innerText(),
        /Never seen[\s\S]*0 active · 1 revoked/,
      );
      assert.equal(await old.getByRole('button', { name: /Revoke device/ }).count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the exact time shows on keyboard focus as well as in the title', async () => {
    const now = Date.now();
    const h = await openAt(devicesApi(seed(now), new Set(['kestrel-mk2'])));
    const { page } = h;
    try {
      const time = group(page, 'kestrel-mk2').locator('time');
      await time.waitFor({ timeout: 20_000 });
      const exact = group(page, 'kestrel-mk2').locator('.devices-seen-exact');
      assert.equal(await exact.isVisible(), false);
      const full = await time.getAttribute('title');
      assert.ok(
        full !== null && /\d{4}, \d/.test(full),
        `title is the exact time: ${String(full)}`,
      );

      // Reached by Tab, from the control before it.
      await page.locator('.devices-intro').click();
      for (let i = 0; i < 20; i += 1) {
        await page.keyboard.press('Tab');
        if (await time.evaluate((el) => el === document.activeElement)) break;
      }
      assert.equal(await time.evaluate((el) => el === document.activeElement), true);
      assert.equal(await exact.isVisible(), true);
      assert.equal(await exact.innerText(), full);
    } finally {
      await h.close();
    }
  });

  void test('This is mine clears the badge only after the server confirmed', async () => {
    const now = Date.now();
    const recognised = new Set<string>();
    const h = await openAt(devicesApi(seed(now), recognised));
    const { page } = h;
    try {
      const quokka = group(page, 'quokka box');
      await quokka.waitFor({ timeout: 20_000 });
      const mine = quokka.getByRole('button', { name: 'This is mine: Quokka Box' });
      await mine.focus();
      await page.keyboard.press('Enter');
      await quokka.locator('[data-unrecognised]').waitFor({ state: 'detached' });
      assert.deepEqual(
        posts(h, '/api/v1/agents/devices/confirm').map((c) => c.body),
        [{ device_label: 'quokka box' }],
      );
      assert.equal(recognised.has('quokka box'), true);
      // The other unrecognised device is still unrecognised.
      assert.equal(await group(page, 'kestrel-mk2').locator('[data-unrecognised]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('a refused confirm keeps the badge and says why', async () => {
    const now = Date.now();
    const h = await openAt(
      devicesApi(seed(now), new Set(), {
        '/api/v1/agents/devices/confirm': refuse(
          403,
          'forbidden',
          'Only a signed-in session can do that',
        ),
      }),
    );
    const { page } = h;
    try {
      const quokka = group(page, 'quokka box');
      await quokka.getByRole('button', { name: /This is mine/ }).click({ timeout: 20_000 });
      await quokka.locator('[role="alert"]').waitFor();
      assert.match(await quokka.locator('[role="alert"]').innerText(), /signed-in session/);
      assert.equal(await quokka.locator('[data-unrecognised]').innerText(), 'Not recognised');
    } finally {
      await h.close();
    }
  });

  void test('revoke: names every agent, cancel sends nothing and gives focus back', async () => {
    const now = Date.now();
    const h = await openAt(devicesApi(seed(now), new Set(['kestrel-mk2'])));
    const { page } = h;
    try {
      const button = group(page, 'kestrel-mk2').getByRole('button', {
        name: 'Revoke device: Kestrel-Mk2',
      });
      await button.waitFor({ timeout: 20_000 });
      await button.focus();
      await page.keyboard.press('Enter');
      await confirmSettled(page);
      const dialog = page.locator('[data-confirm-dialog]');
      assert.match(
        await dialog.locator('.confirm-title').innerText(),
        /Revoke every agent on Kestrel-Mk2\?/,
      );
      // Every active agent by name — and not the one already revoked.
      assert.deepEqual(await dialog.locator('[data-revoke-targets] li').allInnerTexts(), [
        'Omnigent · Kestrel-Mk2',
        'Claude Code · Kestrel-Mk2',
      ]);
      assert.match(await dialog.innerText(), /running sessions end/);
      assert.match(await dialog.locator('[data-confirm-ok] button').innerText(), /Revoke 2 agents/);

      // Focus starts inside and stays inside: Tab from the last control wraps.
      const inside = () =>
        page.evaluate(() =>
          Boolean(
            document.querySelector('[data-confirm-dialog]')?.contains(document.activeElement),
          ),
        );
      assert.equal(await inside(), true);
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await inside(), true, `Tab ${String(i + 1)} left the dialog`);
      }

      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await button.evaluate((el) => el === document.activeElement), true);
      assert.equal(posts(h, '/api/v1/agents/devices/revoke').length, 0);
      assert.match(
        await group(page, 'kestrel-mk2').locator('.devices-facts').innerText(),
        /2 active/,
      );
    } finally {
      await h.close();
    }
  });

  void test('revoke: a refusal stays in the dialog and changes nothing', async () => {
    const now = Date.now();
    const agents = seed(now);
    const h = await openAt(
      devicesApi(agents, new Set(['kestrel-mk2']), {
        '/api/v1/agents/devices/revoke': refuse(500, 'internal', 'The database is busy'),
      }),
    );
    const { page } = h;
    try {
      await group(page, 'kestrel-mk2')
        .getByRole('button', { name: /Revoke device/ })
        .click({ timeout: 20_000 });
      await confirmSettled(page);
      const dialog = page.locator('[data-confirm-dialog]');
      await dialog.locator('[data-confirm-ok] button').click();
      await dialog.locator('[data-confirm-error]').waitFor();
      assert.match(await dialog.locator('[data-confirm-error]').innerText(), /database is busy/);
      assert.equal(posts(h, '/api/v1/agents/devices/revoke').length, 1);

      await dialog.locator('[data-confirm-cancel] button').click();
      await dialog.waitFor({ state: 'detached' });
      const kestrel = group(page, 'kestrel-mk2');
      assert.match(await kestrel.locator('.devices-facts').innerText(), /2 active · 1 revoked/);
      assert.deepEqual(
        await kestrel
          .locator('.devices-agent')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-state'))),
        ['connected', 'connected', 'revoked'],
      );
    } finally {
      await h.close();
    }
  });

  void test('revoke: confirm ends every agent on the seeded device, others untouched', async () => {
    const now = Date.now();
    const agents = seed(now);
    const h = await openAt(devicesApi(agents, new Set(['kestrel-mk2'])));
    const { page } = h;
    try {
      const loads = () =>
        h.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/agents').length;
      await group(page, 'kestrel-mk2')
        .getByRole('button', { name: /Revoke device/ })
        .click({ timeout: 20_000 });
      await confirmSettled(page);
      const before = loads();
      await page.locator('[data-confirm-dialog] [data-confirm-ok] button').click();
      await page.locator('[data-confirm-dialog]').waitFor({ state: 'detached' });

      assert.deepEqual(
        posts(h, '/api/v1/agents/devices/revoke').map((c) => c.body),
        [{ device_label: 'kestrel-mk2' }],
      );
      const kestrel = group(page, 'kestrel-mk2');
      await until(
        async () => (await kestrel.locator('.devices-agent[data-state="revoked"]').count()) === 3,
      );
      assert.match(await kestrel.locator('summary').innerText(), /0 active · 3 revoked/);
      // The button went with the revoke, so focus lands on the device's name.
      assert.equal(
        await kestrel.locator('.devices-name').evaluate((el) => el === document.activeElement),
        true,
      );
      // Another device is untouched, and the tab's own list was read again.
      assert.match(
        await group(page, 'quokka box').locator('.devices-facts').innerText(),
        /1 active/,
      );
      await until(() => loads() > before);
      assert.equal(agents.find((a) => a.id === 'q1')?.status, 'active');
    } finally {
      await h.close();
    }
  });

  void test('loading, empty and error states', async () => {
    const empty = await openAt(devicesApi([], new Set()));
    try {
      await section(empty.page).locator('.state-empty').waitFor({ timeout: 20_000 });
      assert.match(await section(empty.page).innerText(), /No devices yet/);
    } finally {
      await empty.close();
    }

    const broken = await openAt(
      devicesApi(seed(Date.now()), new Set(), {
        '/api/v1/agents/devices': refuse(500, 'internal', 'boom'),
      }),
    );
    try {
      await section(broken.page).locator('.state-error').waitFor({ timeout: 20_000 });
      assert.equal(
        await section(broken.page).getByRole('button', { name: 'Try again' }).count(),
        1,
      );
      assert.equal(await section(broken.page).locator('.devices-group').count(), 0);
    } finally {
      await broken.close();
    }
  });

  void test('without agent.manage_own the list reads and offers no action', async () => {
    const perms = defaultPermissions(ME) as { me: { actions: string[] } };
    perms.me.actions = perms.me.actions.filter((a) => a !== 'agent.manage_own');
    const h = await openAt(
      devicesApi(seed(Date.now()), new Set(), { '/api/v1/permissions': perms }),
    );
    try {
      await group(h.page, 'quokka box').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.devices-group [data-unrecognised]').count(), 3);
      assert.equal(
        await section(h.page)
          .getByRole('button', { name: /This is mine|Revoke device/ })
          .count(),
        0,
      );
    } finally {
      await h.close();
    }
  });

  void test('both themes, 1440 and 390: nothing scrolls sideways', async () => {
    for (const width of [1440, 390]) {
      const h = await openAt(
        devicesApi(seed(Date.now()), new Set(['kestrel-mk2', 'old tablet'])),
        width,
      );
      const { page } = h;
      try {
        await group(page, 'quokka box').waitFor({ timeout: 20_000 });
        for (const theme of ['light', 'dark']) {
          await setTheme(page, theme);
          assert.equal(await sideways(page), 0, `${theme} at ${String(width)} scrolls sideways`);
          await shoot(page, `devices-${theme}-${String(width)}`);

          await group(page, 'kestrel-mk2')
            .getByRole('button', { name: /Revoke device/ })
            .click();
          await confirmSettled(page);
          assert.equal(await sideways(page), 0, `dialog, ${theme} at ${String(width)}`);
          if (SHOTS !== undefined) {
            await page.screenshot({
              path: join(SHOTS, `devices-revoke-${theme}-${String(width)}.png`),
            });
          }
          await page.keyboard.press('Escape');
          await page.locator('[data-confirm-dialog]').waitFor({ state: 'detached' });
        }
      } finally {
        await h.close();
      }
    }
  });
});
