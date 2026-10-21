/**
 * My day's two lists scroll on their own (LAI-858), in a real browser, on a
 * day shaped like the owner's screenshot of 2026-10-21: fifteen blocks to
 * settle, ten of them on nothing.
 *
 * - With the pointer anywhere over *To settle* or *Confirmed* — a row, the
 *   header, the selection bar, the pager, *Add time* — a wheel moves only that
 *   card's list while it has more rows than it shows, and neither end carries
 *   on into the page. A list that shows every row is not a scroller, so there
 *   the page scrolls, as it does anywhere else.
 * - Rows come to rest whole. Opening the day, a wheel to either end, a new
 *   page and selecting a row by click, J or K never leave one partly hidden
 *   under the header — the owner's screenshot — and selecting never moves the
 *   list on the screen.
 * - The rows line up with their header and pager, every *To settle* row is one
 *   height, and a source badge is as wide as its word, at the right.
 * - The rest of the screen lines up: the column beside the day ends where the
 *   page's other edges do, and on a phone the week's arrows, the timeline's
 *   controls, the gaps' link and the subtitle wrap without coming apart.
 * - Nothing else loses its scroll: the timeline, the column beside the day,
 *   and the page anywhere else.
 *
 * The page's scroller is `.shell-main` (LAI-601). The document itself never
 * scrolls, and every reading says so too.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, until, type Harness } from './harness.ts';
import { ATLAS, BUSY_DAY, CARDS, TODAY, busyStub, type Draft } from './my-day-busy.ts';

const MIDNIGHT = Date.parse(`${TODAY}T00:00:00Z`);
const at = (minutes: number): number => MIDNIGHT + minutes * 60_000;

type Kind = 'nothing' | 'card' | 'general' | 'space' | 'agent';

/** Block `i` of the day, 47 minutes apart, on `kind`. */
function block(i: number, kind: Kind): Draft {
  const start = 10 + i * 47;
  const minutes = 1 + ((i * 7) % 30);
  const card = CARDS[i % CARDS.length] ?? CARDS[0];
  const onCard = kind === 'card' || kind === 'agent';
  return {
    id: `s${String(i + 1).padStart(2, '0')}`,
    source: kind === 'agent' ? 'agent' : 'collector',
    day: TODAY,
    tz: 'UTC',
    started_at: at(start),
    ended_at: at(start + minutes),
    minutes,
    task: onCard ? card : null,
    task_key: null,
    project: onCard || kind === 'space' ? ATLAS : null,
    general: kind === 'general',
    signals: { prompts: 1, replies: 2, sessions: 1, commits: 0, marks: 0 },
    note: null,
  };
}

/** The owner's day: ten blocks on nothing — a full first page — then five on a card. */
const OWNERS: readonly Draft[] = Array.from({ length: 15 }, (_, i) =>
  block(i, i < 10 ? 'nothing' : 'card'),
);

/** Every kind of row on the first page. */
const MIXED: readonly Draft[] = (
  [
    'nothing',
    'card',
    'general',
    'space',
    'agent',
    'nothing',
    'card',
    'card',
    'nothing',
    'card',
    'card',
    'nothing',
  ] as const
).map((kind, i) => block(i, kind));

const SETTLE = '.myday-settle';
const CONFIRMED = '.myday-entries';

void after(async () => {
  await closeBrowser();
});

async function openDay(drafts: readonly Draft[], width: number, height: number): Promise<Harness> {
  const minutes = drafts.reduce((sum, d) => sum + d.minutes, 0);
  const day = { ...BUSY_DAY, drafts, drafts_held: { count: drafts.length, minutes } };
  const h = await open('/my-day', busyStub(undefined, day));
  await h.page.setViewportSize({ width, height });
  await h.page.waitForFunction((w) => document.documentElement.clientWidth === w, width);
  await h.page.locator(`${SETTLE} [data-pager-label]`).waitFor({ timeout: 30_000 });
  await h.page.locator(`${CONFIRMED} .myday-scroll li`).first().waitFor({ timeout: 10_000 });
  return h;
}

