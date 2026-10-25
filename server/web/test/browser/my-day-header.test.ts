import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import {
  closeBrowser,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open, NOW, TODAY } from './my-day-clock.ts';
import { at, SETTINGS, weekData, weekStub, YESTERDAY } from './my-day-week.ts';

/**
 * The header from the owner's My day design (D-110, LAI-502): the day's
 * figures; Start timer with its popover, pill, pause, stop and the 409 that
 * opens the panel; Add time from the header, timed or not; Day settings with
 * Draft my time and Where you are; Who looked as a button; `?`; the
 * Draft-my-time-off banner; and a phone's header. Both themes.
 */

const SHOTS = process.env.LAIKA_SHOTS;

interface TimerRow {
  started_at: number;
  resumed_at: number;
  paused_at: number | null;
  accumulated_ms: number;
  tz: string;
  task: { id: string; key: string; title: string } | null;
  kind: string | null;
  title: string | null;
}

const LOOKED = {
  data: [
    {
      id: 'v2',
      viewer: { id: 'u9', name: 'Ada Lovelace' },
      kind: 'time',
      day: YESTERDAY,
      viewed_at: at(TODAY, 14, 2),
    },
    {
      id: 'v1',
      viewer: { id: 'u9', name: 'Ada Lovelace' },
      kind: 'local_activity',
      day: null,
      viewed_at: at(YESTERDAY, 9, 10),
    },
  ],
  next_cursor: null,
};

interface Options {
  readonly writes?: StubCall[];
  readonly timer?: TimerRow | null;
  readonly refuseStop?: boolean;
  readonly draftOff?: boolean;
}

/**
 * My day with a timer that lives in the stub: start, pause, resume and stop
 * change it, and every read of the day carries it, as the server's does.
 */
function stub(opts: Options = {}): ApiStub {
  const data = weekData();
  let timer: TimerRow | null = opts.timer ?? null;
  const settings = opts.draftOff === true ? { ...SETTINGS, draft_my_time: false } : SETTINGS;
  const routes: Record<string, unknown> = {};
  for (const [path, answer] of Object.entries(weekStub(data))) {
    routes[path] = path.startsWith('/api/v1/me/time?day=')
      ? () => ({
          ...(typeof answer === 'function'
            ? (answer as () => Record<string, unknown>)()
            : (answer as Record<string, unknown>)),
          settings,
          timer,
        })
      : answer;
  }
  const record = (call: StubCall): void => {
    opts.writes?.push(call);
  };
  routes['/api/v1/me/time-settings'] = (call: StubCall) => {
    if (call.method === 'PUT') record(call);
    return settings;
  };
  routes['/api/v1/me/analytics-views'] = LOOKED;
  routes['/api/v1/me/time/timer'] = (call: StubCall) => {
    record(call);
    if (call.method === 'DELETE') {
      timer = null;
      return reply(204, null);
    }
    const body = call.body as Record<string, unknown>;
    timer = {
      started_at: NOW,
      resumed_at: NOW,
      paused_at: null,
      accumulated_ms: 0,
      tz: 'UTC',
      task:
        typeof body.task === 'string'
          ? { id: 't11', key: String(body.task), title: 'Search matches keys' }
          : null,
      kind: typeof body.kind === 'string' ? String(body.kind) : null,
      title: typeof body.title === 'string' ? String(body.title) : null,
    };
    return reply(201, timer);
  };
  routes['/api/v1/me/time/timer/pause'] = (call: StubCall) => {
    record(call);
    if (timer !== null) timer = { ...timer, paused_at: NOW, accumulated_ms: 25 * 60_000 };
    return timer;
  };
  routes['/api/v1/me/time/timer/resume'] = (call: StubCall) => {
    record(call);
    if (timer !== null) timer = { ...timer, paused_at: null, resumed_at: NOW };
    return timer;
  };
  routes['/api/v1/me/time/timer/stop'] = (call: StubCall) => {
    record(call);
    if (opts.refuseStop === true) {
      return reply(409, {
        error: {
          code: 'conflict',
          message: 'That would count confirmed time twice: 11:30–12:00 already holds 30 min.',
          details: { reason: 'overlaps_confirmed' },
        },
      });
    }
    const made = {
      id: 'from-timer',
      day: TODAY,
      tz: 'UTC',
      started_at: NOW - 25 * 60_000,
      ended_at: NOW,
      minutes: 25,
      source: 'manual',
      task: timer?.task ?? null,
      project: null,
      note: null,
      kind: timer?.kind ?? null,
      title: timer?.title ?? null,
      description: null,
      revision: 1,
      created_at: 1,
      updated_at: 1,
    };
    timer = null;
    const today = data.get(TODAY) ?? { drafts: [], entries: [] };
    today.entries = [...today.entries, made];
    data.set(TODAY, today);
    return reply(201, { entry: made, crossed_midnight: false }, { 'X-Undo-Id': 'u-timer' });
  };
  routes['/api/v1/me/time-entries'] = (call: StubCall) => {
    record(call);
    const body = call.body as Record<string, unknown>;
    return reply(
      201,
      {
        id: 'n1',
        day: TODAY,
        tz: 'UTC',
        started_at: typeof body.started_at === 'number' ? body.started_at : null,
        ended_at: typeof body.ended_at === 'number' ? body.ended_at : null,
        minutes: Number(body.minutes),
        source: 'manual',
        task: null,
        project: null,
        note: null,
        kind: typeof body.kind === 'string' ? body.kind : null,
        title: typeof body.title === 'string' ? body.title : null,
        description: null,
        revision: 1,
        created_at: 1,
        updated_at: 1,
      },
      { 'X-Undo-Id': 'u-n1' },
    );
  };
  return routes;
}

