/**
 * My day v2 in a real browser (LAI-831): the owner's "Laika App v2" design and
 * CHIEF's additions — the week strip and its weeks, the lane timeline with
 * its gaps and breaks, the inspector, confirming that leaves out what needs a
 * card, split and −/+ and drag, Undo, the off switch that asks, Add time into
 * a gap, keyboard shortcuts that never fire while typing, honest signals, no
 * mockup data, and a phone.
 *
 * The API is stubbed (`my-day-week.ts`); every write is recorded and its body
 * asserted, so a screen that sent the wrong thing cannot pass.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  closeBrowser,
  reply,
  refuse,
  setTheme,
  until,
  withHeaders,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open } from './my-day-clock.ts';
import {
  addDays,
  at,
  EARLIER,
  QUIET,
  TODAY,
  TOMORROW,
  weekData,
  weekStub,
  type Break,
  type DayData,
} from './my-day-week.ts';
import { NARROW_QUERY } from '../../src/components/sidebar/sidebar-state.ts';

/** A duration as LAI-830 prints one: `19 min`, `1 h 35 min`, `2 h`. */
function dur(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)} min`;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

const mondayOf = (day: string): string => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
};

/**
 * What a gap may show, by the room the font leaves it: its length, a bare
 * "+", or nothing. Its name says which gap and how long, always.
 */
/**
 * Whether a gap shows what it may (LAI-888): its glyph, *Add time*, and its
 * range and length on a line of their own — each only where it fits as drawn,
 * so any of them may be left out, and nothing else is ever shown.
 */
const gapShows = (text: string, length: string): boolean => {
  const rest = text.replace(/\s+/g, ' ').trim();
  const len = length.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(\\+ ?)?(Add time ?)?((\\S.* · )?${len})?$`).test(rest);
};

/** A break shows its glyph, the word, and its range and length — or less, never more. */
const breakShows = (text: string): boolean =>
  /^(‖ ?)?(Break ?)?((\S.* · )?\d+ (?:min|h)( \d+ min)?)?$/.test(text.replace(/\s+/g, ' ').trim());

/** What a block's second line may show, by the same measure: both, the length, or nothing. */
const subForms = (range: string, length: string): readonly string[] => [
  `${range} · ${length}`,
  length,
  '',
];

/** The undo id the stub gives a change: its method and path, so a test can name it. */
const undoId = (method: string, path: string): string => `u:${method}:${path}`;

/**
 * The writes My day makes, answered as the server would — each with the
 * `X-Undo-Id` of the change, as the server sends it (review round 1); breaks
 * kept in `data`. `undoAnswer` replaces what `POST /me/time/undo` says.
 */
function stub(
  data: Map<string, DayData> = weekData(),
  undoAnswer?: (call: StubCall) => unknown,
): ApiStub {
  const routes: Record<string, unknown> = { ...weekStub(data) };
  const answer = (call: StubCall): unknown => {
    const said = call.path.endsWith('/confirm')
      ? reply(201, { id: 'new-entry' })
      : call.path.endsWith('/split')
        ? { drafts: [] }
        : {};
    return withHeaders(said, { 'X-Undo-Id': undoId(call.method, call.path) });
  };
  for (const day of data.values()) {
    for (const d of day.drafts) {
      for (const tail of ['', '/confirm', '/dismiss', '/split']) {
        routes[`/api/v1/me/time-drafts/${d.id}${tail}`] = answer;
      }
    }
    for (const e of day.entries) routes[`/api/v1/me/time-entries/${e.id}`] = answer;
  }
  routes[`/api/v1/me/time/days/${TODAY}/confirm`] = answer;
  routes['/api/v1/me/time/undo'] = undoAnswer ?? (() => ({}));
  routes['/api/v1/me/time-settings'] = (call: StubCall) => ({
    org_mode: 'drafts',
    draft_my_time: (call.body as { draft_my_time?: boolean } | undefined)?.draft_my_time ?? true,
    drafting: true,
    min_sync_interval_s: 300,
  });
  routes['/api/v1/me/time-entries'] = (call: StubCall) =>
    reply(
      201,
      { ...(call.body as object), id: 'n1', source: 'manual', revision: 1 },
      { 'X-Undo-Id': undoId(call.method, call.path) },
    );
  routes['/api/v1/me/time-breaks'] = (call: StubCall) => {
    const body = call.body as Omit<Break, 'id'>;
    const made: Break = { ...body, id: `b${String(Math.random()).slice(2, 8)}` };
    const day = data.get(body.day) ?? { drafts: [], entries: [] };
    day.breaks = [...(day.breaks ?? []), made];
    data.set(body.day, day);
    routes[`/api/v1/me/time-breaks/${made.id}`] = () => {
      day.breaks = (day.breaks ?? []).filter((b) => b.id !== made.id);
      return {};
    };
    return reply(201, made);
  };
  return routes;
}

/** The harness's routes are read at request time, so later keys take effect. */
async function openDay(
  day: string,
  data?: Map<string, DayData>,
  undoAnswer?: (call: StubCall) => unknown,
): Promise<Harness> {
  const h = await open(`/my-day?day=${day}`, stub(data, undoAnswer));
  await h.page.locator('.myday-week').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  return h;
}

const writes = (h: Harness): StubCall[] => h.calls.filter((c) => c.method !== 'GET');

/** The lists live on tabs (LAI-505): a row is reached on its own tab. */
async function onTab(h: Harness, row: string): Promise<void> {
  const tab = h.page.locator(`[data-day-tab="${row.startsWith('e') ? 'confirmed' : 'review'}"]`);
  if ((await tab.count()) === 1 && (await tab.getAttribute('aria-current')) !== 'page') {
    await tab.click();
  }
}

