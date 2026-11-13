/**
 * Cards, chips, avatars and status, against the worst realistic board
 * (LAI-1206).
 *
 * The board was drawn against kind data: short titles, two tags, a one-word
 * device. This world is the opposite, and every value in it is one a real
 * space produces — a 120-character run with no break opportunity, eight tags
 * in four scripts, a double-barrelled Polish name, a name that starts with an
 * emoji, a device label as macOS writes it, a task with nothing optional set.
 *
 * Asserted on the rendered page: nothing escapes its card at 390 or 1440 in
 * either theme; the sprint and the effort are told apart by shape, face and
 * mark rather than colour; the attribution line says what the fixture's
 * fields say and nothing else; and the card's states are each a different
 * drawing. `LAIKA_SHOTS=<dir>` saves the worst-case board for review.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { asServed, closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';
import { tipText } from './tooltip-probe.ts';

const SHOTS = process.env.LAIKA_SHOTS;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

const ALEKSANDRA = 'Aleksandra Wiśniewska-Kowalczyk';
const JO = '🦊 Jo';
const DEVICE = 'aleksandras-macbook-pro-16-inch-2024.local';
const UNBREAKABLE =
  'Supercalifragilisticexpialidocious_receipt_ocr_pipeline_retry_backoff_exponential_jitter_v2_final_FINAL';

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  agents_allowed: true,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const AGENT = {
  id: 'ag-codex',
  display_name: null,
  harness: 'codex',
  device_label: DEVICE,
  status: 'active',
  owner: { id: 'u1', name: ALEKSANDRA },
};

const SPRINT = {
  id: 's2',
  project_id: 'laika-core',
  name: 'Sprint 2 — Receipts and the long tail of currency rounding',
  goal: null,
  status: 'active',
  starts_on: NOW - 3 * DAY,
  ends_on: NOW + 11 * DAY,
  created_at: 2,
  updated_at: 2,
};

const task = (over: Record<string, unknown>) =>
  asServed({
    id: 'x',
    key: 'LC-9',
    number: 9,
    project_id: 'laika-core',
    title: 'A task',
    description_md: '',
    acceptance_md: '',
    status: 'todo',
    priority: 'p2',
    position: null,
    assignee_id: null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    sprint_id: 's2',
    tags: [],
    ready: false,
    comment_count: 0,
    blocked_by: [],
    blocks: [],
    discovered_from: null,
    parent_task_id: null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    send_back: null,
    started_at: null,
    completed_at: null,
    created_at: NOW - 5 * HOUR,
    updated_at: NOW - HOUR,
    size: null,
    selected_agent: null,
    claim: null,
    ...over,
  });

/** The worst card: everything at once, an agent working on it. */
const W1 = task({
  id: 'w1',
  key: 'LC-1284',
  number: 1284,
  title:
    'Zażółć gęślą jaźń: przenieść rozpoznawanie paragonów do zadania w tle, z ponawianiem, limitem czasu i raportem dla księgowości — także dla faktur w trzech walutach',
  status: 'in_progress',
  priority: 'p1',
  assignee_id: 'u1',
  created_via: 'mcp',
  created_by: 'u2',
  tags: [
    'backend',
    'frontend',
    'security',
    'performance-regression-q3',
    'दस्तावेज़',
    'ドキュメント',
    '🔥 hotfix',
    'a11y',
  ],
  size: { level: 'S', overridden: false, estimate: 'S', minutes: { low: 30, high: 60 } },
  selected_agent: AGENT,
  claim: {
    generation: 2,
    state: 'active',
    agent_id: 'ag-codex',
    session_id: '01SESSION',
    lease_expires_at: NOW + HOUR,
    last_heartbeat_at: NOW,
    heartbeat_age_ms: 0,
    connection: 'live',
    suspect_after_ms: 10 * 60_000,
    device_label: DEVICE,
    harness: 'codex',
    harness_version: null,
    model: null,
  },
  started_at: NOW - 2 * HOUR,
  due_on: Date.UTC(2026, 0, 5),
  blocked_by: ['w2'],
});

/** An unbreakable title and an emoji-first person. */
const W2 = task({
  id: 'w2',
  key: 'LC-2',
  number: 2,
  title: UNBREAKABLE,
  assignee_id: 'u3',
  size: { level: 'XL', overridden: true, estimate: 'M', minutes: { low: 120, high: 480 } },
});

/** Nothing optional set — but an agent picked, with nobody accountable. */
const W3 = task({
  id: 'w3',
  key: 'LC-3',
  number: 3,
  title: 'Jo',
  priority: 'p3',
  selected_agent: AGENT,
});

