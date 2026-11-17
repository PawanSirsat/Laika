/**
 * My day's *Meetings today* strip (LAI-1313) in a real browser, against a
 * stubbed API: today's attended Teams meetings not yet on the day, each with
 * *Add to My day* — the shared toast, its Undo the server's own undo, and
 * the day read again — and nothing at all where it cannot be acted on: a
 * password instance (not even a request), meetings sync off, another day,
 * nothing left to add. It fits a 390px phone in both themes.
 *
 * Pinned to 15:00 UTC today (`my-day-clock.ts`), so *today* does not depend
 * on the hour the suite runs.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import {
  closeBrowser,
  setTheme,
  until,
  withHeaders,
  type ApiStub,
  type Harness,
} from './harness.ts';
import { NOW, TODAY, open } from './my-day-clock.ts';
import { YESTERDAY, weekStub } from './my-day-week.ts';

const MIN = 60_000;
const at = (hhmm: string, day = TODAY): number => Date.parse(`${day}T${hhmm}:00Z`);

const MICROSOFT = {
  setup_required: false,
  sign_in: 'microsoft',
  system: { database: 'SQLite · WAL', migrations_applied: 1, smtp_configured: false },
};

function meeting(id: string, title: string, joined: number | null, over: object = {}) {
  return {
    id,
    title,
    organiser_email: 'grace@example.com',
    organiser_name: 'Grace Hopper',
    scheduled_start: joined ?? at('09:00'),
    scheduled_end: (joined ?? at('09:00')) + 30 * MIN,
    actual_start: null,
    actual_end: null,
    is_online: true,
    join_url: null,
    has_transcript: false,
    project: null,
    my_attendance: {
      invited: true,
      joined_at: joined,
      left_at: joined === null ? null : joined + 37 * MIN,
      minutes: joined === null ? 0 : 37,
      time_entry_id: null,
    },
    ...over,
  };
}

/** Today 10:04–10:41, 37 min, not on the day yet: the one the strip offers. */
const STANDUP = meeting('m1', 'Daily stand-up', at('10:04'));
/** Today, already added. */
const LOGGED = {
  ...meeting('m2', 'Budget sync', at('12:00')),
  my_attendance: { ...meeting('m2', '', at('12:00')).my_attendance, time_entry_id: 'e9' },
};
/** Yesterday, not added — a different day's business. */
const RETRO = meeting('m3', 'Retro', at('14:00', YESTERDAY));

const ENTRY = {
  id: 'e1',
  day: TODAY,
  tz: 'UTC',
  started_at: at('10:04'),
  ended_at: at('10:41'),
  minutes: 37,
  source: 'manual',
  task: null,
  project: null,
  note: null,
  kind: 'meeting',
  title: 'Daily stand-up',
  description: null,
  revision: 1,
  created_at: NOW,
  updated_at: NOW,
};

function stub(over: ApiStub = {}, list: readonly unknown[] = [STANDUP, LOGGED, RETRO]): ApiStub {
  return {
    ...weekStub(),
    '/api/v1/setup/status': MICROSOFT,
    '/api/v1/me/meetings': { enabled: true, data: list, next_cursor: null },
    ...over,
  };
}

const strip = (h: Harness) => h.page.locator('[data-meetings-today]');
const dayReads = (h: Harness) =>
  h.requests.filter((r) => r.method === 'GET' && r.url === `/api/v1/me/time?day=${TODAY}`).length;
const attendedReads = (h: Harness) =>
  h.requests.filter((r) => r.url.startsWith('/api/v1/me/meetings?filter=attended')).length;

async function openDay(path: string, routes: ApiStub, width = 1440): Promise<Harness> {
  return open(path, routes, {
    before: async (page) => {
      await page.setViewportSize({ width, height: 900 });
    },
  });
}

/** The day drawn and the strip's own read answered — so an absent strip is a decision. */
async function settled(h: Harness): Promise<void> {
  await h.page.locator('[data-dayline], [data-day-empty]').first().waitFor({ timeout: 20_000 });
  await h.page.waitForTimeout(500);
}

void after(async () => {
  await closeBrowser();
});