async function select(h: Harness, row: string): Promise<void> {
  await onTab(h, row);
  await h.page.locator(`[data-select="${row}"]`).click();
  await h.page.locator(`[data-inspector-for="${row}"]`).waitFor({ timeout: 5_000 });
}

/** The x of minute `m` of the day along the lane's track. */
async function xOf(page: Page, minute: number): Promise<number> {
  const track = page.locator('[data-dayline-track]');
  const box = await track.boundingBox();
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  assert.ok(box !== null, 'the lane has no box');
  return box.x + ((minute - from * 60) / ((to - from) * 60)) * box.width;
}

/** The middle of `locator`, brought into view first — a drag starts where it is seen. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box !== null);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The sidebar's two widths (`sidebar.css`): 212px open, the 60px icon rail. */
const RAIL_PX = { open: 212, folded: 60 } as const;

/**
 * **The page at `width`, with the sidebar as named and nothing still moving**
 * (LAI-846). A resize across `NARROW_QUERY` folds the sidebar by itself, from
 * a media listener that runs in a frame after `setViewportSize` returns. Read
 * the toggle before then and the old width's state is what is read: a click
 * opens it, the listener folds it again, and the case measures a state it did
 * not name. So: first the page has heard the width — a media change reaches
 * every listener, the shell's too, before that frame's animation callbacks,
 * where this polls; then click if the state is wrong; then the named state at
 * its final width with its transition over, asserted.
 */
async function layOut(h: Harness, width: number, folded: boolean): Promise<void> {
  type Heard = Window & { __mydayNarrow?: { heard: boolean } };
  await h.page.evaluate((query) => {
    const w = window as Heard;
    if (w.__mydayNarrow !== undefined) return;
    const list = matchMedia(query);
    const said = { heard: list.matches };
    list.addEventListener('change', () => {
      said.heard = list.matches;
    });
    w.__mydayNarrow = said;
  }, NARROW_QUERY);
  await h.page.setViewportSize({ width, height: 900 });
  await h.page.waitForFunction(
    ([query, px]) =>
      window.innerWidth === px &&
      (window as Heard).__mydayNarrow?.heard === matchMedia(query).matches,
    [NARROW_QUERY, width] as const,
    { timeout: 10_000 },
  );
  const fold = h.page.locator('.sidebar-toggle');
  if ((await fold.getAttribute('aria-expanded')) === String(folded)) await fold.click();
  const state = () =>
    h.page.evaluate(() => {
      const rail = document.querySelector('#sidebar');
      return {
        expanded: document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') ?? null,
        px: rail?.getBoundingClientRect().width ?? -1,
        moving: rail?.getAnimations().length ?? -1,
      };
    });
  const named = {
    expanded: String(!folded),
    px: folded ? RAIL_PX.folded : RAIL_PX.open,
    moving: 0,
  };
  await until(async () => JSON.stringify(await state()) === JSON.stringify(named));
  assert.deepEqual(
    await state(),
    named,
    `${String(width)} folded=${String(folded)}: the sidebar is not as named`,
  );
  await relabelled(h);
}

/**
 * **Every label has re-chosen its form** (LAI-846). `FitLabel` picks the
 * longest form that fits as drawn, and starts again from a `ResizeObserver`
 * when its box changes width. The observer runs late in a frame, and the
 * re-pick is a React update in a task posted after it. So: two frames, which
 * puts the last change's observer behind us, then a task of our own, posted
 * after React's. Held at that re-pick, the 1440px wider-font case reads the
 * old form of a block's second line, `1:00–2:50 PM · 1 h 50 min`, cut — the
 * failure LAI-841's root gates saw.
 */
async function relabelled(h: Harness): Promise<void> {
  await h.page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
              channel.port1.close();
              done();
            };
            channel.port2.postMessage(undefined);
          });
        });
      }),
  );
}

void after(async () => {
  await closeBrowser();
});

void describe('the week strip (2, E)', () => {
  void test('each day says what it holds — to settle, settled, no signal, not yet — and only today has the dot', async () => {
    const h = await openDay(TODAY);
    try {
      const tile = (day: string) => h.page.locator(`.myday-week-day[data-day="${day}"]`);
      assert.equal(await h.page.locator('.myday-week-day').count(), 7);
      // The design's tile (LAI-509): weekday, date and figure on one line; today marked.
      assert.equal(await h.page.locator('[data-today]').count(), 1);
      assert.equal(await tile(TODAY).locator('[data-today]').count(), 0);
      assert.equal(await tile(TODAY).getAttribute('data-today'), '');
      assert.equal(
        (await tile(TODAY).locator('.myday-week-figure').innerText()).trim(),
        dur(30 + 30 + 95 + 40 + 110 + 40 + 25),
      );
      for (const [day, figure] of [
        [QUIET, '—'],
        [TOMORROW, ''],
      ] as const) {
        if (mondayOf(day) !== mondayOf(TODAY)) continue;
        assert.equal((await tile(day).locator('.myday-week-figure').innerText()).trim(), figure);
      }
      // Two parts, from the server's own figures: confirmed solid, drafted striped.
      const width = async (day: string, part: string) =>
        (await tile(day).locator(`[data-bar-${part}]`).boundingBox())?.width ?? 0;
      assert.ok((await width(TODAY, 'confirmed')) > 0, 'today’s confirmed part is missing');
      assert.ok((await width(TODAY, 'drafted')) > 0, 'today’s drafted part is missing');
      if (mondayOf(TOMORROW) === mondayOf(TODAY)) {
        const opacity = await tile(TOMORROW).evaluate((el) => getComputedStyle(el).opacity);
        assert.ok(Number(opacity) < 1, 'a day not yet happened is not faded');
      }
      // Never a target or a score (Organisation → Time): no percent, no goal.
      assert.doesNotMatch(await h.page.locator('.myday-week').innerText(), /%|target|goal|score/i);
    } finally {
      await h.close();
    }
  });

  void test('the arrows walk the weeks, and a tile opens its day', async () => {
    const h = await openDay(TODAY);
    try {
      const monday = mondayOf(TODAY);
      await h.page.getByRole('button', { name: 'Previous week' }).click();
      const previous = addDays(monday, -7);
      await h.page.locator(`.myday-week-day[data-day="${previous}"]`).waitFor({ timeout: 5_000 });
      await until(() => new RegExp(`day=${previous}`).test(h.page.url()));
      assert.match(h.page.url(), new RegExp(`day=${previous}`));
      await h.page.getByRole('button', { name: 'Next week' }).click();
      await h.page.locator(`.myday-week-day[data-day="${monday}"]`).waitFor({ timeout: 5_000 });
      await h.page.locator(`.myday-week-day[data-day="${monday}"]`).click();
      await until(() => h.page.url().includes(`day=${monday}`));
      assert.match(h.page.url(), new RegExp(`day=${monday}`));
    } finally {
      await h.close();
    }
  });
});