async function myDay(opts: Options = {}): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(opts));
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.setViewportSize({ width: 1440, height: 900 });
  return h;
}

const RUNNING: TimerRow = {
  started_at: NOW - 25 * 60_000,
  resumed_at: NOW - 25 * 60_000,
  paused_at: null,
  accumulated_ms: 0,
  tz: 'UTC',
  task: null,
  kind: 'thinking',
  title: 'Keyboard steps',
};

async function shoot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

after(async () => {
  await closeBrowser();
});

void describe('the header (LAI-502)', () => {
  void test('says the day’s figures, and Start timer posts what was picked; the pill runs, pauses and stops', async () => {
    const writes: StubCall[] = [];
    const h = await myDay({ writes });
    try {
      // Today’s drafts come to 5 h 10 min, its two confirmed entries to 1 h:
      // the total beside the title, and what is still to review (LAI-509).
      const figures = await h.page.locator('[data-day-total]').innerText();
      assert.match(figures, /6 h 10 min/);
      assert.match(figures, /5 h 10 min to review/);

      await h.page.locator('[data-timer-start] > button').click();
      // The design's timer offers Building, Meeting and Thinking (LAI-516).
      await h.page.locator('[data-timer-kind="thinking"]').click();
      await h.page.locator('[data-timer-title]').fill('Keyboard steps');
      await h.page.locator('[data-timer-go]').click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time/timer'));
      assert.deepEqual(writes[0], {
        method: 'POST',
        path: '/api/v1/me/time/timer',
        body: { tz: 'UTC', kind: 'thinking', title: 'Keyboard steps' },
      });
      const pill = h.page.locator('[data-timer]');
      await pill.waitFor({ timeout: 10_000 });
      assert.equal(await pill.getAttribute('data-timer'), 'running');
      assert.match(await pill.locator('.myday-timer-label').innerText(), /Keyboard steps/);
      assert.match(await pill.locator('[data-timer-clock]').innerText(), /^\d+:\d\d$/);

      await pill.getByRole('button', { name: 'Pause timer' }).click();
      await until(async () => (await pill.getAttribute('data-timer')) === 'paused');
      assert.equal(await pill.locator('[data-timer-clock]').innerText(), '25:00');
      await pill.getByRole('button', { name: 'Resume timer' }).click();
      await until(async () => (await pill.getAttribute('data-timer')) === 'running');

      await pill.getByRole('button', { name: 'Stop timer and save' }).click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time/timer/stop'));
      await until(async () => (await h.page.locator('[data-timer]').count()) === 0);
      const toast = h.page.locator('[data-toast]');
      await toast.waitFor({ timeout: 10_000 });
      assert.match(await toast.innerText(), /25 min saved from the timer/);
      assert.equal(await toast.getByRole('button', { name: 'Undo' }).count(), 1);
      // The stopped time is the selected entry.
      await h.page.locator('[data-inspector-for="from-timer"]').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('a running timer on load, and T stops it; a 409 opens the panel with what the timer said', async () => {
    const writes: StubCall[] = [];
    const h = await myDay({ writes, timer: RUNNING, refuseStop: true });
    try {
      const pill = h.page.locator('[data-timer="running"]');
      await pill.waitFor({ timeout: 10_000 });
      assert.equal(await pill.locator('[data-timer-clock]').innerText(), '25:00');
      await h.page.keyboard.press('t');
      await until(() => writes.some((w) => w.path === '/api/v1/me/time/timer/stop'));
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 10_000 });
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /2:35.*3:00/);
      assert.equal(await panel.locator('[data-entry-title]').inputValue(), 'Keyboard steps');
      assert.equal(
        await panel.locator('[data-kind-pick="thinking"]').getAttribute('aria-pressed'),
        'true',
      );
      // The timer stands until the time is in by hand.
      assert.equal(await h.page.locator('[data-timer]').count(), 1);
      assert.match(await h.page.locator('[data-toast]').innerText(), /count confirmed time twice/);
      await panel.locator('[data-range-add]').click();
      await until(() =>
        writes.some((w) => w.method === 'DELETE' && w.path === '/api/v1/me/time/timer'),
      );
      const added = writes.find((w) => w.path === '/api/v1/me/time-entries');
      assert.ok(added !== undefined);
      assert.deepEqual(added.body, {
        day: TODAY,
        tz: 'UTC',
        minutes: 25,
        started_at: at(TODAY, 14, 35),
        ended_at: at(TODAY, 15, 0),
        kind: 'thinking',
        title: 'Keyboard steps',
      });
    } finally {
      await h.close();
    }
  });

  void test('Add time, and N, open the panel on the last free half hour before now; No set time posts a length alone', async () => {
    const writes: StubCall[] = [];
    const h = await myDay({ writes });
    try {
      await h.page.locator('[data-add-time]').click();
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 10_000 });
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /2:30.*3:00/);
      await h.page.keyboard.press('Escape');
      await until(async () => (await panel.count()) === 0);
      await h.page.keyboard.press('n');
      await panel.waitFor({ timeout: 10_000 });
      await panel.locator('[data-new-entry-untimed]').check();
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /No set time/);
      await panel.locator('[data-entry-title]').fill('Reading');
      await panel.locator('[data-range-add]').click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-entries'));
      assert.deepEqual(writes.find((w) => w.path === '/api/v1/me/time-entries')?.body, {
        day: TODAY,
        tz: 'UTC',
        minutes: 30,
        title: 'Reading',
      });
    } finally {
      await h.close();
    }
  });

  void test('Day settings holds Draft my time and Where you are with Follow my laptop; Who looked and ? are buttons', async () => {
    const h = await myDay();
    try {
      await h.page.locator('[data-day-settings] > button').click();
      const settings = h.page.locator('[data-day-settings]');
      assert.equal(await settings.getByRole('switch', { name: 'Draft my time' }).count(), 1);
      assert.match(await settings.innerText(), /Where you are/);
      assert.match(await settings.innerText(), /Follow my laptop/);
      await h.page.keyboard.press('Escape');
      await until(async () => (await settings.locator('.myday-pop-panel').count()) === 0);

      await until(async () => (await h.page.locator('[data-looked-count]').count()) === 1);
      assert.equal(await h.page.locator('[data-looked-count]').innerText(), '2');
      await h.page.locator('[data-who-looked] > button').click();
      await h.page.locator('[data-looked]').first().waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-looked]').count(), 2);
      await h.page.keyboard.press('Escape');

      await h.page.locator('[data-shortcuts-button]').click();
      const sheet = h.page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await sheet.waitFor({ timeout: 5_000 });
      assert.match(await sheet.innerText(), /Start or stop the timer/);
      assert.match(await sheet.innerText(), /Add time/);
      await h.page.keyboard.press('Escape');
      await until(async () => (await sheet.count()) === 0);
      assert.equal(await h.page.locator('[data-draft-off]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('Draft my time off says so in a banner, and Turn on turns it on', async () => {
    const writes: StubCall[] = [];
    const h = await myDay({ writes, draftOff: true });
    try {
      const banner = h.page.locator('[data-draft-off]');
      await banner.waitFor({ timeout: 10_000 });
      assert.match(await banner.innerText(), /Draft my time is off/);
      await banner.getByRole('button', { name: 'Turn on' }).click();
      await until(() => writes.some((w) => w.path === '/api/v1/me/time-settings'));
      assert.deepEqual(writes.find((w) => w.path === '/api/v1/me/time-settings')?.body, {
        draft_my_time: true,
      });
    } finally {
      await h.close();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: a phone walks the days with ‹ ›, a letter a day, icon buttons; the header holds at 1440`, async () => {
      const h = await myDay({ timer: RUNNING });
      try {
        await setTheme(h.page, theme);
        await h.page.locator('[data-timer="running"]').waitFor({ timeout: 10_000 });
        assert.equal(await h.page.locator('[data-day-nav]').isVisible(), false);
        await shoot(h.page, `header-${theme}-1440`);

        await h.page.setViewportSize({ width: 390, height: 844 });
        await until(async () => h.page.locator('[data-day-nav]').isVisible());
        assert.equal(await h.page.locator('.myday-week-letter').first().isVisible(), true);
        assert.equal(await h.page.locator('.myday-week-weekday').first().isVisible(), false);
        assert.equal(await h.page.locator('[data-add-time] .myday-head-text').isVisible(), false);
        assert.equal(await h.page.locator('.myday-timer-label').isVisible(), false);
        const sideways = await h.page.evaluate(() => {
          const main = document.querySelector('.shell-main') ?? document.scrollingElement;
          return main === null ? 0 : main.scrollWidth - main.clientWidth;
        });
        assert.ok(sideways <= 1, `the page scrolls sideways by ${String(sideways)}px`);
        await shoot(h.page, `header-${theme}-390`);
        await h.page.getByRole('button', { name: 'Previous day' }).click();
        await until(() => h.page.url().includes(`day=${YESTERDAY}`));
      } finally {
        await h.close();
      }
    });
  }
});
