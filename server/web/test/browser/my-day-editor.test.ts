import assert from 'node:assert/strict';
import { answerConfirm } from './confirm.ts';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  reply,
  setTheme,
  until,
  withHeaders,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { at, weekData, weekStub, TOMORROW } from './my-day-week.ts';

/**
 * The editor as the design draws it (D-110 items 5, 7, 8 and 9, LAI-504):
 * the head with ‹ n of N › and ×; WHEN typed — a start, an end, a length,
 * chips and Ends now on a new entry; the presets; the task search; a kind and
 * words on a draft sent with its confirm; Split at a typed time; a block
 * with no set time given one. Both themes.
 */

function stub(writes: StubCall[]): ApiStub {
  const data = weekData();
  const today = data.get(TODAY);
  if (today !== undefined) {
    today.entries = [
      ...today.entries,
      {
        id: 'u1',
        day: TODAY,
        tz: 'UTC',
        started_at: null,
        ended_at: null,
        minutes: 20,
        source: 'manual',
        task: null,
        project: null,
        note: null,
        kind: 'support',
        title: 'Call with the bank',
        description: null,
        revision: 1,
        created_at: 1,
        updated_at: 1,
      },
    ];
  }
  const routes: Record<string, unknown> = { ...weekStub(data) };
  const record = (call: StubCall) => {
    if (call.method !== 'GET') writes.push(call);
  };
  for (const id of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    routes[`/api/v1/me/time-drafts/${id}`] = (call: StubCall) => {
      record(call);
      return withHeaders({ id }, { 'X-Undo-Id': `u-${id}` });
    };
    routes[`/api/v1/me/time-drafts/${id}/confirm`] = (call: StubCall) => {
      record(call);
      return withHeaders(reply(201, { id: `from-${id}` }), { 'X-Undo-Id': `c-${id}` });
    };
    routes[`/api/v1/me/time-drafts/${id}/split`] = (call: StubCall) => {
      record(call);
      return withHeaders({ drafts: [] }, { 'X-Undo-Id': `s-${id}` });
    };
  }
  for (const id of ['e1', 'e2', 'u1']) {
    routes[`/api/v1/me/time-entries/${id}`] = (call: StubCall) => {
      record(call);
      return { id };
    };
  }
  routes['/api/v1/me/time-entries'] = (call: StubCall) => {
    record(call);
    return withHeaders(
      reply(201, {
        id: 'n1',
        day: TODAY,
        tz: 'UTC',
        started_at: null,
        ended_at: null,
        minutes: 30,
        source: 'manual',
        task: null,
        project: null,
        note: null,
        kind: null,
        title: null,
        description: null,
        revision: 1,
        created_at: 1,
        updated_at: 1,
      }),
      { 'X-Undo-Id': 'u-n1' },
    );
  };
  routes['/api/v1/me/time-entries/e2/revisions'] = {
    revisions: [
      {
        revision: 1,
        change: 'created',
        changed_by: 'u1',
        day: TODAY,
        tz: 'UTC',
        minutes: 35,
        task_id: 't12',
        project_id: 'p1',
        note: null,
        started_at: at(TODAY, 12, 0),
        ended_at: at(TODAY, 12, 35),
        created_at: at(TODAY, 12, 36),
      },
      {
        revision: 2,
        change: 'edited',
        changed_by: 'u1',
        day: TODAY,
        tz: 'UTC',
        minutes: 30,
        task_id: 't12',
        project_id: 'p1',
        note: null,
        started_at: at(TODAY, 12, 0),
        ended_at: at(TODAY, 12, 30),
        created_at: at(TODAY, 12, 40),
      },
    ],
  };
  routes['/api/v1/tasks'] = {
    data: [
      { id: 't11', key: 'LAI-11', title: 'Search matches keys', project_id: 'p1', number: 11 },
      { id: 't40', key: 'LAI-40', title: 'Retry the webhook', project_id: 'p1', number: 40 },
      { id: 't41', key: 'LAI-41', title: 'Webhook signing keys', project_id: 'p1', number: 41 },
    ],
    next_cursor: null,
  };
  return routes;
}

async function myDay(writes: StubCall[]): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(writes));
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.setViewportSize({ width: 1440, height: 900 });
  return h;
}