void describe('gaps and breaks (4, D)', () => {
  void test('gaps of 20 minutes or more are counted, drawn and fillable; shorter ones are not', async () => {
    const h = await openDay(EARLIER);
    try {
      // 11:30–12:00 and 12:45–1:30 count; 4:30–4:45 is a breath.
      assert.equal(await h.page.locator('.dayline-gap').count(), 2);
      const stat = await h.page.locator('[data-stat="gaps"]').innerText();
      assert.match(stat, new RegExp(dur(75)));
      assert.match(stat, /2 unaccounted/);
      // Which gap, and how long, is in its name whatever fits on the line:
      // CI's fonts draw "+ 30 min" wider than this Mac's, and it is a "+".
      const gaps = h.page.locator('.dayline-gap');
      assert.deepEqual(
        await gaps.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
        [
          `Unaccounted 11:30 AM–12:00 PM, ${dur(30)} — add time or mark a break`,
          `Unaccounted 12:45–1:30 PM, ${dur(45)} — add time or mark a break`,
        ],
      );
      const shown = await gaps.allInnerTexts();
      for (const [i, minutes] of [30, 45].entries()) {
        assert.ok(gapShows(shown[i] ?? '?', dur(minutes)), `gap ${String(i)}: "${shown[i] ?? ''}"`);
      }
    } finally {
      await h.close();
    }
  });

  void test('a gap marked Break stops counting and showing “+”; Not a break brings it back', async () => {
    const data = weekData();
    const h = await openDay(EARLIER, data);
    try {
      await h.page.locator('.dayline-gap').first().click();
      await h.page.locator('[data-inspector="gap"]').waitFor({ timeout: 5_000 });
      await h.page.getByRole('button', { name: 'Mark as break' }).click();
      await until(async () => (await h.page.locator('.dayline-break').count()) === 1);
      const made = writes(h).find((c) => c.path === '/api/v1/me/time-breaks');
      assert.deepEqual(made?.body, {
        day: EARLIER,
        tz: 'UTC',
        started_at: at(EARLIER, 11, 30),
        ended_at: at(EARLIER, 12, 0),
      });
      assert.equal(await h.page.locator('.dayline-gap').count(), 1);
      assert.match(await h.page.locator('[data-stat="gaps"]').innerText(), /1 unaccounted/);
      const drawn = h.page.locator('.dayline-break');
      assert.equal(await drawn.getAttribute('aria-label'), 'Break 11:30 AM–12:00 PM — not counted');
      assert.ok(breakShows(await drawn.innerText()), 'the break shows something else');

      await h.page.locator('.dayline-break').click();
      await h.page.getByRole('button', { name: 'Not a break' }).click();
      await until(async () => (await h.page.locator('.dayline-gap').count()) === 2);
      assert.ok(
        writes(h).some(
          (c) => c.method === 'DELETE' && c.path.startsWith('/api/v1/me/time-breaks/'),
        ),
      );
      assert.equal(await h.page.locator('.dayline-break').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('no signal is not zero hours (3, 4)', () => {
  void test('a day with no signal says so on its lane and gives no figure, never 0 min', async () => {
    const h = await openDay(QUIET);
    try {
      assert.match(
        await h.page.locator('[data-no-signal]').innerText(),
        /No signal — nothing reached Laika from your machine\. That is not zero hours/,
      );
      // The Timeline's header (LAI-888) and its You column give no figure either.
      for (const stat of ['confirmed', 'drafted', 'needs-card', 'gaps']) {
        const figure = await h.page.locator(`[data-stat="${stat}"] strong`).innerText();
        assert.equal(figure, '—', `${stat} reads ${figure}`);
      }
      assert.equal(await h.page.locator('[data-you-work]').innerText(), '—');
    } finally {
      await h.close();
    }
  });
});

void describe('confirming leaves out what needs a card (1, 6)', () => {
  void test('Confirm N ready says what is left out, and confirms only the ready blocks', async () => {
    const h = await openDay(TODAY);
    try {
      const button = h.page.locator('[data-confirm-day]');
      assert.equal((await button.innerText()).trim(), `Confirm 3 ready · ${dur(95 + 110 + 25)}`);
      assert.match((await button.getAttribute('title')) ?? '', /2 need a card .*left out/);
      await button.click();
      // The summary first (LAI-503): what confirms, what stays, then Confirm.
      const summary = h.page.locator('[data-confirm-summary]');
      await summary.waitFor({ timeout: 5_000 });
      assert.match(
        await summary.locator('[data-summary-sub]').innerText(),
        /2 without a card stay/,
      );
      await summary.locator('[data-summary-confirm]').click();
      await until(() => writes(h).length >= 3);
      assert.deepEqual(
        writes(h).map((c) => c.path),
        ['d1', 'd3', 'd5'].map((id) => `/api/v1/me/time-drafts/${id}/confirm`),
      );
    } finally {
      await h.close();
    }
  });

  void test('a bulk Confirm leaves out what needs a card, keeps it checked and says so', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.getByRole('checkbox', { name: 'Select every drafted block' }).check();
      await h.page.locator('.myday-bulk').getByRole('button', { name: 'Confirm' }).click();
      await h.page.locator('[data-toast]').waitFor({ timeout: 5_000 });
      assert.deepEqual(
        writes(h).map((c) => c.path),
        ['d1', 'd3', 'd5'].map((id) => `/api/v1/me/time-drafts/${id}/confirm`),
      );
      assert.match(await h.page.locator('[data-toast]').innerText(), /2 need a card/);
      for (const id of ['d2', 'd4']) {
        assert.ok(
          await h.page.locator(`[data-settle-row="${id}"] .myday-check`).isChecked(),
          `${id} was not kept checked`,
        );
      }
    } finally {
      await h.close();
    }
  });
});

void describe('the inspector (5)', () => {
  void test('a block on nothing cannot be confirmed until it has a card or General', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd2');
      const inspector = h.page.locator('[data-inspector="draft"]');
      const confirm = inspector.locator('[data-inspector-confirm]');
      assert.equal((await confirm.innerText()).trim(), 'Needs a card');
      assert.ok(await confirm.isDisabled());
      assert.match(
        await inspector.locator('[data-card-warning]').innerText(),
        /Nothing named a task/,
      );
      await inspector.locator('[data-card="LAI-12"]').click();
      await until(() => writes(h).length > 0);
      assert.deepEqual(writes(h)[0], {
        method: 'PATCH',
        path: '/api/v1/me/time-drafts/d2',
        body: { task: 'LAI-12' },
      });
    } finally {
      await h.close();
    }
  });

  void test('a card the reader cannot read is said by its key; evidence from a folder with no name is counts only (LAI-866: a named one says so, my-day-folders.test.ts)', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd4');
      const inspector = h.page.locator('[data-inspector="draft"]');
      assert.match(await inspector.locator('[data-card-warning]').innerText(), /SEC-9/);
      assert.equal((await inspector.locator('[data-count="prompts"]').innerText()).trim(), '5');
      assert.equal((await inspector.locator('[data-count="commits"]').innerText()).trim(), '1');
      assert.match(
        await inspector.innerText(),
        /Counts only — never what you typed, file names or commit messages\./,
      );
      // Nothing of what was typed is ever asked for.
      assert.deepEqual(writes(h), []);
    } finally {
      await h.close();
    }
  });

  void test('a confirmed entry: its source and revision, Delete, and every edit kept', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'e2');
      const inspector = h.page.locator('[data-inspector="entry"]');
      assert.match(await inspector.innerText(), /rev 2/);
      assert.match(await inspector.innerText(), /Every edit is kept as a revision\./);
      assert.equal(await inspector.getByRole('button', { name: 'Delete' }).count(), 1);
    } finally {
      await h.close();
    }
  });
});

