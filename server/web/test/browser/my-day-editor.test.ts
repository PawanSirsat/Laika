import assert from 'node:assert/strict';
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
import { at, weekData, weekStub } from './my-day-week.ts';

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
        kind: 'call',
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
        // Into the confirmed time after it (e1 at 11:30): refused, in words, nothing sent.
        await end.fill('11:45');
        await end.press('Enter');
        assert.match(await editor.locator('[data-when-error]').innerText(), /confirmed time after/);
        assert.equal(writes.length, 3);

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
        await panel.locator('[data-kind-pick="learning"]').getAttribute('aria-pressed'),
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
        kind: 'learning',
        title: 'Reading docs',
      });
    } finally {
      await h.close();
    }
  });
});