/** What scrolled, and which rows of `card`'s list are partly in view. */
interface Seen {
  /** `.shell-main`'s scroll, and how far it can go. */
  readonly page: number;
  readonly pageMax: number;
  /** The document's own scroll — always 0. */
  readonly document: number;
  readonly list: number;
  readonly listMax: number;
  /** The list's top edge in the viewport. */
  readonly listTop: number;
  /** Rows cut by the list's top or bottom edge: `id top–bottom`. */
  readonly cut: readonly string[];
  /** The selected row, if it is in this list, and whether all of it shows. */
  readonly selected: string | null;
  readonly selectedWhole: boolean;
}

const seen = (h: Harness, card: string): Promise<Seen> =>
  h.page.evaluate((sel) => {
    const main = document.querySelector<HTMLElement>('.shell-main');
    const box = document.querySelector<HTMLElement>(`${sel} .myday-scroll`);
    if (main === null || box === null) throw new Error(`no page or no list in ${sel}`);
    const rect = box.getBoundingClientRect();
    const top = rect.top + box.clientTop;
    const bottom = top + box.clientHeight;
    const rows = [...box.querySelectorAll<HTMLElement>('li')].map((li) => {
      const r = li.getBoundingClientRect();
      return {
        id: li.getAttribute('data-draft') ?? li.getAttribute('data-entry') ?? '?',
        top: r.top,
        bottom: r.bottom,
        selected: li.classList.contains('myday-row-selected'),
      };
    });
    const partly = (r: { top: number; bottom: number }) =>
      (r.top < top - 0.5 && r.bottom > top + 0.5) ||
      (r.top < bottom - 0.5 && r.bottom > bottom + 0.5);
    const chosen = rows.find((r) => r.selected);
    return {
      page: main.scrollTop,
      pageMax: main.scrollHeight - main.clientHeight,
      document: window.scrollY,
      list: box.scrollTop,
      listMax: box.scrollHeight - box.clientHeight,
      listTop: rect.top,
      cut: rows
        .filter(partly)
        .map((r) => `${r.id} ${String(Math.round(r.top))}–${String(Math.round(r.bottom))}`),
      selected: chosen?.id ?? null,
      selectedWhole:
        chosen !== undefined && chosen.top >= top - 0.5 && chosen.bottom <= bottom + 0.5,
    };
  }, card);

/** Wait until neither the page nor `card`'s list is still moving — a snap animates. */
async function settle(h: Harness, card: string): Promise<Seen> {
  let last = await seen(h, card);
  let still = 0;
  await until(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    const now = await seen(h, card);
    still = now.page === last.page && now.list === last.list ? still + 1 : 0;
    last = now;
    return still >= 4;
  }, 6_000);
  return last;
}

/** Scroll the page so `card`'s top sits just below the viewport's top. */
async function place(h: Harness, card: string): Promise<Seen> {
  await h.page.evaluate((sel) => {
    const main = document.querySelector<HTMLElement>('.shell-main');
    const box = document.querySelector<HTMLElement>(sel);
    if (main === null || box === null) throw new Error(`no ${sel}`);
    main.scrollTop += box.getBoundingClientRect().top - 64;
  }, card);
  return settle(h, card);
}

/** The middle of what shows of the first of `selector` that is in the viewport. */
async function spot(h: Harness, selector: string): Promise<{ x: number; y: number }> {
  const point = await h.page.evaluate((sel) => {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      if (r.width > 0 && bottom - top > 4)
        return { x: r.left + r.width / 2, y: (top + bottom) / 2 };
    }
    return null;
  }, selector);
  assert.ok(point !== null, `nothing to point at: ${selector}`);
  return point;
}

/** `times` wheel notches at `point`, each let come to rest. */
async function wheel(
  h: Harness,
  card: string,
  point: { x: number; y: number },
  dy: number,
  times: number,
): Promise<Seen> {
  await h.page.mouse.move(point.x, point.y);
  // A fresh gesture: let the last one's latch on its scroller run out.
  await h.page.waitForTimeout(600);
  let now = await seen(h, card);
  for (let i = 0; i < times; i += 1) {
    await h.page.mouse.wheel(0, dy);
    now = await settle(h, card);
  }
  return now;
}