void describe('split, −/+ and drag (5, C)', () => {
  void test('−/+ move the end and the length by five minutes', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd1');
      await h.page.getByRole('button', { name: 'Longer by 5 minutes' }).click();
      await until(() => writes(h).length === 1);
      assert.deepEqual(writes(h)[0]?.body, { minutes: 100, ended_at: at(TODAY, 10, 20) });
      await h.page.locator('[data-inspector-for="d1"]').waitFor();
      await h.page.getByRole('button', { name: 'Shorter by 5 minutes' }).click();
      await until(() => writes(h).length === 2);
      assert.deepEqual(writes(h)[1]?.body, { minutes: 90, ended_at: at(TODAY, 10, 10) });
    } finally {
      await h.close();
    }
  });

  void test('Split in two cuts at the middle, to five minutes', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd1');
      // Split… opens the time, filled with the middle (LAI-504); Split cuts there.
      await h.page.getByRole('button', { name: 'Split in two' }).click();
      assert.equal(await h.page.locator('[data-split-at]').inputValue(), '9:30 AM');
      await h.page.locator('[data-split-go]').click();
      await until(() => writes(h).length === 1);
      // 8:40–10:15 is 95 minutes: half is 47.5, to five minutes 50 → 9:30.
      assert.deepEqual(writes(h)[0], {
        method: 'POST',
        path: '/api/v1/me/time-drafts/d1/split',
        body: { at: at(TODAY, 9, 30) },
      });
    } finally {
      await h.close();
    }
  });

  void test('a dragged edge snaps to five minutes, and a confirmed block is one revision', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.locator('[data-zoom="2"]').click();
      await select(h, 'e2');
      const handle = h.page.locator('[data-block-id="e2"] [data-edge="end"]');
      const from = await centre(handle);
      await h.page.mouse.move(from.x, from.y);
      await h.page.mouse.down();
      await h.page.mouse.move(await xOf(h.page, 12 * 60 + 41), from.y, { steps: 4 });
      await h.page.mouse.move(await xOf(h.page, 12 * 60 + 47), from.y, { steps: 4 });
      await h.page.mouse.up();
      await until(() => writes(h).length > 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      // One write for the whole drag, so one revision, landed on 12:45.
      assert.deepEqual(writes(h), [
        {
          method: 'PATCH',
          path: '/api/v1/me/time-entries/e2',
          body: { ended_at: at(TODAY, 12, 45), minutes: 45 },
        },
      ]);

      await select(h, 'd3');
      const start = h.page.locator('[data-block-id="d3"] [data-edge="start"]');
      const grab = await centre(start);
      await h.page.mouse.move(grab.x, grab.y);
      await h.page.mouse.down();
      await h.page.mouse.move(await xOf(h.page, 12 * 60 + 52), grab.y, { steps: 4 });
      await h.page.mouse.up();
      await until(() => writes(h).length > 1);
      assert.deepEqual(writes(h)[1], {
        method: 'PATCH',
        path: '/api/v1/me/time-drafts/d3',
        body: { started_at: at(TODAY, 12, 50), minutes: 120 },
      });
    } finally {
      await h.close();
    }
  });
});