function stub(): ApiStub {
  const tasks = [W1, W2, W3];
  const perTask: Record<string, unknown> = Object.fromEntries(
    tasks.flatMap((t): [string, unknown][] => {
      const id = String(t.id);
      return [
        [`/api/v1/tasks/${id}`, t],
        [`/api/v1/tasks/${id}/comments`, { data: [], next_cursor: null }],
        [`/api/v1/tasks/${id}/watchers`, { watchers: [] }],
        [`/api/v1/projects/laika-core/activity?task_id=${id}`, { data: [], next_cursor: null }],
        [
          `/api/v1/projects/laika-core/tasks?parent=${id}&limit=200`,
          { data: [], next_cursor: null },
        ],
      ];
    }),
  );
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'aleksandra@example.com',
      name: ALEKSANDRA,
      org_role: 'member',
      is_active: true,
      memberships: [{ project_id: 'laika-core', role: 'lead' }],
    },
    '/api/v1/projects': {
      data: [
        {
          ...CORE,
          task_counts: { backlog: 0, todo: 2, in_progress: 1, review: 0, done: 0, cancelled: 0 },
          blocked_count: 1,
          member_count: 3,
          members: [],
          last_activity_at: 2,
        },
      ],
      next_cursor: null,
    },
    '/api/v1/projects/laika-core': CORE,
    '/api/v1/projects/laika-core/tasks?limit=200': { data: tasks, next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [
        { user_id: 'u1', name: ALEKSANDRA, email: 'a@example.com', role: 'lead', created_at: 1 },
        {
          user_id: 'u2',
          name: 'Bartholomew Fitzgerald',
          email: 'b@example.com',
          role: 'member',
          created_at: 1,
        },
        { user_id: 'u3', name: JO, email: 'jo@example.com', role: 'member', created_at: 1 },
      ],
    },
    '/api/v1/projects/laika-core/mentionable': { users: [] },
    '/api/v1/projects/laika-core/sprints': { data: [SPRINT], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
    '/api/v1/agents': { data: [], next_cursor: null },
    ...perTask,
    '/api/v1/org': {
      id: 'o',
      name: 'Borealis Labs',
      presence_enabled: false,
      created_at: 1,
      updated_at: 1,
    },
    '/api/v1/presence': { enabled: false, present: [] },
  };
}

void after(async () => {
  await closeBrowser();
});

const card = (page: Page, id: string) => page.locator(`article.card[data-task-id="${id}"]`);

async function boardReady(page: Page): Promise<void> {
  await card(page, 'w3').waitFor({ timeout: 20_000 });
  await until(async () => (await page.locator('article.card').count()) === 3);
  assert.equal(await page.locator('article.card').count(), 3, 'all three cards must render');
}

/** Everything inside a card that is drawn past the card's own edge. */
function escapes(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const c of document.querySelectorAll<HTMLElement>('article.card')) {
      const box = c.getBoundingClientRect();
      for (const el of c.querySelectorAll<HTMLElement>('*')) {
        if (el.closest('.visually-hidden') !== null) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > box.right + 0.5 || r.left < box.left - 0.5) {
          out.push(`${c.dataset.taskId ?? '?'}: ${el.tagName}.${el.className.toString()}`);
        }
      }
    }
    return out;
  });
}

/**
 * Whether the agent badge on the worst card's avatar is shown whole, by
 * hit-testing its outer corner after scrolling it into view
 * (`elementFromPoint` sees only the viewport). A property check: removing the
 * `.card-who` exemption in `board.css` does not turn this red today.
 */
async function badgeWhole(page: Page): Promise<boolean> {
  const bot = card(page, 'w1').locator('.card-bot');
  assert.equal(await bot.count(), 1, 'positive control — the badge is drawn');
  await bot.scrollIntoViewIfNeeded();
  return bot.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.right - 1.5, r.bottom - 1.5);
    return hit !== null && (hit === el || el.contains(hit));
  });
}