/**
 * Over each of `spots`, the list — not the page — takes a notch, then runs to
 * its end and back to its top without carrying on into the page.
 */
async function scrollsAlone(
  h: Harness,
  card: string,
  spots: readonly (readonly [string, string])[],
  label: string,
): Promise<void> {
  const placed = await place(h, card);
  assert.ok(
    placed.listMax > 0,
    `${label}: the list shows every row, so there is nothing to test: ${JSON.stringify(placed)}`,
  );
  // Room either way, or "the page did not move" would hold whatever happened.
  assert.ok(
    placed.page > 50 && placed.page < placed.pageMax - 50,
    `${label}: the page has no room to move either way: ${JSON.stringify(placed)}`,
  );
  const notches = Math.ceil(placed.listMax / 100) + 2;
  for (const [where, selector] of spots) {
    const point = await spot(h, selector);
    const one = await wheel(h, card, point, 100, 1);
    assert.equal(one.page, placed.page, `${label}: a wheel over ${where} scrolled the page`);
    assert.ok(one.list > 0, `${label}: a wheel over ${where} did not move the list`);
    const end = await wheel(h, card, point, 100, notches);
    assert.equal(end.list, end.listMax, `${label}: ${where} did not take the list to its end`);
    assert.equal(
      end.page,
      placed.page,
      `${label}: past the list's end, over ${where}, the page moved`,
    );
    const top = await wheel(h, card, point, -100, notches);
    assert.equal(top.list, 0, `${label}: ${where} did not take the list back to its top`);
    assert.equal(
      top.page,
      placed.page,
      `${label}: past the list's top, over ${where}, the page moved`,
    );
    assert.equal(top.document, 0, `${label}: the document itself scrolled`);
  }
}

const SIZES = [
  [1440, 900],
  [390, 844],
] as const;