void describe('Undo (B)', () => {
  void test('a confirm offers Undo, and Undo asks the server to put it back', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd1');
      await h.page.locator('[data-inspector-confirm]').click();
      const toast = h.page.locator('[data-toast]');
      await toast.waitFor({ timeout: 5_000 });
      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(() => writes(h).some((c) => c.path === '/api/v1/me/time/undo'));
      assert.deepEqual(
        writes(h)
          .filter((c) => c.path === '/api/v1/me/time/undo')
          .map((c) => c.body),
        [{ id: undoId('POST', '/api/v1/me/time-drafts/d1/confirm') }],
      );
    } finally {
      await h.close();
    }
  });

  void test('a bulk Not work is undone block by block, newest first', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.locator('[data-settle-row="d1"] .myday-check').check();
      await h.page.locator('[data-settle-row="d2"] .myday-check').check();
      await h.page.locator('.myday-bulk').getByRole('button', { name: 'Not work' }).click();
      const toast = h.page.locator('[data-toast]');
      await toast.waitFor({ timeout: 5_000 });
      assert.deepEqual(
        writes(h).map((c) => c.path),
        ['/api/v1/me/time-drafts/d1/dismiss', '/api/v1/me/time-drafts/d2/dismiss'],
      );
      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(() => writes(h).filter((c) => c.path === '/api/v1/me/time/undo').length === 2);
      assert.deepEqual(
        writes(h)
          .filter((c) => c.path === '/api/v1/me/time/undo')
          .map((c) => c.body),
        [
          { id: undoId('POST', '/api/v1/me/time-drafts/d2/dismiss') },
          { id: undoId('POST', '/api/v1/me/time-drafts/d1/dismiss') },
        ],
      );
    } finally {
      await h.close();
    }
  });

  void test('a delete and an add are undone by their entry', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'e1');
      await h.page
        .locator('[data-inspector="entry"]')
        .getByRole('button', { name: 'Delete' })
        .click();
      await h.page.locator('[data-toast]').getByRole('button', { name: 'Undo' }).click();
      await until(() => writes(h).some((c) => c.path === '/api/v1/me/time/undo'));
      // Add time from the header (LAI-502): the last free half hour before now.
      await h.page.locator('[data-add-time]').click();
      await h.page.locator('[data-inspector="range"]').waitFor({ timeout: 5_000 });
      await h.page.locator('[data-entry-title]').fill('A call');
      await h.page.locator('[data-range-add]').click();
      await until(() => writes(h).some((c) => c.path === '/api/v1/me/time-entries'));
      await until(async () =>
        /added/i.test(
          (await h.page
            .locator('[data-toast]')
            .innerText()
            .catch(() => '')) ?? '',
        ),
      );
      await h.page.locator('[data-toast]').getByRole('button', { name: 'Undo' }).click();
      await until(() => writes(h).filter((c) => c.path === '/api/v1/me/time/undo').length === 2);
      assert.deepEqual(
        writes(h)
          .filter((c) => c.path === '/api/v1/me/time/undo')
          .map((c) => c.body),
        [
          { id: undoId('DELETE', '/api/v1/me/time-entries/e1') },
          { id: undoId('POST', '/api/v1/me/time-entries') },
        ],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the off switch asks first (F)', () => {
  void test('turning Draft my time off says what it deletes, and Keep drafting sends nothing', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.locator('[data-day-settings] > button').click();
      const toggle = h.page.getByRole('switch', { name: 'Draft my time' });
      await toggle.click();
      const dialog = h.page.getByRole('dialog');
      await dialog.waitFor({ timeout: 5_000 });
      assert.match(
        await dialog.innerText(),
        new RegExp(`This deletes 5 drafts you hold \\(${dur(310)}\\)\\. Confirmed time stays\\.`),
      );
      await dialog.getByRole('button', { name: 'Keep drafting' }).click();
      assert.equal(await h.page.getByRole('dialog').count(), 0);
      assert.deepEqual(writes(h), [], 'Keep drafting sent something');

      await toggle.click();
      await h.page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
      await until(() => writes(h).length > 0);
      assert.deepEqual(writes(h), [
        { method: 'PUT', path: '/api/v1/me/time-settings', body: { draft_my_time: false } },
      ]);
    } finally {
      await h.close();
    }
  });
});

void describe('Add time into a picked gap (7)', () => {
  void test('a gap picked on the timeline is the time it is added at', async () => {
    const h = await openDay(EARLIER);
    try {
      await h.page.locator('.dayline-gap').nth(1).click();
      await h.page.locator('[data-inspector="gap"]').waitFor({ timeout: 5_000 });
      // The gap's *Add time here* opens the new-entry panel on the gap (LAI-897, LAI-502).
      await h.page.locator('[data-gap-add]').click();
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 5_000 });
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /12:45.*1:30/);
      await panel.locator('[data-card="LAI-11"]').click();
      await panel.locator('[data-entry-title]').fill('Pairing on search');
      await panel.locator('[data-range-add]').click();
      await until(() => writes(h).length > 0);
      assert.deepEqual(writes(h)[0], {
        method: 'POST',
        path: '/api/v1/me/time-entries',
        body: {
          day: EARLIER,
          tz: 'UTC',
          minutes: 45,
          started_at: at(EARLIER, 12, 45),
          ended_at: at(EARLIER, 13, 30),
          task: 'LAI-11',
          title: 'Pairing on search',
        },
      });
    } finally {
      await h.close();
    }
  });
});

