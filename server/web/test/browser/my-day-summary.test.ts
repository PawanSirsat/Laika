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
          /2 without a task stay in To review/,
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

  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: the dialog as designed (LAI-517) — Confirm and the weekday with ×, the bar, the legend in two columns, the box, the note’s words, Cancel and Confirm`, async () => {
      const writes: StubCall[] = [];
      const h = await myDay(writes);
      try {
        await setTheme(h.page, theme);
        await h.page.locator('[data-confirm-day]').click();
        const dialog = h.page.getByRole('dialog');
        await dialog.locator('[data-confirm-summary]').waitFor({ timeout: 5_000 });
        const weekday = new Date(`${TODAY}T00:00:00Z`).toLocaleDateString('en-GB', {
          timeZone: 'UTC',
          weekday: 'long',
        });
        assert.equal(
          (await dialog.locator('.myday-dialog-title').innerText()).trim(),
          `Confirm ${weekday}`,
        );
        const box = await dialog.boundingBox();
        assert.ok(box !== null);
        assert.equal(Math.round(box.width), 520);
        // The total in mono; one 10px bar in as many segments as the legend has keys.
        assert.match(
          await dialog
            .locator('[data-summary-total]')
            .evaluate((el) => getComputedStyle(el).fontFamily),
          /Mono/,
        );
        const bar = await dialog.locator('.myday-summary-segments').boundingBox();
        assert.equal(Math.round(bar?.height ?? 0), 10);
        const keys = await dialog.locator('[data-summary-kind]').count();
        assert.ok(keys > 0);
        assert.equal(await dialog.locator('.myday-summary-segment').count(), keys);
        assert.equal(
          await dialog
            .locator('.myday-summary-legend')
            .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
          2,
        );
        for (const row of await dialog.locator('[data-summary-kind]').allInnerTexts()) {
          assert.match(row.replace(/\s+/g, ' ').trim(), /^\S.* \d.* \d+%$/);
        }
        // e1, typed by hand, is the time Laika couldn't see: its range, then its kind.
        const off = dialog.locator('[data-summary-off]');
        assert.match(await off.innerText(), /30 min Laika couldn’t see, added by you/);
        assert.match(
          (await off.locator('li').first().innerText()).replace(/\s+/g, ' '),
          /^11:30 AM–12:00 PM Planning call General$/,
        );
        assert.equal(
          await dialog.locator('[data-summary-note]').getAttribute('placeholder'),
          'Optional. What moved, what’s blocked, what took thinking.',
        );
        assert.match(
          await dialog.innerText(),
          /Shared with owners and admins next to your confirmed time\./,
        );
        const buttons = await dialog.locator('.myday-summary-foot button').allInnerTexts();
        assert.equal(buttons.length, 2);
        assert.equal(buttons[0]?.trim(), 'Cancel');
        assert.match(buttons[1]?.trim() ?? '', /^Confirm \d/);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await until(async () => (await h.page.getByRole('dialog').count()) === 0);
        assert.equal(writes.length, 0, 'closing wrote something');
      } finally {
        await h.close();
      }
    });

    void test(`${theme}: the toast is a dark pill at the bottom centre of the page, 24px up and 92px over the bulk bar (LAI-517)`, async () => {
      const writes: StubCall[] = [];
      const h = await myDay(writes);
      try {
        await setTheme(h.page, theme);
        await h.page.locator('[data-confirm-day]').click();
        await h.page.locator('[data-summary-confirm]').click();
        const pill = h.page.locator('[data-toast]');
        await pill.waitFor({ timeout: 10_000 });
        const where = async () =>
          h.page.evaluate(() => {
            const toast = document.querySelector('[data-toast]');
            const column = document.querySelector('.myday-column');
            if (toast === null || column === null) return undefined;
            const t = toast.getBoundingClientRect();
            const c = column.getBoundingClientRect();
            const probe = document.createElement('span');
            probe.style.color = 'var(--text-primary)';
            document.body.append(probe);
            const ink = getComputedStyle(probe).color;
            probe.remove();
            return {
              up: Math.round(window.innerHeight - t.bottom),
              offCentre: Math.abs(t.left + t.width / 2 - (c.left + c.width / 2)),
              height: t.height,
              ground: getComputedStyle(toast).backgroundColor,
              ink,
            };
          });
        const first = await where();
        assert.ok(first !== undefined);
        assert.equal(first.up, 24);
        assert.ok(first.offCentre < 2, `off the column's centre by ${String(first.offCentre)}px`);
        assert.ok(first.height >= 40, `the pill is ${String(first.height)}px tall`);
        assert.equal(first.ground, first.ink, 'the pill is not the page’s ink');
        // A block ticked: the bulk bar shows, and the toast stands over it.
        await h.page.locator('[data-settle-row="d2"] .myday-check').check();
        await h.page.locator('[data-bulk-count]').waitFor({ timeout: 5_000 });
        assert.equal((await where())?.up, 92);
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
