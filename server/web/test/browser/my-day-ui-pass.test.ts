/**
 * My day's UI pass (LAI-1215), in a real browser on the pinned clock
 * (LAI-954): a draft reads differently from a confirmed entry and from a gap,
 * to the eye and to a screen reader; the day's primary action leads a toolbar
 * that keeps to one row with a timer running; a block's actions are reached by
 * keyboard; tracking off still leads somewhere; the phone's bar fits at 390px;
 * and the worst day — long titles, thirty entries, overlapping drafts, one
 * spanning midnight — overflows nothing. No CSP violation anywhere.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, setTheme, type ApiStub, type Harness } from './harness.ts';
import { NOW, open } from './my-day-clock.ts';
import { ATLAS, at, SETTINGS, TODAY, viewOf, weekData, weekStub } from './my-day-week.ts';
import { strictCsp } from './tooltip-probe.ts';

after(async () => {
  await closeBrowser();
});

async function violations(p: Page): Promise<string[]> {
  return p.evaluate(() => window.__cspViolations ?? []);
}

/** A timer running for 25 minutes, so the toolbar carries its widest control. */
const RUNNING = {
  started_at: NOW - 25 * 60_000,
  resumed_at: NOW - 25 * 60_000,
  paused_at: null,
  accumulated_ms: 0,
  tz: 'UTC',
  task: null,
  kind: 'thinking',
  title: 'Keyboard steps',
};

type Day = ReturnType<typeof weekData>;

function onStub(data: Day = weekData()): ApiStub {
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as object),
    timer: RUNNING,
  });
  return routes;
}

const LONG =
  'Make the webhook retry policy back off exponentially across every integration and surface each failed delivery in the activity feed with its reason';

/** The worst day: an overlapping draft, an entry from yesterday 23:00, thirty more, every third titled at length. */
function worstStub(): ApiStub {
  const data = weekData();
  const today = data.get(TODAY);
  assert.ok(today !== undefined, 'the week fixture has no today');
  const card = (i: number) => ({
    id: `tw${String(i)}`,
    key: `LAI-${String(1000 + i)}`,
    title: i % 3 === 0 ? LONG : `Short ${String(i)}`,
  });
  const first = today.drafts[0];
  const base = today.entries[1];
  assert.ok(first !== undefined && base !== undefined, 'the week fixture changed shape');
  const drafts = [
    ...today.drafts,
    {
      ...first,
      id: 'dov',
      started_at: at(TODAY, 9, 0),
      ended_at: at(TODAY, 10, 30),
      minutes: 90,
      task: card(0),
      project: ATLAS,
    },
  ];
  const entries = [
    ...today.entries,
    {
      ...base,
      id: 'emid',
      started_at: at(TODAY, -1, 0),
      ended_at: at(TODAY, 1, 0),
      minutes: 120,
      task: card(3),
      project: ATLAS,
    },
  ];
  for (let i = 0; i < 30; i += 1) {
    const s = at(TODAY, 16, 0) + i * 12 * 60_000;
    entries.push({
      ...base,
      id: `ew${String(i)}`,
      started_at: s,
      ended_at: s + 10 * 60_000,
      minutes: 10,
      task: card(i),
      project: ATLAS,
    });
  }
  data.set(TODAY, { drafts, entries } as never);
  return onStub(data);
}

/** Tracking off for the org (LAI-1191): the open work, nothing drafted. */
function offStub(): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as object),
    settings: { ...SETTINGS, org_mode: 'off', drafting: false },
  });
  routes['/api/v1/org'] = { id: 'o1', name: 'Kvelld' };
  const midnight = Date.parse(`${TODAY}T00:00:00Z`);
  const task = (id: string, title: string, status: string, due: number | null) => ({
    id,
    key: `LAI-${id.slice(1)}`,
    title,
    status,
    status_id: `st-${status}`,
    status_name: status === 'todo' ? 'To do' : 'In progress',
    project_id: 'p1',
    number: Number(id.slice(1)),
    priority: 'p2',
    assignee_id: 'u1',
    sprint_id: null,
    due_on: due,
    blocked_by: [],
    blocks: [],
    updated_at: 1,
  });
  const lists: Record<string, unknown[]> = {
    in_progress: [task('t31', 'Wire the exporter', 'in_progress', null)],
    review: [],
    todo: [task('t33', 'Two days late', 'todo', midnight - 2 * 86_400_000)],
    backlog: [],
  };
  for (const [status, list] of Object.entries(lists)) {
    routes[`/api/v1/tasks?assignee=u1&status=${status}`] = { data: list, next_cursor: null };
  }
  return routes;
}

async function openDay(stub: ApiStub, width: number, ready: string): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub, {
    before: async (p) => {
      await p.setViewportSize({ width, height: 900 });
      await strictCsp(p);
    },
  });
  try {
    await h.page.locator(ready).first().waitFor({ timeout: 20_000 });
  } catch (error) {
    await h.close();
    throw error;
  }
  return h;
}

