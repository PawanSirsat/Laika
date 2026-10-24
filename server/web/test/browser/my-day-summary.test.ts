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
import { weekData, weekStub } from './my-day-week.ts';

/**
 * Confirm day's summary (D-110 item 2, LAI-503): where the day went by kind,
 * what Laika couldn't see, what confirms and what stays, and the note for
 * your manager — sent with the day, or saved alone. Both themes.
 */

interface Options {
  readonly note?: string;
  readonly noDrafts?: boolean;
  /** Only the drafts on a card: every block ready, so the day confirms in one request. */
  readonly allReady?: boolean;
}

function stub(writes: StubCall[], opts: Options = {}): ApiStub {
  const data = weekData();
  const today = data.get(TODAY);
  if (opts.noDrafts === true && today !== undefined) today.drafts = [];
  if (opts.allReady === true && today !== undefined) {
    today.drafts = today.drafts.filter((d) => d.task !== null);
  }
  const routes: Record<string, unknown> = {};
  for (const [path, answer] of Object.entries(weekStub(data))) {
    routes[path] = path.startsWith('/api/v1/me/time?day=')
      ? () => ({
          ...(typeof answer === 'function'
            ? (answer as () => Record<string, unknown>)()
            : (answer as Record<string, unknown>)),
          day_note: opts.note === undefined ? null : { day: TODAY, note: opts.note, updated_at: 1 },
        })
      : answer;
  }
  const record = (call: StubCall) => {
    if (call.method !== 'GET') writes.push(call);
  };
  for (const id of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    routes[`/api/v1/me/time-drafts/${id}/confirm`] = (call: StubCall) => {
      record(call);
      return withHeaders(reply(201, { id: `from-${id}` }), { 'X-Undo-Id': `u-${id}` });
    };
  }
  routes[`/api/v1/me/time/days/${TODAY}/confirm`] = (call: StubCall) => {
    record(call);
    return withHeaders({ entries: [], day_note: null }, { 'X-Undo-Id': 'u-day' });
  };
  routes[`/api/v1/me/time/days/${TODAY}/note`] = (call: StubCall) => {
    record(call);
    const body = call.body as { note: string | null };
    return { day_note: body.note === null ? null : { day: TODAY, note: body.note, updated_at: 2 } };
  };
  return routes;
}

async function myDay(writes: StubCall[], opts?: Options): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(writes, opts));
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.setViewportSize({ width: 1440, height: 900 });
  return h;
}

after(async () => {
  await closeBrowser();
});

void describe('Confirm day’s summary (LAI-503)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the split by kind, what stays, and the note goes with the confirm`, async () => {
      const writes: StubCall[] = [];
      const h = await myDay(writes);
      try {
        await setTheme(h.page, theme);
        await h.page.locator('[data-confirm-day]').click();
        const summary = h.page.locator('[data-confirm-summary]');
        await summary.waitFor({ timeout: 5_000 });
        // Today: e1 and e2 confirmed (1 h); d1, d3, d5 ready; d2 and d4 on nothing.
        assert.match(await summary.locator('[data-summary-sub]').innerText(), /to confirm/);
        assert.match(
          await summary.locator('[data-summary-sub]').innerText(),
          /1 h already confirmed/,
        );
        assert.match(
          await summary.locator('[data-summary-sub]').innerText(),
          /2 without a card stay/,
        );
        const kinds = await summary
          .locator('[data-summary-kind]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-summary-kind')));
        assert.ok(kinds.includes('building'), `no Building bar: ${kinds.join(',')}`);
        await summary.locator('[data-summary-note]').fill('Two meetings ran long.');
        await summary.locator('[data-summary-confirm]').click();
        await until(() => writes.filter((w) => w.path.endsWith('/confirm')).length === 3);
        await until(() => writes.some((w) => w.path.endsWith('/note')));
        const note = writes.find((w) => w.path.endsWith('/note'));
        assert.ok(note !== undefined, 'the note was not saved with a block-by-block confirm');
        assert.deepEqual(note.body, { note: 'Two meetings ran long.' });
        const toast = h.page.locator('[data-toast]');
        await toast.waitFor({ timeout: 10_000 });
        assert.match(await toast.innerText(), /note shared/);
      } finally {
        await h.close();
      }
    });
  }

  void test('every block ready: one request carrying the note', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes, { allReady: true });
    try {
      await h.page.locator('[data-confirm-day]').click();
      const summary = h.page.locator('[data-confirm-summary]');
      await summary.waitFor({ timeout: 5_000 });
      await summary.locator('[data-summary-note]').fill('All done.');
      await summary.locator('[data-summary-confirm]').click();
      await until(() => writes.some((w) => w.path === `/api/v1/me/time/days/${TODAY}/confirm`));
      assert.deepEqual(writes.find((w) => w.path.endsWith('/confirm'))?.body, {
        note: 'All done.',
      });
    } finally {
      await h.close();
    }
  });

  void test('with nothing to confirm the note saves alone, prefilled from the day', async () => {
    const writes: StubCall[] = [];
    const h = await myDay(writes, { note: 'Yesterday’s words', noDrafts: true });
    try {
      // No drafts: no Confirm day; the day's note has its own button.
      assert.equal(await h.page.locator('[data-confirm-day]').count(), 0);
      await h.page.locator('[data-day-note-button]').click();
      const summary = h.page.locator('[data-confirm-summary]');
      await summary.waitFor({ timeout: 5_000 });
      assert.equal(await summary.locator('[data-summary-note]').inputValue(), 'Yesterday’s words');
      assert.match(
        await summary.locator('[data-summary-sub]').innerText(),
        /Nothing left to confirm/,
      );
      assert.equal(await summary.locator('[data-summary-save-note]').isDisabled(), true);
      await summary.locator('[data-summary-note]').fill('Today’s words');
      await summary.locator('[data-summary-save-note]').click();
      await until(() => writes.some((w) => w.path.endsWith('/note')));
      assert.deepEqual(writes.find((w) => w.path.endsWith('/note'))?.body, {
        note: 'Today’s words',
      });
      await until(async () => (await summary.count()) === 0);
      assert.match(await h.page.locator('[data-toast]').innerText(), /Note saved/);
    } finally {
      await h.close();
    }
  });
});
