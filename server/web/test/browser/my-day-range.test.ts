import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  closeBrowser,
  reply,
  setTheme,
  until,
  type ApiStub,
  type Harness,
  type StubCall,
} from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { SETTINGS, weekData, weekStub } from './my-day-week.ts';

/**
 * A typed entry from a range dragged on the Timeline (D-108, LAI-897): the
 * drag, the clip, the panel, the post, the title rule, a 409 as the server
 * said it, Esc, the gap path, and the kind's colour in both themes.
 *
 * Today's fixture: d1 8:40–10:15, d2 10:40–11:20, e1 11:30–12:00, e2
 * 12:00–12:30 (confirmed), d3 13:00–14:50, d4 15:30–16:10. Drafts do not
 * bound a range; confirmed entries do. A stretch between two blocks of 20
 * minutes or more is a gap button and keeps its own handler, so the drags
 * here use the track after the last block (16:10 on) and the 10 minutes
 * before e1 (11:20–11:30), which is too short to be a gap.
 */

const MESSAGE = 'A day holds no more than 1440 minutes of a person’s time.';
const atMs = (h: number, m: number): number =>
  Date.parse(`${TODAY}T00:00:00Z`) + (h * 60 + m) * 60_000;

function stub(opts: { writes?: StubCall[]; refuse?: boolean; typed?: boolean } = {}): ApiStub {
  const data = weekData();
  const today = data.get(TODAY) ?? { drafts: [], entries: [] };
  if (opts.typed === true) {
    today.entries = [
      ...today.entries,
      {
        id: 'k1',
        day: TODAY,
        tz: 'UTC',
        started_at: atMs(16, 30),
        ended_at: atMs(17, 0),
        minutes: 30,
        source: 'manual',
        task: null,
        project: null,
        note: null,
        kind: 'support',
        title: 'Customer call',
        description: 'Renewal',
        revision: 1,
        created_at: 1,
        updated_at: 1,
      },
    ];
    data.set(TODAY, today);
  }
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes['/api/v1/me/time-settings'] = SETTINGS;
  routes['/api/v1/me/time-entries'] = (call: StubCall) => {
    opts.writes?.push(call);
    if (opts.refuse === true) {
      return reply(422, {
        error: { code: 'unprocessable', message: MESSAGE, details: { reason: 'day_full' } },
      });
    }
    const body = call.body as Record<string, unknown>;
    const made = {
      id: 'n1',
      day: TODAY,
      tz: 'UTC',
      started_at: typeof body.started_at === 'number' ? body.started_at : null,
      ended_at: typeof body.ended_at === 'number' ? body.ended_at : null,
      minutes: Number(body.minutes),
      source: 'manual',
      task:
        typeof body.task === 'string'
          ? { id: 'tb', key: String(body.task), title: 'Webhook retries back off' }
          : null,
      project: null,
      note: typeof body.note === 'string' ? body.note : null,
      kind: typeof body.kind === 'string' ? body.kind : null,
      title: typeof body.title === 'string' ? body.title : null,
      description: typeof body.description === 'string' ? body.description : null,
      revision: 1,
      created_at: 1,
      updated_at: 1,
    };
    today.entries = [...today.entries, made];
    data.set(TODAY, today);
    return reply(201, made, { 'X-Undo-Id': 'u-n1' });
  };
  return routes;
}

async function myDay(opts: Parameters<typeof stub>[0] = {}): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(opts));
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-block-id]').first().waitFor({ timeout: 10_000 });
  await h.page.setViewportSize({ width: 1440, height: 900 });
  await h.page.locator('[data-zoom="1"]').click();
  return h;
}

async function xOf(page: Page, minute: number): Promise<number> {
  const track = page.locator('[data-dayline-track]');
  const box = await track.boundingBox();
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  assert.ok(box !== null, 'the lane has no box');
  return box.x + ((minute - from * 60) / ((to - from) * 60)) * box.width;
}