/** Nothing on the page is wider than the window. */
async function pageOverflow(p: Page): Promise<number> {
  return p.evaluate(() => {
    const doc = document.documentElement;
    let worst = doc.scrollWidth - window.innerWidth;
    for (const el of document.querySelectorAll<HTMLElement>('.myday-page, .shell-head')) {
      worst = Math.max(worst, el.scrollWidth - el.clientWidth);
    }
    return worst;
  });
}

void describe('My day, the UI pass (LAI-1215)', () => {
  void test('a draft is outlined in the accent, a confirmed entry solid, a gap empty — and each says which', async () => {
    const h = await openDay(onStub(), 1440, '[data-myday-ready]');
    try {
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(h.page, theme);
        const look = async (selector: string) => {
          const el = h.page.locator(selector).first();
          assert.equal(await el.count(), 1, `${selector} is not on the Timeline`);
          return el.evaluate((node) => {
            const s = getComputedStyle(node);
            return {
              style: s.borderTopStyle,
              border: s.borderTopColor,
              background: s.backgroundColor,
            };
          });
        };
        const accent = await h.page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--accent)';
          document.body.append(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        });
        const draft = await look('.dayline-drafted:not(.dayline-needs-card) [data-block-select]');
        const confirmed = await look('.dayline-confirmed [data-block-select]');
        const gap = await look('.dayline-gap');
        assert.equal(draft.style, 'dashed', `${theme}: a draft is not dashed`);
        assert.equal(draft.border, accent, `${theme}: a draft is not outlined in the accent`);
        assert.equal(confirmed.style, 'solid', `${theme}: a confirmed entry is not solid`);
        assert.equal(confirmed.background, accent, `${theme}: a confirmed entry is not filled`);
        assert.equal(gap.style, 'dotted', `${theme}: a gap is not dotted`);
        assert.equal(gap.background, 'rgba(0, 0, 0, 0)', `${theme}: a gap is not empty`);
        assert.notEqual(draft.background, gap.background, `${theme}: a draft reads as a gap`);
      }
      // The name says the state first, as the eye sees it.
      const names = await h.page
        .locator('[data-block-select]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
      assert.ok(names.length >= 4, `only ${String(names.length)} blocks`);
      for (const name of names) {
        assert.match(name, /^(Draft|Draft, no task yet|Confirmed), /, `unnamed state: ${name}`);
      }
      assert.ok(names.some((n) => n.startsWith('Confirmed, ')));
      assert.ok(names.some((n) => n.startsWith('Draft, ')));
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('Confirm day is the primary action and the toolbar keeps to one row with a timer running', async () => {
    const h = await openDay(onStub(), 1440, '[data-myday-ready]');
    try {
      const confirm = h.page.locator('[data-confirm-day]');
      assert.equal(await confirm.count(), 1);
      assert.match((await confirm.getAttribute('class')) ?? '', /\bmyday-chip-primary\b/);
      assert.match(await confirm.innerText(), /^Confirm day/);
      // The only primary control in the header.
      assert.equal(await h.page.locator('.screen-page-actions .myday-chip-primary').count(), 1);
      const tools = h.page.locator('[data-head-tools]');
      assert.equal(await tools.count(), 1);
      // The day's tools are in the group, together.
      for (const sel of ['[data-shortcuts-button]', '[data-beside-button]']) {
        assert.equal(await tools.locator(sel).count(), 1, `${sel} is not in the tools group`);
      }
      const row = async (sel: string) => {
        const box = await h.page.locator(sel).first().boundingBox();
        assert.ok(box !== null, `${sel} has no box`);
        return box;
      };
      const timer = await row('.screen-page-actions [data-timer]');
      const cta = await row('[data-confirm-day]');
      const group = await row('[data-head-tools]');
      const shortcuts = await row('[data-shortcuts-button]');
      const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
      assert.ok(Math.abs(mid(cta) - mid(timer)) <= 2, 'Confirm day is not on the timer’s row');
      assert.ok(Math.abs(mid(group) - mid(cta)) <= 2, 'the tools wrapped below Confirm day');
      assert.ok(Math.abs(mid(shortcuts) - mid(group)) <= 2, 'the tools group split');
      assert.ok(group.x > cta.x + cta.width, 'the tools are not at the row’s end');
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('a block is reached and chosen by keyboard, and its state is announced', async () => {
    const h = await openDay(onStub(), 1440, '[data-myday-ready]');
    try {
      const draft = h.page
        .locator('.dayline-drafted:not(.dayline-needs-card) [data-block-select]')
        .first();
      await draft.focus();
      assert.equal(
        await draft.evaluate((el) => el === document.activeElement),
        true,
        'the draft did not take focus',
      );
      assert.equal(await draft.getAttribute('aria-pressed'), 'false');
      await h.page.keyboard.press('Enter');
      await h.page.locator('[data-myday-drawer]').waitFor({ timeout: 5_000 });
      assert.equal(await draft.getAttribute('aria-pressed'), 'true');
      assert.match((await draft.getAttribute('aria-label')) ?? '', /^Draft, /);
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('tracking off leads to the open work and to the setting that turns it on', async () => {
    const h = await openDay(offStub(), 1440, '[data-off-plate-list]');
    try {
      assert.match(await h.page.locator('body').innerText(), /Time tracking is off for Kvelld\./);
      const rows = await h.page.locator('[data-off-plate-row]').allInnerTexts();
      assert.equal(rows.length, 2, `rows: ${rows.join(' | ')}`);
      assert.match(rows.join('\n'), /LAI-33[\s\S]*Two days late/);
      // Somewhere to go: the open work in full and the setting.
      assert.equal(await h.page.getByRole('link', { name: /All your work/ }).count(), 1);
      assert.equal(await h.page.getByRole('link', { name: /Organisation settings/ }).count(), 1);
      // Nothing that only tracking has: no Timeline, no Confirm day, no shortcuts.
      assert.equal(await h.page.locator('[data-dayline], [data-confirm-day]').count(), 0);
      assert.equal(await h.page.locator('[data-shortcuts-button]').count(), 0);
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  void test('at 390px the phone bar fits: every control inside the screen, none under another', async () => {
    const h = await openDay(onStub(), 390, '[data-phone-head]');
    try {
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(h.page, theme);
        const boxes = await h.page.evaluate(() => {
          const head = document.querySelector('.shell-head');
          if (head === null) return [];
          return [...head.querySelectorAll<HTMLElement>('button, [role="button"], a')]
            .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                name: el.getAttribute('aria-label') ?? el.innerText.trim(),
                left: r.left,
                right: r.right,
                top: r.top,
              };
            });
        });
        assert.ok(boxes.length >= 5, `only ${String(boxes.length)} controls in the bar`);
        const sorted = [...boxes].sort((a, b) => a.left - b.left);
        for (const [i, b] of sorted.entries()) {
          assert.ok(b.left >= 0 && b.right <= 390 + 0.5, `${theme}: ${b.name} is off-screen`);
          const next = sorted[i + 1];
          if (next !== undefined) {
            assert.ok(b.right <= next.left + 0.5, `${theme}: ${b.name} runs under ${next.name}`);
          }
        }
        // Whose day it is stays readable.
        assert.match(await h.page.locator('.shell-head .myday-viewing-trigger').innerText(), /Me/);
        assert.ok((await pageOverflow(h.page)) <= 1, `${theme}: the page scrolls sideways`);
      }
      // The day's primary action leads the phone's day row.
      const confirm = h.page.locator('[data-confirm-phone]');
      assert.equal(await confirm.count(), 1);
      assert.match((await confirm.getAttribute('class')) ?? '', /\bmyday-chip-primary\b/);
      assert.deepEqual(await violations(h.page), []);
    } finally {
      await h.close();
    }
  });

  for (const width of [1440, 390]) {
    void test(`the worst day overflows nothing at ${String(width)}px`, async () => {
      const h = await openDay(
        worstStub(),
        width,
        width > 900 ? '[data-myday-ready]' : '[data-phone-head]',
      );
      try {
        assert.ok((await pageOverflow(h.page)) <= 1, 'the page scrolls sideways');
        if (width > 900) {
          // The overlapping draft shares its hour rather than covering a block.
          const stacked = await h.page.locator('.dayline-stacked').count();
          assert.ok(stacked >= 2, `only ${String(stacked)} blocks share a row`);
          // A long title stays inside its row in By task.
          const task = h.page.locator('text=/^LAI-1000/').first();
          if ((await task.count()) > 0) {
            const box = await task.boundingBox();
            assert.ok(box !== null && box.x + box.width <= width + 0.5);
          }
        }
        const sideways = await h.page.evaluate(() => {
          const bad: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>('.myday-page *:not(svg *)')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            // Inside a scroller (the Timeline track, a list) is its own business.
            let p = el.parentElement;
            let scrolled = false;
            while (p !== null) {
              const s = getComputedStyle(p);
              if (
                s.overflowX === 'auto' ||
                s.overflowX === 'scroll' ||
                s.overflowX === 'hidden' ||
                s.overflowX === 'clip'
              ) {
                scrolled = true;
                break;
              }
              p = p.parentElement;
            }
            if (!scrolled && r.right > window.innerWidth + 1) bad.push(el.className);
          }
          return bad;
        });
        assert.deepEqual(sideways, [], 'elements past the right edge');
        assert.deepEqual(await violations(h.page), []);
      } finally {
        await h.close();
      }
    });
  }
});