void describe('a wheel over a list that has more rows than it shows moves only that list', () => {
  for (const [width, height] of SIZES) {
    void test(`To settle at ${String(width)}: over a row, its header, the selection bar and the pager`, async () => {
      const h = await openDay(OWNERS, width, height);
      try {
        await scrollsAlone(
          h,
          SETTLE,
          [
            ['a row', `${SETTLE} .myday-scroll li`],
            ['the header', `${SETTLE} > .myday-card-head`],
            ['the pager', `${SETTLE} .myday-pager-label`],
          ],
          `${String(width)}`,
        );
        // Ticking a box brings the selection bar, which is the card's too.
        await h.page.locator(`${SETTLE} li[data-draft="s02"] input.myday-check`).check();
        await h.page.locator(`${SETTLE} .myday-bulk`).waitFor({ timeout: 5_000 });
        await scrollsAlone(
          h,
          SETTLE,
          [['the selection bar', `${SETTLE} [data-bulk-count]`]],
          `${String(width)}, ticked`,
        );
      } finally {
        await h.close();
      }
    });
  }

  // Ten confirmed rows are one line each: on a laptop they fit unless the
  // window is short, so the laptop case is a short one.
  for (const [width, height] of [
    [1440, 640],
    [390, 844],
  ] as const) {
    void test(`Confirmed at ${String(width)}×${String(height)}: over a row, its header, the pager and Add time`, async () => {
      const h = await openDay(OWNERS, width, height);
      try {
        await scrollsAlone(
          h,
          CONFIRMED,
          [
            ['a row', `${CONFIRMED} .myday-scroll li`],
            ['the header', `${CONFIRMED} > .myday-card-head`],
            ['the pager', `${CONFIRMED} .myday-pager-label`],
            ['Add time', `${CONFIRMED} .myday-add-head`],
          ],
          `${String(width)}×${String(height)}`,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('a list that shows every row is not a scroller: over it, the page scrolls', async () => {
    const h = await openDay(OWNERS, 1440, 900);
    try {
      const placed = await place(h, CONFIRMED);
      assert.equal(
        placed.listMax,
        0,
        `ten one-line rows fit on a laptop: ${JSON.stringify(placed)}`,
      );
      assert.ok(placed.page > 150, `the page cannot move up: ${JSON.stringify(placed)}`);
      for (const [where, selector] of [
        ['a row', `${CONFIRMED} .myday-scroll li`],
        ['the header', `${CONFIRMED} > .myday-card-head`],
      ] as const) {
        const before = await seen(h, CONFIRMED);
        const after = await wheel(h, CONFIRMED, await spot(h, selector), -100, 1);
        assert.ok(after.page < before.page, `over ${where}, the page did not scroll`);
      }
    } finally {
      await h.close();
    }
  });
});

void describe('rows come to rest whole, and selecting never moves the page', () => {
  for (const [width, height] of SIZES) {
    void test(`${String(width)}: opening, either end, J, K, a click and a new page`, async () => {
      const h = await openDay(OWNERS, width, height);
      try {
        const placed = await place(h, SETTLE);
        assert.ok(placed.listMax > 0, `nothing to scroll: ${JSON.stringify(placed)}`);
        assert.deepEqual(placed.cut, [], 'opened, a row is partly hidden');

        const row = await spot(h, `${SETTLE} .myday-scroll li`);
        const end = await wheel(h, SETTLE, row, 100, Math.ceil(placed.listMax / 100) + 2);
        assert.equal(end.list, end.listMax);
        // The owner's screenshot: the first row cut under the header, a line showing.
        assert.deepEqual(end.cut, [], 'at the end, a row is partly hidden');
        const top = await wheel(h, SETTLE, row, -100, Math.ceil(placed.listMax / 100) + 2);
        assert.equal(top.list, 0);
        assert.deepEqual(top.cut, [], 'back at the top, a row is partly hidden');
        // One notch is not a row's height: the list still comes to rest on a row.
        const notch = await wheel(h, SETTLE, row, 100, 1);
        assert.ok(notch.list > 0, 'a notch did not move the list');
        assert.deepEqual(
          notch.cut,
          [],
          `one notch in, at ${String(notch.list)}, a row is partly hidden`,
        );
        await wheel(h, SETTLE, row, -100, 2);

        // J walks down the page, then onto the next one; K walks back. The
        // inspector above may change height with the block — on a phone it
        // does — and the browser's scroll anchoring keeps what is on screen
        // still, so the page's offset follows it. The list must not move.
        const steady = async (what: string): Promise<Seen> => {
          const now = await settle(h, SETTLE);
          assert.equal(
            now.listTop,
            placed.listTop,
            `${what}: the list moved on the screen (the page's scroll ${String(placed.page)} → ${String(now.page)})`,
          );
          assert.equal(now.document, 0, `${what}: the document scrolled`);
          assert.ok(now.selectedWhole, `${what}: ${String(now.selected)} is not all in view`);
          assert.deepEqual(now.cut, [], `${what}: a row is partly hidden`);
          return now;
        };
        await until(async () => (await seen(h, SETTLE)).selected !== null);
        assert.equal(
          (await seen(h, SETTLE)).selected,
          's01',
          'the day does not open on its first block',
        );
        for (let n = 2; n <= 10; n += 1) {
          await h.page.keyboard.press('j');
          await until(async () => (await seen(h, SETTLE)).selected === OWNERS[n - 1]?.id);
          await steady(`J to block ${String(n)}`);
        }
        await h.page.keyboard.press('j');
        const label = h.page.locator(`${SETTLE} [data-pager-label]`);
        await until(async () => (await label.innerText()) === '11–15 of 15');
        assert.equal((await steady('J onto the next page')).selected, 's11');
        await h.page.keyboard.press('k');
        await until(async () => (await label.innerText()) === '1–10 of 15');
        assert.equal((await steady('K back a page')).selected, 's10');

        // A click on a row in view: the mouse's own, so nothing scrolls it there first.
        const second = await spot(h, `${SETTLE} li[data-draft="s09"] .myday-row-select`);
        await h.page.mouse.click(second.x, second.y);
        await until(async () => (await seen(h, SETTLE)).selected === 's09');
        await steady('a click on a row');

        // A new page starts at its top, and back again.
        const next = await spot(h, `${SETTLE} .myday-pager button:last-child`);
        await h.page.mouse.click(next.x, next.y);
        await until(async () => (await label.innerText()) === '11–15 of 15');
        const turned = await settle(h, SETTLE);
        assert.equal(turned.page, placed.page, 'Next moved the page');
        assert.equal(turned.list, 0, 'a new page does not start at its top');
        assert.deepEqual(turned.cut, [], 'a new page has a row partly hidden');
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the rows line up (the owner’s design)', () => {
  for (const [width, height] of SIZES) {
    void test(`${String(width)}: one height, the card's title under its key, edges with the header and pager, badges as wide as their word`, async () => {
      const h = await openDay(MIXED, width, height);
      try {
        const m = await h.page.evaluate(() => {
          const box = (el: Element | null | undefined) => {
            if (el === null || el === undefined) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
          };
          const card = (sel: string) => {
            const c = document.querySelector(sel);
            if (c === null) throw new Error(`no ${sel}`);
            const head = c.querySelector(':scope > .myday-card-head');
            return {
              headLeft: box(head?.firstElementChild)?.left ?? NaN,
              captionRight: box(head?.querySelector('.myday-card-caption'))?.right ?? NaN,
              pagerRight: box(c.querySelector('.myday-pager button:last-child'))?.right ?? NaN,
              rows: [...c.querySelectorAll('.myday-scroll li')].map((li) => ({
                id: li.getAttribute('data-draft') ?? li.getAttribute('data-entry') ?? '?',
                // Without the line under it, which the last row has not got.
                height:
                  li.getBoundingClientRect().height -
                  parseFloat(getComputedStyle(li).borderBottomWidth),
                first: box(li.firstElementChild),
                last: box(li.lastElementChild),
                time: box(li.querySelector('.myday-row-time')),
                target: box(li.querySelector('.myday-row-target')),
                key: box(li.querySelector('.myday-cardlink-key')),
                title: box(li.querySelector('.myday-cardlink-title')),
                source: box(li.querySelector('.myday-source')),
                word: li.querySelector('.myday-source')?.textContent ?? '',
              })),
            };
          };
          return { settle: card('.myday-settle'), confirmed: card('.myday-entries') };
        });
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;

        const heights = m.settle.rows.map((r) => r.height);
        assert.ok(
          Math.max(...heights) - Math.min(...heights) <= 0.5,
          `To settle rows of more than one height: ${JSON.stringify(m.settle.rows.map((r) => [r.id, r.height]))}`,
        );
        const carded = m.settle.rows.filter((r) => r.key !== null && r.title !== null);
        assert.ok(carded.length >= 3, 'no row on a card to look at');
        for (const r of carded) {
          assert.ok(
            r.title !== null && r.key !== null && r.title.top >= r.key.bottom - 1,
            `${r.id}: the card's title is beside its key, not under it`,
          );
        }

        for (const [name, c] of [
          ['To settle', m.settle],
          ['Confirmed', m.confirmed],
        ] as const) {
          for (const r of c.rows) {
            assert.ok(
              r.first !== null && near(r.first.left, c.headLeft),
              `${String(width)} ${name} ${r.id}: starts at ${String(r.first?.left)}, its header at ${String(c.headLeft)}`,
            );
          }
          if (width >= 1000) {
            assert.ok(near(c.captionRight, c.pagerRight), `${name}: header and pager end apart`);
            for (const r of c.rows) {
              assert.ok(
                r.last !== null && near(r.last.right, c.pagerRight),
                `${name} ${r.id}: ends at ${String(r.last?.right)}, the pager at ${String(c.pagerRight)}`,
              );
            }
            const ends = c.rows.map((r) => r.source?.right ?? NaN);
            assert.ok(
              Math.max(...ends) - Math.min(...ends) <= 0.5,
              `${name}: the badges do not end on one line: ${JSON.stringify(ends)}`,
            );
            const widths = new Map(c.rows.map((r) => [r.word, r.source?.width ?? 0]));
            assert.ok(widths.size >= 2, `${name}: one kind of badge only`);
            assert.equal(
              new Set(widths.values()).size,
              widths.size,
              `${name}: badges with different words are one width: ${JSON.stringify([...widths])}`,
            );
          } else {
            // A phone wraps a row: the lines under the first start under its time.
            for (const r of c.rows) {
              assert.ok(
                r.time !== null && r.target !== null && near(r.target.left, r.time.left),
                `${name} ${r.id}: its card starts at ${String(r.target?.left)}, its time at ${String(r.time?.left)}`,
              );
              assert.ok(
                r.target !== null && near(r.target.right, c.pagerRight),
                `${name} ${r.id}: ends at ${String(r.target?.right)}, the pager at ${String(c.pagerRight)}`,
              );
            }
          }
        }
      } finally {
        await h.close();
      }
    });
  }
});

void describe('the rest of the screen lines up', () => {
  // A classic scrollbar takes room; where scrollbars overlay, the column has
  // no gutter and these hold as they are.
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ] as const) {
    void test(`${String(width)}: the column beside the day ends where the page's other edges do`, async () => {
      const h = await openDay(OWNERS, width, height);
      try {
        await h.page.locator('[data-myday-side] .myday-plate').waitFor({ timeout: 20_000 });
        const m = await h.page.evaluate(() => {
          const right = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().right;
          return {
            week: right('.myday-week-days'),
            day: right('.myday-day'),
            side: [...document.querySelectorAll('[data-myday-side] > .myday-card')].map(
              (c) => c.getBoundingClientRect().right,
            ),
          };
        });
        // Beside the day on a laptop, the week's edge; below it, the day's.
        const edge = width >= 1440 ? m.week : m.day;
        assert.ok(
          edge !== undefined && m.side.length === 2,
          `nothing to measure: ${JSON.stringify(m)}`,
        );
        for (const right of m.side) {
          assert.ok(
            Math.abs(right - edge) <= 0.5,
            `a card beside the day ends at ${String(right)}, the page's edge at ${String(edge)}`,
          );
        }
      } finally {
        await h.close();
      }
    });
  }

  void test('390: the week, the timeline and the figures wrap without coming apart', async () => {
    const h = await openDay(OWNERS, 390, 844);
    try {
      const m = await h.page.evaluate(() => {
        const box = (el: Element | null | undefined) => {
          if (el === null || el === undefined) return null;
          const r = el.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            middle: (r.top + r.bottom) / 2,
          };
        };
        const steps = [...document.querySelectorAll('.myday-week-bar .myday-week-step')];
        const tools = [...document.querySelectorAll('.dayline-tools .dayline-tool, .dayline-zoom')];
        // Each line of the gaps' link, where its text starts. A line can hold
        // more than one text node, so rects are grouped by the line they sit on.
        const link = document.querySelector('[data-stat="gaps"] .myday-linkish');
        const starts = new Map<number, number>();
        if (link?.firstChild) {
          const range = document.createRange();
          range.selectNodeContents(link);
          for (const r of range.getClientRects()) {
            const line = Math.round(r.top);
            starts.set(line, Math.min(starts.get(line) ?? Infinity, r.left));
          }
        }
        const lines = [...starts.values()];
        const dot = document.querySelector('.myday-subtitle-dot');
        return {
          total: box(document.querySelector('.myday-week-total')),
          steps: steps.map(box),
          tools: tools.map(box),
          gapsLabel: box(document.querySelector('[data-stat="gaps"] .myday-stat-label')),
          lines,
          dot: dot === null || getComputedStyle(dot).display === 'none' ? null : box(dot),
          lock: box(document.querySelector('.myday-lock')),
        };
      });

      // The week's arrows either side of its line, however it wraps.
      assert.equal(m.steps.length, 2, 'the week has no arrows');
      for (const step of m.steps) {
        assert.ok(
          step !== null &&
            m.total !== null &&
            step.middle > m.total.top &&
            step.middle < m.total.bottom,
          `a week arrow is not beside the week's line: ${JSON.stringify({ step, total: m.total })}`,
        );
      }
      // The timeline's earlier, now, later and zoom on one line.
      assert.ok(m.tools.length >= 4, 'no timeline controls');
      const tops = m.tools.map((t) => Math.round(t?.middle ?? NaN));
      assert.ok(
        Math.max(...tops) - Math.min(...tops) <= 2,
        `the timeline's controls came apart: ${JSON.stringify(tops)}`,
      );
      // The gaps' link starts each line where the label does, as the others do.
      assert.ok(m.lines.length > 0 && m.gapsLabel !== null, 'no gaps link to measure');
      for (const left of m.lines) {
        assert.ok(
          m.gapsLabel !== null && Math.abs(left - m.gapsLabel.left) <= 1,
          `a line of the gaps' link starts at ${String(left)}, its label at ${String(m.gapsLabel?.left)}`,
        );
      }
      // No separator left at the end of a line.
      assert.ok(
        m.dot === null || (m.lock !== null && Math.abs(m.dot.middle - m.lock.middle) <= 2),
        `the subtitle's dot hangs at a line's end: ${JSON.stringify({ dot: m.dot, lock: m.lock })}`,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('nothing else loses its scroll', () => {
  for (const [width, height] of [
    [1440, 700],
    [390, 844],
  ] as const) {
    void test(`${String(width)}: the page elsewhere, the timeline sideways, the column beside the day`, async () => {
      const h = await openDay(OWNERS, width, height);
      try {
        // The page, over the day's figures.
        await h.page.evaluate(() => {
          const main = document.querySelector<HTMLElement>('.shell-main');
          if (main !== null) main.scrollTop = 0;
        });
        const stats = await spot(h, '.myday-stats');
        const down = await wheel(h, SETTLE, stats, 100, 1);
        assert.ok(down.page > 0, 'over the day’s figures, the page did not scroll');

        // The timeline, sideways, on its own.
        const lane = await spot(h, '[data-dayline-scroller]');
        const sideways = () =>
          h.page.evaluate(() => {
            const el = document.querySelector<HTMLElement>('[data-dayline-scroller]');
            return {
              left: el?.scrollLeft ?? -1,
              over: (el?.scrollWidth ?? 0) > (el?.clientWidth ?? 0),
            };
          });
        const was = await sideways();
        assert.ok(was.over, 'the timeline has nothing to scroll sideways');
        const pageWas = (await seen(h, SETTLE)).page;
        await h.page.mouse.move(lane.x, lane.y);
        await h.page.waitForTimeout(600);
        await h.page.mouse.wheel(was.left > 0 ? -120 : 120, 0);
        await until(async () => (await sideways()).left !== was.left);
        assert.notEqual((await sideways()).left, was.left, 'the timeline did not scroll sideways');
        assert.equal(
          (await settle(h, SETTLE)).page,
          pageWas,
          'the timeline’s scroll moved the page',
        );

        // The column beside the day scrolls on its own on a laptop.
        if (width >= 1000) {
          const side = () =>
            h.page.evaluate(() => {
              const el = document.querySelector<HTMLElement>('[data-myday-side]');
              return {
                top: el?.scrollTop ?? -1,
                max: (el?.scrollHeight ?? 0) - (el?.clientHeight ?? 0),
              };
            });
          const before = await side();
          assert.ok(before.max > 0, 'the column beside the day has nothing to scroll');
          const pageBefore = (await seen(h, SETTLE)).page;
          await wheel(h, SETTLE, await spot(h, '[data-myday-side] .myday-plate'), 100, 1);
          assert.ok((await side()).top > before.top, 'the column beside the day did not scroll');
          assert.equal(
            (await seen(h, SETTLE)).page,
            pageBefore,
            'the column’s scroll moved the page',
          );
        }
      } finally {
        await h.close();
      }
    });
  }
});