void describe('keyboard shortcuts (H)', () => {
  void test('never fire while typing; ? opens the sheet; X marks the selected draft not work', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd2');
      // A field in the header's Start timer popover (LAI-502) keeps every key.
      await h.page.locator('[data-timer-start] > button').click();
      const note = h.page.locator('[data-timer-title]');
      await note.click();
      await h.page.keyboard.type('xgjk?');
      assert.equal(await note.inputValue(), 'xgjk?');
      assert.equal(
        await h.page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count(),
        0,
        'the sheet opened while typing',
      );
      assert.deepEqual(
        writes(h).filter((c) => c.path.startsWith('/api/v1/me/time-drafts')),
        [],
        'a shortcut fired while typing',
      );

      await h.page.keyboard.press('Escape');
      await until(async () => (await note.count()) === 0);
      await h.page.keyboard.press('Shift+?');
      const sheet = h.page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await sheet.waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Escape');
      await until(async () => (await sheet.count()) === 0);

      await h.page.keyboard.press('x');
      await until(() => writes(h).some((c) => c.path.endsWith('/dismiss')));
      assert.ok(writes(h).some((c) => c.path === '/api/v1/me/time-drafts/d2/dismiss'));
    } finally {
      await h.close();
    }
  });

  void test('J and K move through the drafts; G puts the selected one on General', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd1');
      await h.page.locator('[data-inspector-for="d1"]').focus();
      await h.page.keyboard.press('j');
      await h.page.locator('[data-inspector-for="d2"]').waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('k');
      await h.page.locator('[data-inspector-for="d1"]').waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('j');
      await h.page.locator('[data-inspector-for="d2"]').waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('g');
      await until(() => writes(h).length > 0);
      assert.deepEqual(writes(h)[0], {
        method: 'PATCH',
        path: '/api/v1/me/time-drafts/d2',
        body: { general: true },
      });
    } finally {
      await h.close();
    }
  });
});

void describe('honest signals (G)', () => {
  void test('a block shows its counts as a badge, and nothing is spread along it', async () => {
    const h = await openDay(TODAY);
    try {
      const badge = h.page.locator('[data-block-id="d1"] .dayline-signals');
      assert.equal(await badge.count(), 1);
      assert.match((await badge.getAttribute('title')) ?? '', /18 prompts.*3 commits/);
      assert.equal(await h.page.locator('[data-signal-dot], [data-signal-tick]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('review round 1', () => {
  void test('a later edit to the same block retires the earlier Undo (the probe)', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd2');
      await h.page.locator('[data-inspector="draft"] [data-card="general"]').click();
      const toast = h.page.locator('[data-toast]');
      await toast.getByRole('button', { name: 'Undo' }).waitFor({ timeout: 5_000 });
      await h.page.getByRole('button', { name: 'Longer by 5 minutes' }).click();
      await until(() => writes(h).length === 2);
      await until(async () => (await toast.getByRole('button', { name: 'Undo' }).count()) === 0);
      assert.equal(
        await toast.getByRole('button', { name: 'Undo' }).count(),
        0,
        'General’s Undo outlived the + after it',
      );
      assert.deepEqual(
        writes(h).filter((c) => c.path === '/api/v1/me/time/undo'),
        [],
        'something was undone',
      );
    } finally {
      await h.close();
    }
  });

  void test('an Undo the server refuses says why, and changes nothing', async () => {
    const h = await openDay(TODAY, undefined, () =>
      refuse(
        409,
        'conflict',
        'A later change to this block came after it, so this one can no longer be undone.',
      ),
    );
    try {
      await select(h, 'd1');
      await h.page.locator('[data-inspector-confirm]').click();
      const toast = h.page.locator('[data-toast]');
      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(async () => (await toast.innerText().catch(() => '')).includes('later change'));
      assert.match(await toast.innerText(), /can no longer be undone/);
      assert.equal(await toast.locator('[role="alert"]').count(), 1);
      assert.doesNotMatch(await toast.innerText(), /^Undone/);
    } finally {
      await h.close();
    }
  });

  void test('a dragged edge stops at the next confirmed block', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.locator('[data-zoom="2"]').click();
      await select(h, 'd2');
      // 10:40–11:20 drafted; confirmed time starts at 11:30.
      const handle = h.page.locator('[data-block-id="d2"] [data-edge="end"]');
      const from = await centre(handle);
      await h.page.mouse.move(from.x, from.y);
      await h.page.mouse.down();
      await h.page.mouse.move(await xOf(h.page, 11 * 60 + 50), from.y, { steps: 6 });
      await h.page.mouse.up();
      await until(() => writes(h).length > 0);
      assert.deepEqual(writes(h), [
        {
          method: 'PATCH',
          path: '/api/v1/me/time-drafts/d2',
          body: { ended_at: at(TODAY, 11, 30), minutes: 50 },
        },
      ]);
    } finally {
      await h.close();
    }
  });

  void test('a typed length says what it read, for a block with no set time and a timed one', async () => {
    const h = await openDay(TODAY);
    try {
      await select(h, 'd5');
      const field = h.page.locator('[data-inspector="draft"]').getByLabel('Length, typed');
      await field.fill('1h 30m');
      assert.equal(
        await h.page.locator('[data-inspector="draft"] [data-understood]').innerText(),
        'Reads as 1 h 30 min',
      );
      await field.press('Enter');
      await until(() => writes(h).length === 1);
      assert.deepEqual(writes(h)[0], {
        method: 'PATCH',
        path: '/api/v1/me/time-drafts/d5',
        body: { minutes: 90 },
      });

      await select(h, 'e2');
      const entryField = h.page.locator('[data-inspector="entry"]').getByLabel('Length, typed');
      for (const [typed, read] of [
        ['45', '45 min'],
        ['45m', '45 min'],
        ['1:30', '1 h 30 min'],
      ] as const) {
        await entryField.fill(typed);
        assert.equal(
          await h.page.locator('[data-inspector="entry"] [data-understood]').innerText(),
          `Reads as ${read}`,
        );
      }
      await entryField.fill('45');
      await entryField.press('Enter');
      await until(() => writes(h).length === 2);
      assert.deepEqual(writes(h)[1], {
        method: 'PATCH',
        path: '/api/v1/me/time-entries/e2',
        body: { minutes: 45, ended_at: at(TODAY, 12, 45) },
      });
    } finally {
      await h.close();
    }
  });

  void test('today’s gaps are between its blocks — nothing runs to now', async () => {
    const h = await openDay(TODAY);
    try {
      // 10:15–10:40, 12:30–1:00 and 2:50–3:30; never 4:10 PM onward.
      const stat = await h.page.locator('[data-stat="gaps"]').innerText();
      assert.match(stat, new RegExp(dur(25 + 30 + 40)));
      assert.match(stat, /3 unaccounted/);
    } finally {
      await h.close();
    }
  });
});

/** The owner's mockup's own data: none of it may ship (CLAUDE.md §5.1). */
const MOCKUP = [
  'LAIKA-381',
  'LAIKA-591',
  'LAIKA-598',
  'LAIKA-364',
  'LAIKA-360',
  'LAIKA-365',
  'Standup',
  'Andrea',
  'Solidtime bridge',
  'Slim task list',
  'No production address',
  '4:50 PM',
  'Wednesday 21 October',
];

void describe('no mockup data (2)', () => {
  void test('nothing from the owner’s mockup reaches the built bundle', async () => {
    const h = await openDay(TODAY);
    try {
      const html = await (await fetch(`${h.origin}/`)).text();
      const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1] ?? '');
      assert.ok(scripts.length > 0, 'no script in the built page');
      let bundle = '';
      for (const src of scripts) bundle += await (await fetch(`${h.origin}${src}`)).text();
      // The positive control: My day's own words are in it, so the search ran.
      assert.ok(bundle.includes('Drafts: you, owners and admins'), 'My day is not in this bundle');
      assert.deepEqual(
        MOCKUP.filter((needle) => bundle.includes(needle)),
        [],
      );
    } finally {
      await h.close();
    }
  });
});

