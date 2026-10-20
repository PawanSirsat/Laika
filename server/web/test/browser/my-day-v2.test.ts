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
  open,
  reply,
  refuse,
  setTheme,
  until,
  withHeaders,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import {
  addDays,
  at,
  EARLIER,
  QUIET,
  TODAY,
  TOMORROW,
  YESTERDAY,
  weekData,
  weekStub,
  type Break,
  type DayData,
} from './my-day-week.ts';

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
const gapForms = (length: string): readonly string[] => [`+ ${length}`, '+', ''];

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

async function select(h: Harness, row: string): Promise<void> {
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

void after(async () => {
  await closeBrowser();
});

void describe('the week strip (2, E)', () => {
  void test('each day says what it holds — to settle, settled, no signal, not yet — and only today has the dot', async () => {
    const h = await openDay(TODAY);
    try {
      const tile = (day: string) => h.page.locator(`.myday-week-day[data-day="${day}"]`);
      assert.equal(await h.page.locator('.myday-week-day').count(), 7);
      assert.equal(await h.page.locator('[data-today-dot]').count(), 1);
      assert.equal(await tile(TODAY).locator('[data-today-dot]').count(), 1);
      assert.equal(
        (await tile(TODAY).locator('.myday-week-state').innerText()).trim(),
        `${dur(95 + 40 + 110 + 40 + 25)} to settle`,
      );
      for (const [day, label] of [
        [YESTERDAY, 'Settled'],
        [QUIET, 'No signal'],
        [TOMORROW, 'Not yet'],
      ] as const) {
        if (mondayOf(day) !== mondayOf(TODAY)) continue;
        assert.equal((await tile(day).locator('.myday-week-state').innerText()).trim(), label);
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
      const total = await h.page.locator('[data-week-total]').innerText();
      assert.match(total, /week/i);
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
        assert.ok(
          gapForms(dur(minutes)).includes(shown[i] ?? '?'),
          `gap ${String(i)}: "${shown[i] ?? ''}"`,
        );
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
      assert.ok(['Break', ''].includes(await drawn.innerText()), 'the break shows something else');

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
      for (const stat of ['confirmed', 'settle', 'gaps']) {
        const figure = await h.page.locator(`[data-stat="${stat}"] .myday-stat-figure`).innerText();
        assert.equal(figure, '—', `${stat} reads ${figure}`);
      }
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
      await h.page.getByRole('checkbox', { name: 'Select every block on this page' }).check();
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
        /Nothing named a card/,
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

  void test('a card the reader cannot read is said by its key; evidence is counts only', async () => {
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
      await h.page.getByRole('button', { name: 'Split in two' }).click();
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
      await h.page.locator('[data-length="15"]').click();
      await h.page.locator('[data-add-submit]').click();
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
      const slot = h.page.locator('[data-slot]');
      await slot.waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('[data-length="45"]').getAttribute('aria-pressed'), 'true');
      await h.page.locator('[data-add-card="LAI-11"]').click();
      await h.page.getByPlaceholder(/What it was/).fill('Pairing on search');
      await h.page.locator('[data-add-submit]').click();
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
          note: 'Pairing on search',
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
      const note = h.page.getByPlaceholder(/What it was/);
      await note.click();
      await h.page.keyboard.type('xgjk?');
      assert.equal(await note.inputValue(), 'xgjk?');
      assert.equal(await h.page.getByRole('dialog').count(), 0, 'the sheet opened while typing');
      assert.deepEqual(
        writes(h).filter((c) => c.path.startsWith('/api/v1/me/time-drafts')),
        [],
        'a shortcut fired while typing',
      );

      await note.evaluate((el) => {
        el.blur();
      });
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
      assert.ok(bundle.includes('Only you see drafts'), 'My day is not in this bundle');
      assert.deepEqual(
        MOCKUP.filter((needle) => bundle.includes(needle)),
        [],
      );
    } finally {
      await h.close();
    }
  });
});

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
        assert.deepEqual(await scrolls('.myday-week-days'), { over: true, auto: true });
        assert.deepEqual(await scrolls('[data-dayline-scroller]'), { over: true, auto: true });
        const main = await h.page.locator('.myday-main').boundingBox();
        const side = await h.page.locator('[data-myday-side]').boundingBox();
        assert.ok(main !== null && side !== null);
        assert.ok(side.y >= main.y + main.height - 1, 'the column is not below the day');
        // The inspector's three parts stack.
        const parts = h.page.locator('[data-inspector="draft"] .inspector-part');
        const xs = await parts.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
        assert.ok(xs.length >= 3 && new Set(xs.map(Math.round)).size === 1, 'not stacked');
      }
    } finally {
      await h.close();
    }
  });

  void test('1440 and 1024, sidebar open or folded, light and dark: nothing overflows', async () => {
    const h = await openDay(TODAY);
    try {
      for (const width of [1440, 1024]) {
        await h.page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await setTheme(h.page, theme);
          for (const folded of [false, true]) {
            const fold = h.page.locator('.sidebar-toggle');
            if ((await fold.count()) > 0) {
              const open = (await fold.first().getAttribute('aria-expanded')) === 'true';
              if (folded === open) {
                await fold.first().click();
                await until(
                  async () =>
                    ((await fold.first().getAttribute('aria-expanded')) === 'true') !== open,
                );
              }
            }
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
        await h.page.setViewportSize({ width, height: 900 });
        for (const folded of [false, true]) {
          const fold = h.page.locator('.sidebar-toggle');
          if ((await fold.count()) > 0) {
            const open = (await fold.first().getAttribute('aria-expanded')) === 'true';
            if (folded === open) {
              await fold.first().click();
              await until(
                async () =>
                  ((await fold.first().getAttribute('aria-expanded')) === 'true') !== open,
              );
            }
          }
          const cut = await h.page.evaluate(() =>
            [
              ...document.querySelectorAll(
                '.dayline-gap, .dayline-break, .dayline-block-sub, .myday-week-figure, .myday-stat',
              ),
            ]
              .filter((el) => el.scrollWidth > el.clientWidth + 1)
              .map((el) => `${el.className}: ${(el.textContent ?? '').trim().slice(0, 40)}`),
          );
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
            assert.ok(gapForms(said[1]).includes(text), `${name}: shows "${text}"`);
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
        if (px >= 120) assert.match(text, /^\+ \d/, `a ${String(px)}px gap says only "${text}"`);
      }
    } finally {
      await h.close();
    }
  });
});