/**
 * Drag on the You row from one minute to another. The track scrolls sideways
 * at 1×, so the drag's own start is brought into view first; measuring after
 * a scroll keeps the x positions true.
 */
async function drag(h: Harness, fromMinute: number, toMinute: number): Promise<void> {
  const row: Locator = h.page.locator('[data-dayline-row]');
  const track = h.page.locator('[data-dayline-track]');
  const from = Number(await track.getAttribute('data-from-hour'));
  const to = Number(await track.getAttribute('data-to-hour'));
  const width = await track.evaluate((el) => el.scrollWidth);
  const left = ((Math.min(fromMinute, toMinute) - from * 60) / ((to - from) * 60)) * width - 160;
  await h.page.locator('.dayline-scroller').evaluate((el, at) => {
    el.scrollLeft = Math.max(0, at);
  }, left);
  const box = await row.boundingBox();
  assert.ok(box !== null, 'the row has no box');
  const y = box.y + box.height * 0.6;
  await h.page.mouse.move(await xOf(h.page, fromMinute), y);
  await h.page.mouse.down();
  await h.page.mouse.move(await xOf(h.page, toMinute), y, { steps: 6 });
  await h.page.mouse.up();
}

void after(async () => {
  await closeBrowser();
});

void describe('a range dragged on the Timeline (LAI-897)', () => {
  void test('an empty stretch dragged becomes a range on five minutes, and the New entry panel opens', async () => {
    const h = await myDay();
    try {
      await drag(h, 16 * 60 + 13, 16 * 60 + 48);
      const picked = h.page.locator('.dayline-range-picked');
      await picked.waitFor({ timeout: 10_000 });
      assert.equal(await picked.getAttribute('data-range-start'), '975');
      assert.equal(await picked.getAttribute('data-range-end'), '1010');
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor();
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /4:15.*4:50/);
      assert.match(await panel.locator('[data-range-add]').innerText(), /^Add 35 min/);
    } finally {
      await h.close();
    }
  });

  void test('a drag from a gap runs over a confirmed block; one that starts on a block makes no range', async () => {
    const h = await myDay();
    try {
      // Begun inside the 11:20–11:30 gap: a drag on a gap draws a range, as the
      // design's does (LAI-510); a click on it still picks it (my-day-v2). It
      // runs on over the confirmed block at 11:30, as the design's range does
      // (LAI-528, D-113).
      await drag(h, 11 * 60 + 23, 11 * 60 + 50);
      const picked = h.page.locator('.dayline-range-picked');
      await picked.waitFor({ timeout: 10_000 });
      assert.equal(await picked.getAttribute('data-range-start'), '685');
      assert.equal(await picked.getAttribute('data-range-end'), '710');
      await h.page.keyboard.press('Escape');
      await until(async () => (await picked.count()) === 0);
      await drag(h, 11 * 60 + 45, 12 * 60 + 50);
      await h.page.waitForTimeout(300);
      assert.equal(await h.page.locator('.dayline-range').count(), 0);
      assert.equal(await h.page.locator('[data-inspector="range"]').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('kind, title and description, then Add: the exact range is posted and the new block wears its kind', async () => {
    const calls: StubCall[] = [];
    const h = await myDay({ writes: calls });
    try {
      await drag(h, 16 * 60 + 13, 16 * 60 + 48);
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 10_000 });
      await panel.locator('[data-kind-pick="meeting"]').click();
      await panel.locator('[data-entry-title]').fill('Standup');
      await panel.locator('[data-entry-description]').fill('Who is on what');
      await panel.locator('[data-range-add]').click();
      await until(() => calls.length === 1);
      assert.deepEqual(calls[0]?.body, {
        day: TODAY,
        tz: 'UTC',
        minutes: 35,
        started_at: atMs(16, 15),
        ended_at: atMs(16, 50),
        kind: 'meeting',
        title: 'Standup',
        description: 'Who is on what',
      });
      const block = h.page.locator('[data-block-id="n1"]');
      await block.waitFor({ timeout: 10_000 });
      assert.equal(await block.getAttribute('data-entry-kind'), 'meeting');
      assert.ok((await block.getAttribute('class'))?.includes('dayline-kind-meeting'));
      assert.match(await block.locator('.dayline-block-top').innerText(), /Standup/);
      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        const [painted, token] = await block.evaluate((el) => {
          const body = el.querySelector('.dayline-block-body')!;
          const probe = document.createElement('div');
          probe.style.background = 'var(--kind-meeting-bg)';
          document.body.append(probe);
          const want = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return [getComputedStyle(body).backgroundColor, want];
        });
        assert.equal(painted, token, `${theme}: the block is not the kind's colour`);
      }
      // The panel gave way to the new entry.
      assert.equal(await h.page.locator('[data-inspector="entry"]').count(), 1);
    } finally {
      await h.close();
    }
  });

  void test('with General a title is asked for; with a card it is not', async () => {
    const calls: StubCall[] = [];
    const h = await myDay({ writes: calls });
    try {
      await drag(h, 16 * 60 + 13, 16 * 60 + 48);
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 10_000 });
      await panel.locator('[data-range-add]').click();
      await panel.locator('[data-new-entry-error]').waitFor();
      assert.equal(calls.length, 0, 'posted without a title');
      await panel
        .getByRole('button', { name: /^LAI-\d+/ })
        .first()
        .click();
      await panel.locator('[data-range-add]').click();
      await until(() => calls.length === 1);
      assert.equal(typeof calls[0]?.body, 'object');
      assert.match(String((calls[0]?.body as { task?: string }).task), /^LAI-\d+$/);
      assert.equal((calls[0]?.body as { title?: string }).title, undefined);
    } finally {
      await h.close();
    }
  });

  void test('a refusal from the server is shown as the server said it', async () => {
    const calls: StubCall[] = [];
    const h = await myDay({ writes: calls, refuse: true });
    try {
      await drag(h, 16 * 60 + 13, 16 * 60 + 48);
      const panel = h.page.locator('[data-inspector="range"]');
      await panel.waitFor({ timeout: 10_000 });
      await panel.locator('[data-entry-title]').fill('Standup');
      await panel.locator('[data-range-add]').click();
      await until(() => calls.length === 1);
      await h.page.getByText(MESSAGE).first().waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('a gap’s Add time here opens the same panel with the gap as its range', async () => {
    const h = await myDay();
    try {
      await h.page.locator('[data-gap-start="750"]').click();
      const panel = h.page.locator('[data-inspector="gap"]');
      await panel.locator('[data-new-entry]').waitFor({ timeout: 10_000 });
      assert.match(await panel.locator('[data-new-entry-range]').innerText(), /12:30.*1:00/);
    } finally {
      await h.close();
    }
  });

  void test('an entry with a title and a kind shows its title and wears the kind; the panel edits them', async () => {
    const h = await myDay({ typed: true });
    try {
      const block = h.page.locator('[data-block-id="k1"]');
      await block.waitFor({ timeout: 10_000 });
      // Wide enough for its name to fit whole.
      await h.page.locator('[data-zoom="2"]').click();
      await until(async () =>
        (await block.locator('.dayline-block-top').innerText()).includes('Customer call'),
      );
      assert.equal(await block.getAttribute('data-entry-kind'), 'support');
      assert.match(await block.locator('.dayline-block-top').innerText(), /Customer call/);
      await block.locator('.dayline-block-body').click();
      const panel = h.page.locator('[data-inspector="entry"]');
      await panel.waitFor();
      assert.equal(
        await panel.locator('[data-kind-pick="support"]').getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(await panel.locator('[data-entry-title]').inputValue(), 'Customer call');
      assert.equal(await panel.locator('[data-entry-description]').inputValue(), 'Renewal');
    } finally {
      await h.close();
    }
  });
});