/** Each list drawn: its label, whether it has rows, what is cut, and where its columns start. */
async function readLists(h: Harness) {
  return h.page.evaluate(() =>
    [...document.querySelectorAll('.myday-blocks')].map((list) => {
      const rows = [...list.querySelectorAll(':scope > li:not(.myday-group-head)')];
      const edge = (row: Element, sel: string): number =>
        Math.round(row.querySelector(sel)?.getBoundingClientRect().left ?? -1);
      return {
        label: list.getAttribute('aria-label') ?? '',
        rows: rows.length,
        cut: [...list.querySelectorAll('.myday-row-select, .myday-row-time, .myday-row-minutes')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => `${el.className}: ${(el.textContent ?? '').trim()}`),
        lengths: [...new Set(rows.map((row) => edge(row, '.myday-row-minutes')))],
        cards: [...new Set(rows.map((row) => edge(row, '.myday-row-target')))],
      };
    }),
  );
}

void describe('a phone, and both themes (I)', () => {
  void test('390 px: the week and the timeline scroll on their own, the column moves below, the page never sideways', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        await select(h, 'd1');
        const sideways = await h.page.evaluate(() => {
          const main = document.querySelector('.shell-main') ?? document.scrollingElement;
          return main === null ? 0 : main.scrollWidth - main.clientWidth;
        });
        assert.ok(sideways <= 1, `${theme}: the page scrolls sideways by ${String(sideways)}px`);
        const scrolls = (selector: string) =>
          h.page.locator(selector).evaluate((el) => ({
            over: el.scrollWidth > el.clientWidth,
            auto: ['auto', 'scroll'].includes(getComputedStyle(el).overflowX),
          }));
        // A phone shows a letter a day, and the week fits without scrolling (LAI-502).
        assert.equal((await scrolls('.myday-week-days')).over, false, 'the week overflows');
        assert.deepEqual(await scrolls('[data-dayline-scroller]'), { over: true, auto: true });
        // The editor is a bottom sheet on a phone (LAI-511).
        const sheet = await h.page.locator('[data-myday-drawer]').evaluate((el) => ({
          position: getComputedStyle(el).position,
          bottom: Math.round(el.getBoundingClientRect().bottom),
        }));
        assert.equal(sheet.position, 'fixed', 'the editor is not a sheet');
        assert.equal(sheet.bottom, 844, 'the sheet is not at the bottom');
        // The inspector's three parts stack.
        const parts = h.page.locator('[data-inspector="draft"] .inspector-part');
        const xs = await parts.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
        assert.ok(xs.length >= 3 && new Set(xs.map(Math.round)).size === 1, 'not stacked');
        // The sheet is modal (LAI-511): let go before the next theme's pick.
        await h.page.keyboard.press('Escape');
        await until(async () => (await h.page.locator('[data-myday-drawer]').count()) === 0);
      }
    } finally {
      await h.close();
    }
  });

  void test('1440 and 1024, sidebar open or folded, light and dark: nothing overflows', async () => {
    const h = await openDay(TODAY);
    try {
      for (const width of [1440, 1024]) {
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          for (const folded of [false, true]) {
            await layOut(h, width, folded);
            const sideways = await h.page.evaluate(() => {
              const main = document.querySelector('.shell-main') ?? document.scrollingElement;
              return main === null ? 0 : main.scrollWidth - main.clientWidth;
            });
            assert.ok(
              sideways <= 1,
              `${String(width)} ${theme} folded=${String(folded)}: sideways`,
            );
            const clipped = await h.page.evaluate(() =>
              [...document.querySelectorAll('.myday-page button, .myday-page h2')]
                // Clipped on purpose: a heading for assistive tech only.
                .filter((el) => !el.classList.contains('visually-hidden'))
                .filter((el) => getComputedStyle(el).textOverflow !== 'ellipsis')
                .filter((el) => el.scrollWidth > el.clientWidth + 1)
                .map((el) => (el.textContent ?? '').trim().slice(0, 40)),
            );
            assert.deepEqual(clipped, [], `${String(width)} ${theme}: clipped text`);
          }
        }
      }
    } finally {
      await h.close();
    }
  });

  // CI's Linux drew `+ 30 min` wider than this Mac does and the gap cut it: a
  // label is chosen by what fits as drawn, never by a pixel count set for one
  // machine's font. Wider letters stand in for a wider font.
  void test('a font wider than ours: a gap, a break, a block’s figures and the week’s are never cut', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.addStyleTag({ content: '.myday-page * { letter-spacing: 0.12em !important; }' });
      for (const width of [1440, 1024]) {
        for (const folded of [false, true]) {
          await layOut(h, width, folded);
          const measure = () =>
            h.page.evaluate(() =>
              [
                ...document.querySelectorAll(
                  '.dayline-gap, .dayline-break, .dayline-block-sub, .myday-week-figure, .dayline-totals li',
                ),
              ]
                .filter((el) => el.scrollWidth > el.clientWidth + 1)
                .map((el) => `${el.className}: ${(el.textContent ?? '').trim().slice(0, 40)}`),
            );
          // A label is re-chosen after the wider letters and the new width are
          // laid out, a frame or more later on a loaded runner (LAI-715).
          await until(async () => (await measure()).length === 0);
          const cut = await measure();
          assert.deepEqual(cut, [], `${String(width)} folded=${String(folded)}: cut`);
          // Whatever form fits, the name keeps which and how long.
          const drawn = await h.page.evaluate(() => ({
            gaps: [...document.querySelectorAll('.dayline-gap')].map((el) => [
              el.getAttribute('aria-label') ?? '',
              (el.textContent ?? '').trim(),
            ]),
            blocks: [...document.querySelectorAll('[data-block-select]')].map((el) => [
              el.getAttribute('aria-label') ?? '',
              (el.querySelector('.dayline-block-sub')?.textContent ?? '').trim(),
            ]),
          }));
          assert.ok(drawn.gaps.length > 0 && drawn.blocks.length > 0, 'nothing drawn to look at');
          for (const [name = '', text = ''] of drawn.gaps) {
            const said = /^Unaccounted .+, (.+) — add time or mark a break$/.exec(name);
            assert.ok(said?.[1] !== undefined, `a gap named "${name}"`);
            assert.ok(gapShows(text, said[1]), `${name}: shows "${text}"`);
          }
          for (const [name = '', text = ''] of drawn.blocks) {
            const said = /^(.+?), .*, ([^,]+)$/.exec(name);
            assert.ok(said?.[1] !== undefined && said[2] !== undefined, `a block named "${name}"`);
            assert.ok(subForms(said[1], said[2]).includes(text), `${name}: shows "${text}"`);
          }
        }
      }
      // The positive control: with room, a gap says how long it is.
      await h.page.locator('[data-zoom="2"]').click();
      const gaps = await h.page
        .locator('.dayline-gap')
        .evaluateAll((els) =>
          els.map((el) => [el.clientWidth, (el.textContent ?? '').trim()] as const),
        );
      assert.ok(gaps.length > 0, 'no gap to look at');
      for (const [px, text] of gaps) {
        if (px >= 160) assert.match(text, / min$| h$/, `a ${String(px)}px gap says only "${text}"`);
      }
    } finally {
      await h.close();
    }
  });
  // LAI-842: the rows gave their time 9.5rem and their length 5.5rem, a guess
  // about one machine's font, and a wider font ran `1 h 35 min` out of its
  // column. Columns sized to the widest row fit any font and still line up.
  void test('a font wider than ours: a row’s time and length fit, and the columns line up', async () => {
    const h = await openDay(TODAY);
    try {
      await h.page.addStyleTag({ content: '.myday-page * { letter-spacing: 0.12em !important; }' });
      for (const width of [1440, 1024]) {
        for (const folded of [false, true]) {
          await layOut(h, width, folded);
          // One list per tab (LAI-505): read each on its own tab.
          const lists = [];
          for (const tab of ['review', 'confirmed']) {
            await h.page.locator(`[data-day-tab="${tab}"]`).click();
            await h.page.locator('.myday-blocks').waitFor({ timeout: 5_000 });
            lists.push(...(await readLists(h)));
          }
          const at = `${String(width)} folded=${String(folded)}`;
          assert.deepEqual(
            lists.map((l) => [l.label, l.rows > 1]),
            [
              ['Drafted blocks', true],
              ['Confirmed entries', true],
            ],
            `${at}: the two lists, each with rows to line up`,
          );
          for (const list of lists) {
            assert.deepEqual(list.cut, [], `${at} ${list.label}: cut`);
            assert.equal(
              list.lengths.length,
              1,
              `${at} ${list.label}: lengths at ${list.lengths.join(', ')}`,
            );
            assert.equal(
              list.cards.length,
              1,
              `${at} ${list.label}: cards at ${list.cards.join(', ')}`,
            );
          }
        }
      }
    } finally {
      await h.close();
    }
  });
});
