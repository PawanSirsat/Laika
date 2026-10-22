/**
 * My day's AGENTS lane in a real browser (LAI-833): when the agent worked,
 * under the blocks, in its five minutes — blue where its session's split
 * ties it to a card, grey where nothing did — drawn only on a day the server
 * sent it for, each lane's label on its own row, in both themes.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import { closeBrowser, open, setTheme, type ApiStub, type Harness } from './harness.ts';
import { AGENT, at, TODAY, YESTERDAY, viewOf, weekData, weekStub } from './my-day-week.ts';

const LANE = [
  [at(TODAY, 9, 0), 300, 300],
  [at(TODAY, 9, 5), 240, 240],
  [at(TODAY, 9, 10), 120, 0],
  [at(TODAY, 13, 0), 180, 180],
];

/** Today with its AGENTS lane, and its SIGNALS lane when asked; yesterday without either. */
function stub(signals = false): ApiStub {
  const data = weekData();
  const routes: Record<string, unknown> = { ...weekStub(data) };
  routes[`/api/v1/me/time?day=${TODAY}`] = () => ({
    ...(viewOf(TODAY, data) as object),
    agent: { ...AGENT, lane: LANE },
    ...(signals
      ? { signal_times: { prompts: [[at(TODAY, 9, 10), 2]], commits: [[at(TODAY, 9, 40), 1]] } }
      : {}),
  });
  return routes;
}

async function openDay(day: string, signals = false): Promise<Harness> {
  const h = await open(`/my-day?day=${day}`, stub(signals));
  await h.page.locator('.myday-week').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
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

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  assert.ok(box !== null, `${what} has no box`);
  return box;
}

/** Where a label's text is drawn — its box may be taller than its words. */
async function textBox(locator: Locator, what: string) {
  const box = await locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  assert.ok(box.height > 0, `${what} draws no text`);
  return box;
}

const middle = (b: { y: number; height: number }): number => b.y + b.height / 2;
const within = (b: { y: number; height: number }, row: { y: number; height: number }) =>
  middle(b) >= row.y && middle(b) <= row.y + row.height;

after(async () => {
  await closeBrowser();
});

void describe('the AGENTS lane (LAI-833)', () => {
  for (const theme of ['Light', 'Dark']) {
    void test(`${theme}: when the agent worked sits under the blocks, blue on a card and grey on none`, async () => {
      const h = await openDay(TODAY);
      try {
        await setTheme(h.page, theme);
        const lane = h.page.locator('[data-agents-lane]');
        await lane.waitFor({ timeout: 10_000 });

        const runs = await h.page.locator('[data-agent-run]').evaluateAll((els) =>
          els.map((el) => ({
            kind: el.getAttribute('data-agent-run'),
            start: Number(el.getAttribute('data-agent-start')),
            title: el.getAttribute('title') ?? '',
            colour: getComputedStyle(el).backgroundColor,
          })),
        );
        // 9:00–9:10 on a card, 9:10–9:15 on none, 13:00–13:05 on a card.
        assert.deepEqual(
          runs.map((r) => [r.kind, r.start]),
          [
            ['card', 9 * 60],
            ['none', 9 * 60 + 10],
            ['card', 13 * 60],
          ],
        );
        assert.match(runs[0]?.title ?? '', /^Agent working .+ · 9 min$/);
        assert.match(runs[1]?.title ?? '', / · on no card$/);
        assert.notEqual(runs[0]?.colour, 'rgba(0, 0, 0, 0)', 'a bar on a card is invisible');
        assert.notEqual(runs[0]?.colour, runs[1]?.colour, 'on a card and on none look the same');

        for (const [i, [start, end]] of [
          [9 * 60, 9 * 60 + 10],
          [9 * 60 + 10, 9 * 60 + 15],
          [13 * 60, 13 * 60 + 5],
        ].entries()) {
          const box = await boxOf(h.page.locator('[data-agent-run]').nth(i), `bar ${String(i)}`);
          const left = await xOf(h.page, start ?? 0);
          const right = await xOf(h.page, end ?? 0);
          assert.ok(
            Math.abs(box.x - left) <= 2,
            `bar ${String(i)} starts at ${String(box.x)}, not ${String(left)}`,
          );
          assert.ok(
            Math.abs(box.x + box.width - right) <= 2,
            `bar ${String(i)} ends at ${String(box.x + box.width)}, not ${String(right)}`,
          );
        }

        const laneBox = await boxOf(lane, 'the lane');
        const rowBox = await boxOf(h.page.locator('.dayline-row'), 'the blocks’ row');
        assert.ok(laneBox.y >= rowBox.y + rowBox.height - 0.5, 'the lane is not under the blocks');
        assert.ok(
          within(await textBox(h.page.locator('.dayline-label-agents'), 'Agents'), laneBox),
          'Agents is not on the lane’s row',
        );
        assert.ok(
          within(await textBox(h.page.locator('.dayline-label-you'), 'You'), rowBox),
          'You is not on the blocks’ row',
        );
        assert.equal(await h.page.locator('.dayline-label-signals').count(), 0);

        assert.equal(
          await lane.getAttribute('aria-label'),
          'Agents: worked 14 min, 12 min of it on a card',
        );
        // The lane's column says how long, and how much of it on a card (LAI-883).
        assert.equal(
          await h.page.locator('.dayline-label-agents [data-agent-work]').innerText(),
          '14 min',
        );
        assert.match(
          await h.page.locator('.dayline-label-agents [data-agent-on-card]').innerText(),
          /^12 min on a card/,
        );
      } finally {
        await h.close();
      }
    });
  }

  void test('with both lanes, each of the three labels is on its own row', async () => {
    const h = await openDay(TODAY, true);
    try {
      await h.page.locator('[data-agents-lane]').waitFor({ timeout: 10_000 });
      const signals = await boxOf(h.page.locator('[data-signals-lane]'), 'the signals lane');
      const row = await boxOf(h.page.locator('.dayline-row'), 'the blocks’ row');
      const agents = await boxOf(h.page.locator('[data-agents-lane]'), 'the agents lane');
      assert.ok(signals.y + signals.height <= row.y + 0.5 && row.y + row.height <= agents.y + 0.5);
      for (const [label, box] of [
        ['.dayline-label-signals', signals],
        ['.dayline-label-you', row],
        ['.dayline-label-agents', agents],
      ] as const) {
        assert.ok(
          within(await textBox(h.page.locator(label), label), box),
          `${label} is off its row`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('a day the server sent no lane for has none, and no Agents label', async () => {
    const h = await openDay(YESTERDAY);
    try {
      await h.page.locator('.dayline-row').waitFor({ timeout: 10_000 });
      assert.equal(await h.page.locator('[data-agents-lane]').count(), 0);
      assert.equal(await h.page.locator('.dayline-label-agents').count(), 0);
      assert.equal(await h.page.locator('[data-agent-work]').count(), 0);
    } finally {
      await h.close();
    }
  });
});