void describe('the worst realistic board (break-ui)', () => {
  void test('nothing escapes a card, titles clamp at two lines, at 390, 768 and 1440 in both themes', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await boardReady(h.page);
      // At the harness's own viewport too, not only the two widths below.
      assert.equal(await badgeWhole(h.page), true, 'default viewport: the badge is clipped');
      for (const width of [1440, 768, 390]) {
        await h.page.setViewportSize({ width, height: 900 });
        for (const theme of ['Dark', 'Light']) {
          await setTheme(h.page, theme);
          await boardReady(h.page);
          const label = `${String(width)} ${theme}`;

          // The positive control: the worst card really does carry it all.
          assert.equal(await card(h.page, 'w1').locator('.card-tag').count(), 8, label);
          assert.equal(await card(h.page, 'w1').locator('.card-blocked').count(), 1, label);
          assert.equal(await card(h.page, 'w1').locator('.card-due-overdue').count(), 1, label);

          assert.deepEqual(await escapes(h.page), [], `${label}: drawn past the card's edge`);

          assert.equal(
            await badgeWhole(h.page),
            true,
            `${label}: the agent badge's corner is clipped`,
          );
          const disc = await card(h.page, 'w1')
            .locator('.card-avatar')
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              return Math.abs(r.width - r.height) < 0.5 && r.width > 0;
            });
          assert.equal(disc, true, `${label}: the avatar is not a square disc`);

          const titles = await h.page.locator('.card-title').evaluateAll((els) =>
            els.map((el) => {
              const lh = parseFloat(getComputedStyle(el).lineHeight);
              return {
                lines: Math.round(el.getBoundingClientRect().height / lh),
                wide: el.scrollWidth > el.clientWidth + 1,
              };
            }),
          );
          for (const t of titles) {
            assert.ok(t.lines <= 2, `${label}: a title runs to ${String(t.lines)} lines`);
            assert.equal(t.wide, false, `${label}: a title overflows sideways`);
          }

          const sideways = await h.page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          );
          assert.equal(sideways, false, `${label}: the page scrolls sideways`);

          if (SHOTS !== undefined) {
            mkdirSync(SHOTS, { recursive: true });
            await h.page.screenshot({
              path: join(SHOTS, `worst-board-${String(width)}-${theme.toLowerCase()}.png`),
            });
          }
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('a name that starts with an emoji keeps the whole emoji in its avatar', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await boardReady(h.page);
      const avatar = card(h.page, 'w2').locator('.card-avatar');
      assert.equal(await avatar.getAttribute('aria-label'), `Accountable: ${JO}`);
      assert.equal((await avatar.innerText()).trim(), '🦊J');
    } finally {
      await h.close();
    }
  });
});

void describe('chips are told apart without colour (WCAG 1.4.1)', () => {
  void test('the sprint S2 and the effort S differ in shape, face and mark, and say so aloud', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await boardReady(h.page);
      const sprint = card(h.page, 'w1').locator('.card-sprint');
      const size = card(h.page, 'w1').locator('.card-size');
      assert.equal(await sprint.count(), 1, 'positive control: the sprint chip');
      assert.equal(await size.count(), 1, 'positive control: the effort chip');

      const look = (l: typeof sprint) =>
        l.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            radius: parseFloat(s.borderTopLeftRadius),
            font: s.fontFamily,
            height: el.getBoundingClientRect().height,
            glyph: el.querySelector('.chip-glyph')?.getAttribute('class') ?? '',
          };
        });
      const a = await look(sprint);
      const b = await look(size);
      assert.ok(
        a.radius > b.radius + 4,
        `same corners: ${String(a.radius)} vs ${String(b.radius)}`,
      );
      assert.notEqual(a.font, b.font, 'same typeface');
      assert.match(a.glyph, /chip-cycle/, 'the sprint carries no iteration mark');
      assert.match(b.glyph, /chip-bars/, 'the effort carries no meter');
      // One box: the same height for both.
      assert.ok(Math.abs(a.height - b.height) < 0.5, 'the two chips are different heights');

      // And with colour taken away entirely, the words still differ.
      assert.equal(
        await sprint.locator('[role="img"]').getAttribute('aria-label'),
        'Active sprint',
      );
      assert.equal(await size.locator('[role="img"]').getAttribute('aria-label'), 'Effort');
      assert.equal((await size.innerText()).trim(), 'S');
    } finally {
      await h.close();
    }
  });

  void test('overdue is a drawn warning mark, not a red date alone', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await boardReady(h.page);
      const due = card(h.page, 'w1').locator('.card-due');
      assert.equal(await due.locator('svg[data-mark="alert"]').count(), 1);
      assert.equal(await due.locator('[role="img"]').getAttribute('aria-label'), 'Overdue');
    } finally {
      await h.close();
    }
  });
});