void describe('the strip', () => {
  void test('today’s attended meetings not yet added, above the Timeline, each linking to its meeting', async () => {
    const h = await openDay(`/my-day?day=${TODAY}`, stub());
    try {
      await strip(h).waitFor({ timeout: 20_000 });
      const rows = strip(h).locator('[data-meeting-today]');
      assert.equal(await rows.count(), 1, 'logged and yesterday’s meetings are left out');
      assert.match(await strip(h).innerText(), /Meetings today/i);
      const row = strip(h).locator('[data-meeting-today="m1"]');
      assert.equal(await row.locator('[data-meeting-when]').innerText(), '10:04–10:41 AM · 37 min');
      assert.equal(await row.getByRole('button', { name: 'Add to My day' }).count(), 1);

      // Above the Timeline: the strip comes first in the document.
      const above = await h.page.evaluate(() => {
        const s = document.querySelector('[data-meetings-today]');
        const t = document.querySelector('[data-dayline]');
        return (
          s !== null &&
          t !== null &&
          (s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        );
      });
      assert.ok(above, 'the strip is not above the Timeline');

      const link = row.getByRole('link', { name: 'Daily stand-up' });
      assert.equal(await link.getAttribute('href'), '/meetings?meeting=m1');
      await link.click();
      await h.page.waitForURL(
        (url) => url.pathname === '/meetings' && url.searchParams.get('meeting') === 'm1',
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('Add to My day: the toast, the day read again, and Undo through the server’s undo', async () => {
    let logged = false;
    const h = await openDay(
      `/my-day?day=${TODAY}`,
      stub({
        '/api/v1/me/meetings': () => ({
          enabled: true,
          data: logged
            ? [{ ...STANDUP, my_attendance: { ...STANDUP.my_attendance, time_entry_id: 'e1' } }]
            : [STANDUP],
          next_cursor: null,
        }),
        '/api/v1/meetings/m1/log-time': () => {
          logged = true;
          return withHeaders(ENTRY, { 'X-Undo-Id': 'undo-1' });
        },
        '/api/v1/me/time/undo': () => {
          logged = false;
          return { ok: true };
        },
      }),
    );
    try {
      await strip(h).waitFor({ timeout: 20_000 });
      const before = dayReads(h);
      await strip(h).getByRole('button', { name: 'Add to My day' }).click();

      const toast = h.page.locator('[data-toast]').last();
      await toast.waitFor({ timeout: 5_000 });
      assert.match(await toast.innerText(), /Added 37 min to My day/);
      const sent = h.calls.find((c) => c.path === '/api/v1/meetings/m1/log-time');
      assert.equal(sent?.method, 'POST');
      assert.deepEqual(sent?.body, { tz: 'UTC' });
      // The entry is on the day now: the day is read again, and the strip lets it go.
      await until(() => dayReads(h) > before);
      await strip(h).waitFor({ state: 'detached', timeout: 5_000 });

      await toast.getByRole('button', { name: 'Undo' }).click();
      await until(() => h.calls.some((c) => c.path === '/api/v1/me/time/undo'));
      assert.deepEqual(
        h.calls.find((c) => c.path === '/api/v1/me/time/undo'),
        { method: 'POST', path: '/api/v1/me/time/undo', body: { id: 'undo-1' } },
      );
      // Taken back off the day: it is offered again.
      await strip(h).locator('[data-meeting-today="m1"]').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });
});

void describe('nothing where it cannot be acted on', () => {
  void test('a password instance draws nothing and asks for no meetings at all', async () => {
    const h = await openDay(
      `/my-day?day=${TODAY}`,
      stub({ '/api/v1/setup/status': { ...MICROSOFT, sign_in: 'email' } }),
    );
    try {
      await settled(h);
      assert.equal(await strip(h).count(), 0);
      assert.equal(
        h.calls.filter((c) => c.path === '/api/v1/me/meetings').length,
        0,
        'a password instance asked for meetings',
      );
    } finally {
      await h.close();
    }
  });

  void test('meetings sync off: nothing', async () => {
    const h = await openDay(
      `/my-day?day=${TODAY}`,
      stub({ '/api/v1/me/meetings': { enabled: false, data: [], next_cursor: null } }),
    );
    try {
      await settled(h);
      assert.equal(await strip(h).count(), 0);
      assert.equal(attendedReads(h), 0, 'the strip read a list the instance does not sync');
    } finally {
      await h.close();
    }
  });

  void test('another day: nothing, and no read for it', async () => {
    const h = await openDay(`/my-day?day=${YESTERDAY}`, stub());
    try {
      await settled(h);
      assert.equal(await strip(h).count(), 0);
      assert.equal(attendedReads(h), 0);
    } finally {
      await h.close();
    }
  });

  void test('every meeting already added: nothing', async () => {
    const h = await openDay(`/my-day?day=${TODAY}`, stub({}, [LOGGED, RETRO]));
    try {
      await settled(h);
      await until(() => attendedReads(h) > 0);
      await h.page.waitForTimeout(300);
      assert.equal(await strip(h).count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('on a phone', () => {
  void test('at 390px the strip wraps, nothing scrolls sideways, in both themes', async () => {
    const h = await openDay(`/my-day?day=${TODAY}`, stub(), 390);
    try {
      await strip(h).waitFor({ timeout: 20_000 });
      const overflow = () =>
        h.page.evaluate(() => {
          const main = document.getElementById('main');
          const doc = document.documentElement;
          const s = document.querySelector('[data-meetings-today]');
          return Math.max(
            doc.scrollWidth - doc.clientWidth,
            main === null ? 0 : main.scrollWidth - main.clientWidth,
            s === null ? 0 : s.scrollWidth - s.clientWidth,
          );
        });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        assert.equal(await overflow(), 0, `${theme}: the strip scrolls sideways`);
        const button = strip(h).getByRole('button', { name: 'Add to My day' });
        assert.ok(await button.isVisible(), `${theme}: Add to My day is off screen`);
        const box = await button.boundingBox();
        assert.ok(box !== null && box.x + box.width <= 390, `${theme}: the button runs off`);
        // Text and surface have colours in this theme, not a missing token's transparent.
        const { colour, surface } = await strip(h).evaluate((el) => ({
          colour: getComputedStyle(el.querySelector('.myday-meetings-name') ?? el).color,
          surface: getComputedStyle(el).backgroundColor,
        }));
        assert.notEqual(colour, 'rgba(0, 0, 0, 0)');
        assert.notEqual(surface, 'rgba(0, 0, 0, 0)');
      }
    } finally {
      await h.close();
    }
  });
});