async function select(h: Harness, row: string): Promise<void> {
  const tab = h.page.locator(`[data-day-tab="${row.startsWith('e') ? 'confirmed' : 'review'}"]`);
  if ((await tab.getAttribute('aria-current')) !== 'page') await tab.click();
  await h.page.locator(`[data-select="${row}"]`).click();
  await h.page.locator(`[data-inspector-for="${row}"]`).waitFor({ timeout: 5_000 });
}

after(async () => {
  await closeBrowser();
});

void describe('the editor (LAI-504)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: a field opens the time wheel — a minute picked writes the field, Done saves it, a length picked too`, async () => {
      const writes: StubCall[] = [];
      const h = await myDay(writes);
      try {
        await setTheme(h.page, theme);
        await select(h, 'd1');
        const editor = h.page.locator('[data-inspector="draft"]');
        await editor.waitFor({ timeout: 10_000 });
        // d1 8:40–10:15: the wheel stands on 8, 40, AM.
        const start = editor.locator('[data-when-start]');
        await start.click();
        const wheel = editor.locator('[data-wheel]');
        await wheel.waitFor({ timeout: 5_000 });
        assert.equal(await wheel.getAttribute('aria-label'), 'Start');
        assert.equal(await wheel.locator('[data-wheel-col]').count(), 3);
        for (const [col, value] of [
          ['Hour', '8'],
          ['Minute', '40'],
          ['AM or PM', 'AM'],
        ] as const) {
          assert.equal(
            await wheel.locator(`[data-wheel-col="${col}"] .wheel-item-on`).innerText(),
            value,
            col,
          );
        }
        // The rows above and below the band fade: the band sits in the middle row.
        const band = await wheel.locator('.wheel-band').boundingBox();
        const on = await wheel.locator('[data-wheel-col="Minute"] .wheel-item-on').boundingBox();
        assert.ok(band !== null && on !== null);
        assert.ok(Math.abs(band.y + band.height / 2 - (on.y + on.height / 2)) <= 2, 'off the band');
        // 55, picked: the field says so and nothing is saved yet; the field keeps the focus.
        await wheel.locator('[data-wheel-col="Minute"] [data-wheel-value="55"]').click();
        await until(async () => (await start.inputValue()) === '8:55 AM');
        assert.equal(await start.inputValue(), '8:55 AM');
        assert.equal(writes.length, 0);
        assert.equal(await start.evaluate((el) => el === document.activeElement), true);
        await editor.locator('[data-wheel-done]').click();
        await until(() => writes.length === 1);
        assert.deepEqual(writes[0]?.body, { started_at: at(TODAY, 8, 55), minutes: 80 });
        assert.equal(await editor.locator('[data-wheel]').count(), 0);

        // The length: hours and minutes, a word after each.
        const length = editor.locator('[data-when-length]');
        await length.click();
        await wheel.waitFor({ timeout: 5_000 });
        assert.equal(await wheel.getAttribute('aria-label'), 'Length');
        assert.match(await wheel.innerText(), /h[\s\S]*min/);
        await wheel.locator('[data-wheel-col="Hours"] [data-wheel-value="2"]').click();
        await until(async () => (await length.inputValue()).startsWith('2 h'));
        await length.press('Enter');
        await until(() => writes.length === 2);
        // The stub keeps d1 at 8:40–10:15, 1 h 35: two hours and the 35 is 2 h 35.
        assert.deepEqual(writes[1]?.body, { minutes: 155, ended_at: at(TODAY, 11, 15) });
      } finally {
        await h.close();
      }
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the head walks the drafts; a start, an end and a length typed each save one edge`, async () => {
      const writes: StubCall[] = [];
      const h = await myDay(writes);
      try {
        await setTheme(h.page, theme);
        // Nothing is in hand on load (LAI-511): the first draft, picked.
        await select(h, 'd1');
        const editor = h.page.locator('[data-inspector="draft"]');
        await editor.waitFor({ timeout: 10_000 });
        assert.equal(await editor.locator('[data-inspector-position]').innerText(), '1 of 5');
        await editor.getByRole('button', { name: 'Next to review (J)' }).click();
        await h.page.locator('[data-inspector-for="d2"]').waitFor({ timeout: 5_000 });
        assert.equal(await editor.locator('[data-inspector-position]').innerText(), '2 of 5');
        await editor.getByRole('button', { name: 'Previous to review (K)' }).click();
        await h.page.locator('[data-inspector-for="d1"]').waitFor({ timeout: 5_000 });

        // d1 8:40–10:15. A start of 9:00 keeps the end; an end of 10:30 keeps the start.
        const start = editor.locator('[data-when-start]');
        assert.equal(await start.inputValue(), '8:40 AM');
        await start.fill('9:00');
        await start.press('Enter');
        await until(() => writes.length === 1);
        assert.deepEqual(writes[0], {
          method: 'PATCH',
          path: '/api/v1/me/time-drafts/d1',
          body: { started_at: at(TODAY, 9, 0), minutes: 75 },
        });
        const end = editor.locator('[data-when-end]');
        await end.fill('10:30am');
        await end.press('Tab');
        await until(() => writes.length === 2);
        assert.deepEqual(writes[1]?.body, { ended_at: at(TODAY, 10, 30), minutes: 110 });
        // A length keeps the start.
        const length = editor.getByLabel('Length, typed');
        await length.fill('1h');
        await length.press('Enter');
        await until(() => writes.length === 3);
        assert.deepEqual(writes[2]?.body, { ended_at: at(TODAY, 9, 40), minutes: 60 });
        // Into the confirmed time after it (e1 at 11:30): a draft may lie there
        // (the design's `setTimes`, LAI-510) — saved, no words against it.
        await end.fill('11:45');
        await end.press('Enter');
        await until(() => writes.length === 4);
        assert.deepEqual(writes[3]?.body, { ended_at: at(TODAY, 11, 45), minutes: 185 });
        assert.equal(await editor.locator('[data-when-error]').count(), 0);

        // × closes the editor.
        await editor.getByRole('button', { name: 'Close (Esc)' }).click();
        await until(async () => (await h.page.locator('[data-inspector]').count()) === 0);
      } finally {
        await h.close();
      }
    });
  }

  void test('a kind and words on a draft go with its confirm; the task search puts it on a card', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await select(h, 'd2');
      const editor = h.page.locator('[data-inspector="draft"]');
      assert.match(await editor.locator('[data-card-warning]').innerText(), /Nothing named a task/);
      await editor.locator('[data-task-search]').fill('webhook');
      const results = editor.locator('[data-task-result]');
      await until(async () => (await results.count()) === 2);
      assert.deepEqual(
        await results.evaluateAll((els) => els.map((el) => el.getAttribute('data-task-result'))),
        ['LAI-40', 'LAI-41'],
      );
      await editor.locator('[data-task-result="LAI-41"]').click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-drafts/d2'));
      assert.deepEqual(writes.find((w) => w.path === '/api/v1/me/time-drafts/d2')?.body, {
        task: 'LAI-41',
      });

      await select(h, 'd1');
      await editor.locator('[data-kind-pick="review"]').click();
      await editor.locator('[data-draft-title]').fill('Reviewing the search');
      await editor.locator('[data-draft-description]').fill('Keys and prefixes');
      await editor.locator('[data-inspector-confirm]').click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-drafts/d1/confirm'));
      assert.deepEqual(writes.find((w) => w.path.endsWith('/d1/confirm'))?.body, {
        kind: 'review',
        title: 'Reviewing the search',
        description: 'Keys and prefixes',
      });
    } finally {
      await h.close();
    }
  });

  void test('Split… at a typed time; a block with no set time is placed by its start', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await select(h, 'd1');
      const editor = h.page.locator('[data-inspector="draft"]');
      await editor.getByRole('button', { name: 'Split in two' }).click();
      const field = editor.locator('[data-split-at]');
      await field.fill('9:00');
      assert.match(await editor.locator('[data-split-hint]').innerText(), /Splits at 9:00 AM/);
      await field.fill('7:00');
      assert.match(await editor.locator('[data-split-hint]').innerText(), /Pick a time between/);
      assert.equal(await editor.locator('[data-split-go]').isDisabled(), true);
      await field.fill('9:05 am');
      await editor.locator('[data-split-go]').click();
      await until(() => writes.some((w) => w.path.endsWith('/d1/split')));
      assert.deepEqual(writes.find((w) => w.path.endsWith('/d1/split'))?.body, {
        at: at(TODAY, 9, 5),
      });

      // The tray's entry: a start typed gives it its place for its length.
      await h.page.locator('[data-tray-item="u1"]').click();
      const entry = h.page.locator('[data-inspector-for="u1"]');
      await entry.waitFor({ timeout: 5_000 });
      assert.equal(await entry.locator('[data-when-start]').count(), 1);
      await entry.locator('[data-when-start]').fill('4:30pm');
      await entry.locator('[data-when-start]').press('Enter');
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-entries/u1'));
      assert.deepEqual(writes.find((w) => w.path === '/api/v1/me/time-entries/u1')?.body, {
        started_at: at(TODAY, 16, 30),
        ended_at: at(TODAY, 16, 50),
        minutes: 20,
      });
    } finally {
      await h.close();
    }
  });

  void test('a new entry: chips, Ends now, a preset, then Add', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await h.page.locator('[data-add-time]').click();
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 5_000 });
      // The last free half hour before 3:00 PM: 2:30–3:00.
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /2:30.*3:00/);
      await panel.locator('[data-when-chip="45"]').click();
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /2:30.*3:15/);
      await panel.locator('[data-when-ends-now]').click();
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /2:15.*3:00/);
      await panel.locator('[data-preset="Reading docs"]').click();
      assert.equal(await panel.locator('[data-entry-title]').inputValue(), 'Reading docs');
      assert.equal(
        await panel.locator('[data-kind-pick="research"]').getAttribute('aria-pressed'),
        'true',
      );
      await panel.locator('[data-range-add]').click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-entries'));
      assert.deepEqual(writes.find((w) => w.path === '/api/v1/me/time-entries')?.body, {
        day: TODAY,
        tz: 'UTC',
        minutes: 45,
        started_at: at(TODAY, 14, 15),
        ended_at: at(TODAY, 15, 0),
        kind: 'research',
        title: 'Reading docs',
      });
    } finally {
      await h.close();
    }
  });
});

void describe('the editor as designed (LAI-515)', () => {
  void test('Add time: seven date tiles, the future ones disabled; a past day posts its day', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await h.page.locator('[data-add-time]').click();
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 5_000 });
      const tiles = panel.locator('[data-new-entry-day]');
      assert.equal(await tiles.count(), 7);
      assert.equal(
        await panel.locator(`[data-new-entry-day="${TODAY}"]`).getAttribute('aria-checked'),
        'true',
      );
      // A day after today, when the week has one (on a Sunday it has none).
      if ((await panel.locator(`[data-new-entry-day="${TOMORROW}"]`).count()) === 1) {
        assert.equal(await panel.locator(`[data-new-entry-day="${TOMORROW}"]`).isDisabled(), true);
        assert.equal(
          await panel.locator(`[data-new-entry-day="${TOMORROW}"]`).getAttribute('title'),
          'You can’t add time ahead of the day',
        );
      }
      // The sections in the design's order: WHEN, OFF-SCREEN WORK, TASK, KIND, WHAT IT WAS.
      const labels = await panel.locator('.editor-label').allInnerTexts();
      assert.deepEqual(
        labels.map((l) => l.trim().toLowerCase()),
        ['when', 'off-screen work', 'task', 'kind', 'what it was'],
      );
      // The latest past day this week has — none on a Monday, when it is today (LAI-525).
      const open = await tiles.evaluateAll((els) =>
        els
          .filter((el) => !(el as HTMLButtonElement).disabled)
          .map((el) => el.getAttribute('data-new-entry-day') ?? ''),
      );
      const picked = open.filter((d) => d < TODAY).at(-1) ?? TODAY;
      await panel.locator(`[data-new-entry-day="${picked}"]`).click();
      await panel.locator('[data-preset="Interview"]').click();
      await panel.locator('[data-range-add]').click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-entries'));
      const body = writes.find((w) => w.path === '/api/v1/me/time-entries')?.body as {
        day: string;
        title: string;
        kind: string;
      };
      assert.equal(body.day, picked);
      assert.equal(body.title, 'Interview');
      assert.equal(body.kind, 'meeting');
    } finally {
      await h.close();
    }
  });

  void test('Add time: the bar shows the day in grey and now in red; a click places the range', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await h.page.locator('[data-add-time]').click();
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 5_000 });
      const bar = panel.locator('[data-when-bar]');
      await bar.waitFor({ timeout: 5_000 });
      assert.ok((await bar.locator('.editor-bar-busy').count()) >= 5, 'the day is not on the bar');
      assert.equal(await bar.locator('.editor-bar-now').count(), 1);
      // 2:30–3:00 PM starts half way along a 7 AM–10 PM bar.
      const range = bar.locator('[data-when-bar-range]');
      assert.equal(await range.evaluate((el) => (el as HTMLElement).style.left), '50%');
      // A click a fifth of the way along (10:00 AM) places the range there, a little back.
      const box = await bar.boundingBox();
      assert.ok(box !== null);
      await h.page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
      await until(
        async () => (await panel.locator('[data-when-start]').inputValue()) === '9:45 AM',
      );
      assert.equal(await panel.locator('[data-when-end]').inputValue(), '10:15 AM');
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /9:45.*10:15 AM/);
    } finally {
      await h.close();
    }
  });

  void test('the task chips say why; typing a name no task has makes it the title, on General', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await select(h, 'd2');
      const editor = h.page.locator('[data-inspector="draft"]');
      assert.match(await editor.locator('[data-card-warning]').innerText(), /^No task yet\./);
      // d1 (LAI-11) sits before d2 on the track; LAI-12 and LAI-13 are in progress.
      assert.equal(
        (await editor.locator('[data-card="LAI-11"] .editor-chip-why').innerText()).trim(),
        'Card before',
      );
      assert.equal(
        (await editor.locator('[data-card="LAI-12"] .editor-chip-why').innerText()).trim(),
        'In progress',
      );
      await editor.locator('[data-task-search]').fill('Sprint planning');
      const custom = editor.locator('[data-task-custom]');
      await custom.waitFor({ timeout: 5_000 });
      assert.equal(await editor.locator('[data-task-result]').count(), 0);
      await custom.click();
      assert.equal(await editor.locator('[data-draft-title]').inputValue(), 'Sprint planning');
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-drafts/d2'));
      assert.deepEqual(writes.find((w) => w.path === '/api/v1/me/time-drafts/d2')?.body, {
        general: true,
      });
      assert.equal(await h.page.locator('.myday-task-result, .inspector-other').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('a confirmed entry: HISTORY from its revisions, Delete entry, and the end refused over confirmed time', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes);
    try {
      await select(h, 'e2');
      const editor = h.page.locator('[data-inspector="entry"]');
      const rows = editor.locator('[data-entry-history] .editor-history-row');
      await until(async () => (await rows.count()) === 2);
      // Newest first: the edit, then the confirm.
      assert.match(await rows.nth(0).innerText(), /12:40 PM[\s\S]*Edited · 30 min · You/);
      assert.match(await rows.nth(1).innerText(), /12:36 PM[\s\S]*Confirmed · 35 min · You/);
      assert.equal(await editor.locator('.inspector-stepper').count(), 0, 'the stepper is drawn');
      assert.equal(await editor.locator('.inspector-keys-hint').count(), 0, '? all keys is drawn');
      // Delete asks first (LAI-522), naming the entry; Cancel keeps it.
      await editor.locator('[data-entry-delete]').click();
      const asked = await answerConfirm(h.page, false);
      assert.match(asked, /^Delete this entry\?/);
      assert.match(asked, /LAI-12/);
      await h.page.waitForTimeout(300);
      assert.equal(
        writes.some((w) => w.method === 'DELETE'),
        false,
        'deleted without asking',
      );
      await editor.locator('[data-entry-delete]').click();
      await answerConfirm(h.page, true);
      await until(() =>
        writes.some((w) => w.method === 'DELETE' && w.path === '/api/v1/me/time-entries/e2'),
      );
      assert.equal(
        writes.some((w) => w.method === 'DELETE' && w.path === '/api/v1/me/time-entries/e2'),
        true,
      );
    } finally {
      await h.close();
    }
  });
});