void describe('attribution, from the fixture’s fields (four lanes)', () => {
  void test('the working agent is named once, for the person accountable', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await boardReady(h.page);
      const w1 = card(h.page, 'w1');
      const line = w1.locator('.card-attribution');
      assert.equal(await line.getAttribute('data-lane'), 'executing');
      assert.equal((await line.locator('.agent-chip').innerText()).trim(), `Codex · ${DEVICE}`);
      assert.equal(
        (await line.locator('.card-attribution-relation').innerText()).trim(),
        `for ${ALEKSANDRA}`,
      );
      assert.equal(
        (await line.locator('.visually-hidden').last().innerText()).trim(),
        `Agent doing the work: Codex · ${DEVICE}, for ${ALEKSANDRA}.`,
      );
      // The state line says the state; it no longer repeats the agent.
      assert.equal((await w1.locator('[data-exec-state]').innerText()).trim(), 'Working');
      // The device appears once on the card's visible text, not twice.
      const visible = await w1.evaluate((el) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.visually-hidden').forEach((n) => {
          n.remove();
        });
        return clone.textContent ?? '';
      });
      assert.equal(
        visible.split(DEVICE).length - 1,
        1,
        `the device is named more than once: ${visible}`,
      );
      assert.doesNotMatch(await w1.innerText(), /assigned/i);
    } finally {
      await h.close();
    }
  });

  void test('a picked agent with nobody accountable says only "requested"', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await boardReady(h.page);
      const line = card(h.page, 'w3').locator('.card-attribution');
      assert.equal(await line.getAttribute('data-lane'), 'requested');
      assert.equal(
        (await line.locator('.card-attribution-relation').innerText()).trim(),
        'requested',
      );
      assert.equal(await card(h.page, 'w3').locator('.card-avatar').count(), 0);
      // No agent: no line at all.
      assert.equal(await card(h.page, 'w2').locator('.card-attribution').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('the agent badge names the creator, not the assignee', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await boardReady(h.page);
      assert.equal(
        await tipText(card(h.page, 'w1').locator('.card-bot')),
        'Created through an agent by Bartholomew Fitzgerald',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('card states, each its own drawing', () => {
  void test('focus, selected and dragging', async () => {
    const h = await open('/board?project=laika-core&task=w2', stub());
    try {
      await boardReady(h.page);
      const w2 = card(h.page, 'w2');
      await until(async () => (await w2.getAttribute('class'))?.includes('card-selected') === true);
      assert.ok((await w2.getAttribute('class'))?.includes('card-selected'), 'not selected');
      assert.equal(await card(h.page, 'w1').getAttribute('data-selected'), null);
      const ring = await w2.evaluate((el) => getComputedStyle(el).boxShadow);
      assert.match(ring, /0px 0px 0px 1px/, `no selected edge: ${ring}`);

      await h.page.keyboard.press('Escape');
      await until(() => !h.page.url().includes('task='));
      assert.ok(!h.page.url().includes('task='), 'the drawer did not close');

      // Keyboard focus draws a ring outside the card.
      const w1 = card(h.page, 'w1');
      await w1.locator('.card-open').focus();
      await h.page.keyboard.press('Shift+Tab');
      await h.page.keyboard.press('Tab');
      await until(
        async () => (await w1.evaluate((el) => getComputedStyle(el).outlineStyle)) === 'solid',
      );
      assert.equal(await w1.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');

      // Dragging: a dashed, faint ghost until the drag ends.
      await w1.dispatchEvent('dragstart', {
        dataTransfer: await h.page.evaluateHandle(() => new DataTransfer()),
      });
      await until(async () => (await w1.getAttribute('class'))?.includes('card-dragging') === true);
      const ghost = await w1.evaluate((el) => {
        const s = getComputedStyle(el);
        return { border: s.borderTopStyle, opacity: s.opacity };
      });
      assert.equal(ghost.border, 'dashed');
      await w1.dispatchEvent('dragend');
      await until(
        async () => (await w1.getAttribute('class'))?.includes('card-dragging') === false,
      );
      assert.ok(!(await w1.getAttribute('class'))?.includes('card-dragging'), 'stuck dragging');
    } finally {
      await h.close();
    }
  });

  void test('reduced motion: the card does not transition', async () => {
    const h = await open('/board?project=laika-core', stub(), {
      before: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
      },
    });
    try {
      await boardReady(h.page);
      const duration = await card(h.page, 'w1').evaluate(
        (el) => getComputedStyle(el).transitionDuration,
      );
      assert.match(duration, /^0s(, 0s)*$/, `the card still transitions: ${duration}`);
    } finally {
      await h.close();
    }
  });
});
