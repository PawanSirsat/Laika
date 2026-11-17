/**
 * The Capacity screen (LAI-439), one global page since LAI-754, redesigned by
 * LAI-767: a search and filter chips, tiles that count, one card a person with
 * a status ring and a load badge, never-seen people folded into a line. LAI-991
 * compacted the cards to one shape — every block drawn, zeros included — and
 * added a List view whose bars share one scale, replacing the *Team load*
 * chart. LAI-992 took the *Show tasks* footer, the matched-task line and the
 * 14-day sparkline off the cards: Capacity reads no task. LAI-996 brought
 * the fortnight's three figures back, without the chart.
 *
 * The fixture is shaped like the owner's org (`capacity-org.ts`): five people,
 * three never seen, an owner with seven tasks in progress and two agents
 * running. It is served **as the server would answer each reader** — a member's
 * answer has no profile kind, no 14-day series and only running agents — so
 * the member/admin tests below hold the client to drawing what is sent, and
 * the server's tests hold the server to sending it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { capacityFor, NOW, orgStub } from './capacity-org.ts';
import { pick, valueOf } from './dropdown.ts';
import { closeBrowser, open, setTheme, until, type ApiStub } from './harness.ts';
import { tipText, tipTexts } from './tooltip-probe.ts';

void after(async () => {
  await closeBrowser();
});

/** The names on the cards, in the order drawn. */
async function cardNames(page: Page): Promise<string[]> {
  return (await page.locator('.cap-grid > .cap-card .cap-name').allInnerTexts()).map((n) =>
    n.trim(),
  );
}

/** The real cards, not the skeleton's, which share the class. */
async function ready(page: Page): Promise<void> {
  await page
    .locator('.cap-grid > .cap-card:not(.cap-card-skeleton)')
    .first()
    .waitFor({ timeout: 20_000 });
}

const card = (page: Page, name: string) =>
  page.locator('.cap-grid > .cap-card', { has: page.locator('.cap-name', { hasText: name }) });

/**
 * Open a card's Details (LAI-1222): the pipeline, every agent, the activity
 * and the spaces sit behind it, and are not in the page until it is pressed.
 */
async function expand(page: Page, name: string): Promise<void> {
  const button = page.getByRole('button', { name: `Show details for ${name}` });
  await button.click();
  await card(page, name).locator('.cap-details:not([hidden])').waitFor({ timeout: 5_000 });
}

/** A figure at the top of the page, by its `data-kpi` (LAI-1222). */
const kpi = (page: Page, id: string) => page.locator(`.cap-kpis [data-kpi="${id}"]`);

/** The summary line's link to a queue this page counts (LAI-1222). */
const out = (page: Page, id: 'review' | 'unlisted') => page.locator(`a.cap-out[data-out="${id}"]`);

void describe('who is here', () => {
  void test('online first, with a green ring and dot, and the status in words', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      // Wait for every card it asserts, not the first (LAI-715).
      await until(async () => (await cardNames(h.page)).join('|') === 'Pawan Sirsat|Bea Nkosi');
      assert.deepEqual(await cardNames(h.page), ['Pawan Sirsat', 'Bea Nkosi']);

      const pawan = card(h.page, 'Pawan Sirsat');
      assert.equal(await pawan.locator('.cap-dot-online').count(), 1, 'no green dot');
      assert.equal(await pawan.locator('.cap-ring-online').count(), 1, 'no green ring');
      assert.equal((await pawan.locator('.cap-status').innerText()).trim(), 'Online now');
      // The dot is decoration: the words above say the same to a screen reader.
      assert.equal(await pawan.locator('.cap-avatar-wrap').getAttribute('aria-hidden'), 'true');

      const bea = card(h.page, 'Bea Nkosi');
      assert.equal(await bea.locator('.cap-dot-online').count(), 0, 'away reads as online');
      assert.equal(await bea.locator('.cap-dot-away').count(), 1);
      assert.match(await bea.locator('.cap-status').innerText(), /^Away · 2[34] min$/);
      // The absolute time is one hover away.
      assert.match(await tipText(bea.locator('.cap-status')), /a board action/);

      // The green is a real colour of its own, in both themes.
      for (const theme of ['Light', 'Dark']) {
        await setTheme(h.page, theme);
        const colours = await h.page.evaluate(() =>
          ['.cap-dot-online', '.cap-dot-away'].map((selector) => {
            const el = document.querySelector(selector);
            return el === null ? '' : getComputedStyle(el).backgroundColor;
          }),
        );
        assert.notEqual(colours[0], '', `${theme}: no online dot`);
        assert.notEqual(colours[0], colours[1], `${theme}: online and away look alike`);
      }
    } finally {
      await h.close();
    }
  });

  void test('never-seen people fold into one line, and Show brings them back', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const line = h.page.locator('.cap-never');
      assert.match(await line.innerText(), /3 people never seen/);
      assert.match(await line.innerText(), /Cal Mokoena/);
      assert.equal(await h.page.locator('.cap-grid > .cap-card').count(), 2);

      await line.getByRole('button', { name: 'Show' }).click();
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 5);
      assert.equal(await h.page.locator('.cap-grid > .cap-card').count(), 5);
      assert.equal(await h.page.locator('.cap-never').count(), 0);
      assert.equal(
        (await card(h.page, 'Cal Mokoena').locator('.cap-status').innerText()).trim(),
        'Never seen',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('finding people', () => {
  void test('the search finds by name or by email, and says when nobody matches', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const search = h.page.getByRole('searchbox', { name: 'Search people' });

      // A never-seen person is shown when searched for, not folded away.
      await search.fill('dee');
      await until(async () => (await cardNames(h.page)).join() === 'Dee Pillay');
      assert.deepEqual(await cardNames(h.page), ['Dee Pillay']);

      await search.fill('BEA@KVELLD');
      await until(async () => (await cardNames(h.page)).join() === 'Bea Nkosi');
      assert.deepEqual(await cardNames(h.page), ['Bea Nkosi']);

      await search.fill('nobody-here');
      await h.page.getByText('Nobody matches').waitFor({ timeout: 5_000 });
      await h.page.getByRole('button', { name: 'Clear search and filters' }).click();
      await until(async () => (await cardNames(h.page)).length === 2);
      assert.deepEqual(await cardNames(h.page), ['Pawan Sirsat', 'Bea Nkosi']);
      assert.equal(await search.inputValue(), '');
    } finally {
      await h.close();
    }
  });

  void test('each figure is the filter for exactly its people (LAI-1222)', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const expected: readonly (readonly [string, readonly string[], number])[] = [
        // figure, the cards, how many fold into the never-seen line
        ['online', ['Pawan Sirsat'], 0],
        ['agents', ['Pawan Sirsat'], 0],
        ['heavy', ['Pawan Sirsat'], 0],
        ['overdue', ['Pawan Sirsat'], 0],
        ['none', [], 2],
        ['never', ['Dee Pillay', 'Cal Mokoena', 'Eli van Wyk'], 0],
        ['all', ['Pawan Sirsat', 'Bea Nkosi'], 3],
      ];
      // The chip row is gone: the figures are the only filters.
      assert.equal(await h.page.locator('.cap-chip').count(), 0, 'a chip row is still drawn');
      for (const [chip, names, folded] of expected) {
        const button = kpi(h.page, chip);
        await button.click();
        assert.equal(await button.getAttribute('aria-pressed'), 'true', `${chip} is not pressed`);
        await until(async () => (await cardNames(h.page)).join() === names.join());
        assert.deepEqual(await cardNames(h.page), names, chip);
        const line = h.page.locator('.cap-never');
        if (folded === 0) {
          assert.equal(await line.count(), 0, `${chip}: a fold line`);
        } else {
          assert.match(await line.innerText(), new RegExp(`^${String(folded)} people never seen`));
        }
      }
    } finally {
      await h.close();
    }
  });

  void test('a tile applies its filter, and another click lifts it', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const tile = kpi(h.page, 'online');
      assert.match(await tile.innerText(), /Online now\s*1\s*of 5 people/);
      await tile.click();
      await until(async () => (await cardNames(h.page)).length === 1);
      assert.deepEqual(await cardNames(h.page), ['Pawan Sirsat']);
      assert.equal(await tile.getAttribute('aria-pressed'), 'true');
      await tile.click();
      await until(async () => (await cardNames(h.page)).length === 2);
      assert.equal(await tile.getAttribute('aria-pressed'), 'false');
    } finally {
      await h.close();
    }
  });

  void test('sort: online first by default, then by name, last seen and load', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      await h.page.locator('.cap-never').getByRole('button', { name: 'Show' }).click();
      const sort = h.page.getByRole('combobox', { name: 'Sort' });
      const orderFor = async (value: string, want: readonly string[]) => {
        await pick(sort, value);
        await until(async () => (await cardNames(h.page)).join() === want.join());
        assert.deepEqual(await cardNames(h.page), want, value);
      };
      await orderFor('name', [
        'Bea Nkosi',
        'Cal Mokoena',
        'Dee Pillay',
        'Eli van Wyk',
        'Pawan Sirsat',
      ]);
      await orderFor('online', [
        'Pawan Sirsat',
        'Bea Nkosi',
        'Dee Pillay',
        'Cal Mokoena',
        'Eli van Wyk',
      ]);
      await orderFor('seen', [
        'Pawan Sirsat',
        'Bea Nkosi',
        'Cal Mokoena',
        'Dee Pillay',
        'Eli van Wyk',
      ]);
      await orderFor('load', [
        'Pawan Sirsat',
        'Bea Nkosi',
        'Dee Pillay',
        'Cal Mokoena',
        'Eli van Wyk',
      ]);
    } finally {
      await h.close();
    }
  });

  void test('a space narrows the counts to that space', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      assert.match(await pawan.locator('.cap-counts').innerText(), /7\s*in progress/);
      await pick(h.page.getByRole('combobox', { name: 'Space' }), 'p2');
      await until(async () =>
        /2\s*in progress/.test(await pawan.locator('.cap-counts').innerText()),
      );
      assert.match(await pawan.locator('.cap-counts').innerText(), /2\s*in progress/);
      // The total is the summary line's now, in the chosen space.
      assert.match(await h.page.locator('.screen-embedded-context').innerText(), /2 in progress/);
    } finally {
      await h.close();
    }
  });

  // D-092 item 3: a badge shown while a space is selected is that space's
  // load. The server sends each space's load (LAI-818); the card and the
  // Heavy load chip read it.
  void test('with a space chosen, the badge and Heavy load are that space’s load', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      const badge = async () => (await pawan.locator('.cap-load').innerText()).trim();
      assert.match(await badge(), /Heavy$/);

      const space = h.page.getByRole('combobox', { name: 'Space' });
      await pick(space, 'p1');
      await until(async () => (await badge()).endsWith('Normal'));
      assert.match(await badge(), /Normal$/);
      // Nobody is heavy in Laika, so the figure that would show nobody is gone.
      await until(async () => (await kpi(h.page, 'heavy').count()) === 0);
      assert.equal(await kpi(h.page, 'heavy').count(), 0, 'a zero Heavy load tile is drawn');

      // Switched on first, it stays — at 0 — so the reader can see and undo it.
      await pick(space, '');
      await until(async () => (await badge()).endsWith('Heavy'));
      const heavy = kpi(h.page, 'heavy');
      await heavy.click();
      await pick(space, 'p1');
      await until(async () => (await cardNames(h.page)).length === 0);
      assert.deepEqual(await cardNames(h.page), [], 'nobody is heavy in Laika');
      assert.equal(await heavy.getAttribute('aria-pressed'), 'true');
      assert.match(await heavy.innerText(), /Heavy load\s*0/);

      await pick(space, '');
      await until(async () => (await cardNames(h.page)).join() === 'Pawan Sirsat');
      assert.deepEqual(await cardNames(h.page), ['Pawan Sirsat']);
      assert.match(await badge(), /Heavy$/);
    } finally {
      await h.close();
    }
  });

  void test('a card counts in progress, to do and backlog, with review and overdue apart', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      const counts = (await pawan.locator('.cap-counts').innerText()).replace(/\s+/g, ' ').trim();
      assert.equal(counts, '7 in progress 3 to do');
      // The glance line: agents running and work in review, before any press.
      assert.match(
        await pawan.locator('.cap-keys').innerText(),
        /2\s*agents running\s*2\s*in review/,
      );
      assert.equal(await pawan.locator('.cap-waits').count(), 0, 'the pipeline is drawn closed');
      await expand(h.page, 'Pawan Sirsat');
      assert.equal(
        (await pawan.locator('.cap-waits').innerText()).replace(/\s+/g, ' ').trim(),
        '2 waiting on reviewers 2 due in 7 days 12 backlog',
      );
      // Overdue is its own badge beside the load, not a count inside it.
      assert.equal((await pawan.locator('.cap-overdue').innerText()).trim(), '1 overdue');
      assert.equal(await card(h.page, 'Bea Nkosi').locator('.cap-overdue').count(), 0);
      // A space chip's figure is committed work; backlog is on hover.
      const laika = pawan.locator('.cap-space', { hasText: 'Laika' });
      assert.match(await laika.innerText(), /^Laika\s*8\b/);
      assert.match(await tipText(laika), /8 committed in Laika.*12 in backlog/);
    } finally {
      await h.close();
    }
  });
});

void describe('what an owner sees and a member does not', () => {
  void test('an owner: profile kind, the three activity figures, a profile link, every agent, Unlisted', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      assert.match(await pawan.locator('.cap-role').innerText(), /Owner · Builder/);
      await expand(h.page, 'Pawan Sirsat');
      // Who did the fortnight's 79 (LAI-818): bookkeeping apart from both —
      // three figures under one stacked bar (LAI-1222).
      assert.match(await pawan.locator('.cap-activity-block .cap-label-note').innerText(), /· 79$/);
      assert.equal(
        (await pawan.locator('.cap-figs').innerText()).replace(/\s+/g, ' ').trim(),
        '21 by hand 40 by agents 18 bookkeeping',
      );
      assert.equal(
        await pawan.locator('.cap-act').getAttribute('aria-label'),
        '79 board actions in 14 days: 21 by hand, 40 by agents, 18 bookkeeping',
      );
      const parts = await pawan
        .locator('.cap-act-part')
        .evaluateAll((els) =>
          els.map((el) => Math.round(parseFloat((el as HTMLElement).style.width))),
        );
      assert.deepEqual(parts, [27, 51, 23], 'the bar is not drawn from the three figures');
      assert.equal(await h.page.locator('.cap-spark').count(), 0, 'a sparkline is drawn');
      // The link waits on the shell's `/me` as well as the cards, so wait for
      // it before counting (LAI-765's rule: wait for what you read).
      await pawan.locator('a.cap-name-link').waitFor({ timeout: 10_000 });
      assert.equal(await pawan.locator('a.cap-name-link').count(), 1, 'no profile link');
      const agents = async () =>
        (await pawan.locator('.cap-agent').allInnerTexts())
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .join('|');
      await until(
        async () => (await agents()) === 'Claude Code (running now)|Codex (running now)|Cursor',
      );
      assert.deepEqual(
        (await pawan.locator('.cap-agent').allInnerTexts()).map((t) =>
          t.replace(/\s+/g, ' ').trim(),
        ),
        ['Claude Code (running now)', 'Codex (running now)', 'Cursor'],
      );
      await until(async () => (await pawan.locator('.cap-agent-dot').count()) === 2);
      assert.equal(await pawan.locator('.cap-agent-dot').count(), 2, 'a running dot each');
      const unlisted = out(h.page, 'unlisted');
      await unlisted.waitFor({ timeout: 10_000 });
      assert.equal((await unlisted.innerText()).trim(), '1 unlisted to triage');
      assert.equal(await unlisted.getAttribute('href'), '/inbox?tab=unlisted');
    } finally {
      await h.close();
    }
  });

  void test('a member: presence and workload only — no kind, no activity, no link, no queue', async () => {
    const h = await open('/insights?tab=capacity', orgStub('member'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      // Still the facts every role has: status, role, workload, running agents.
      assert.equal((await pawan.locator('.cap-status').innerText()).trim(), 'Online now');
      assert.equal((await pawan.locator('.cap-role').innerText()).trim(), 'Owner');
      assert.match(await pawan.locator('.cap-counts').innerText(), /7\s*in progress/);
      await expand(h.page, 'Pawan Sirsat');
      assert.equal(await pawan.locator('.cap-agent-dot').count(), 2);

      assert.equal(await h.page.locator('.cap-kind').count(), 0, 'a profile kind is drawn');
      assert.equal(await h.page.locator('.cap-figs').count(), 0, 'activity is drawn');
      assert.equal(await h.page.locator('.cap-spark').count(), 0, 'a sparkline is drawn');
      assert.equal(await h.page.locator('a.cap-name-link').count(), 0, 'a profile link is drawn');
      assert.equal(await pawan.locator('.cap-agent', { hasText: 'Cursor' }).count(), 0);
      assert.equal(await out(h.page, 'unlisted').count(), 0);
      assert.deepEqual(
        h.calls.filter((c) => c.path === '/api/v1/unlisted'),
        [],
        'the client asked for the queue on behalf of a member',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('states', () => {
  void test('presence off: says so, keeps the workload, draws no status', async () => {
    const view = capacityFor('owner');
    const off: ApiStub = {
      ...orgStub('owner'),
      '/api/v1/presence': { enabled: false, present: [] },
      '/api/v1/capacity': {
        enabled: false,
        people: view.people.map((p) => ({
          ...p,
          status: null,
          last_seen: null,
          last_seen_via: null,
          active_sessions: 0,
          agents: [],
        })),
      },
    };
    const h = await open('/insights?tab=capacity', off);
    try {
      await ready(h.page);
      const text = await h.page.locator('.cap').innerText();
      assert.match(text, /presence is off for this organisation/i);
      assert.doesNotMatch(text, /nobody is working/i);
      // Five cards — no status means nothing to fold on — with their workload.
      assert.equal(await h.page.locator('.cap-grid > .cap-card').count(), 5);
      assert.match(
        await card(h.page, 'Pawan Sirsat').locator('.cap-counts').innerText(),
        /7\s*in progress/,
      );
      assert.equal(await h.page.locator('.cap-dot').count(), 0, 'a status dot is drawn');
      assert.equal(
        (await card(h.page, 'Bea Nkosi').locator('.cap-status').innerText()).trim(),
        'Presence is off',
      );
      // The figures that read presence are not drawn; the rest are.
      await kpi(h.page, 'overdue').waitFor({ timeout: 5_000 });
      for (const id of ['online', 'agents', 'never']) {
        assert.equal(await kpi(h.page, id).count(), 0, id);
      }
      assert.match(await kpi(h.page, 'all').innerText(), /People\s*5\s*presence is off/);
      assert.equal(await h.page.locator('.cap input[type="checkbox"]').count(), 0);
      // "Online first" reads presence, so the sort falls back to load.
      assert.equal(await valueOf(h.page.getByRole('combobox', { name: 'Sort' })), 'load');
    } finally {
      await h.close();
    }
  });

  void test('the skeleton is the final layout, so the cards land where it stood', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const h = await open('/insights?tab=capacity', orgStub('owner'), {
      before: async (page) => {
        await page.route('**/api/v1/capacity', async (route) => {
          await gate;
          await route.continue();
        });
      },
    });
    try {
      await h.page.locator('.cap-card-skeleton').first().waitFor({ timeout: 20_000 });
      await until(async () => (await h.page.locator('.cap-card-skeleton').count()) === 3);
      await until(async () => (await h.page.locator('.cap-tile-skeleton').count()) === 7);
      await until(async () => (await h.page.locator('.cap[aria-busy="true"]').count()) === 1);
      assert.equal(await h.page.locator('.cap-card-skeleton').count(), 3);
      assert.equal(await h.page.locator('.cap-tile-skeleton').count(), 7);
      assert.equal(await h.page.locator('.cap[aria-busy="true"]').count(), 1);
      const before = await h.page.locator('.cap-grid').boundingBox();

      release();
      await ready(h.page);
      const after = await h.page.locator('.cap-grid').boundingBox();
      assert.ok(before !== null && after !== null);
      assert.ok(
        Math.abs(before.y - after.y) <= 2,
        `the grid moved ${String(after.y - before.y)}px when the data landed`,
      );
    } finally {
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('at 390px nothing is clipped or pushes the page sideways', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await h.page.setViewportSize({ width: 390, height: 900 });
      await ready(h.page);
      await h.page.locator('.cap-never').getByRole('button', { name: 'Show' }).click();
      // Measure the page as drawn, not a guess at when it is (LAI-765): every
      // card, the review and unlisted counts (the shell's reads), and the
      // self-hosted font's widths, not the fallback's.
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 5);
      const review = out(h.page, 'review');
      await until(async () => (await review.innerText()).includes('3 waiting for review'), 10_000);
      await out(h.page, 'unlisted').waitFor({ timeout: 10_000 });
      await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
      const wide = await h.page.evaluate(() => ({
        page: document.documentElement.scrollWidth > window.innerWidth,
        cut: [...document.querySelectorAll('.cap-card, .cap-card *, .kpi-row .kpi *, .fbar *')]
          .filter(
            (el) =>
              el.scrollWidth > el.clientWidth + 1 &&
              getComputedStyle(el).overflowX !== 'visible' &&
              // Screen-reader text is clipped to a pixel on purpose.
              !el.classList.contains('visually-hidden') &&
              // An ellipsis is the intended answer to a long name.
              getComputedStyle(el).textOverflow !== 'ellipsis',
          )
          .map((el) => el.className),
        spill: [...document.querySelectorAll('.cap > *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .map((el) => el.className),
      }));
      assert.equal(wide.page, false, 'the page scrolls sideways');
      assert.deepEqual(wide.cut, [], `clipped: ${wide.cut.join(', ')}`);
      assert.deepEqual(wide.spill, [], `spills: ${wide.spill.join(', ')}`);
    } finally {
      await h.close();
    }
  });
});

void describe('live', () => {
  void test('re-reads when the tab comes back, and every 20 s', async () => {
    /*
     * Each answer carries its read's number in a name, so the test can wait for
     * an answer to be *drawn*, not only for its request to arrive (LAI-809).
     * Until the answer settles, `/capacity` is a request in flight, and a poll
     * that fires then joins it (`query-cache.ts`) rather than asking again — on
     * a slow runner the clock jump below landed first, and CI read 2 !== 3.
     */
    const answer = capacityFor('owner');
    let served = 0;
    const h = await open(
      '/insights?tab=capacity',
      {
        ...orgStub('owner'),
        '/api/v1/capacity': () => {
          served += 1;
          return {
            ...answer,
            people: answer.people.map((p) =>
              p.user_id === 'u2' ? { ...p, name: `Bea Nkosi ${String(served)}` } : p,
            ),
          };
        },
      },
      {
        before: async (page) => {
          await page.clock.install();
        },
      },
    );
    try {
      await ready(h.page);
      const reads = () => h.calls.filter((c) => c.path === '/api/v1/capacity').length;
      const drawn = async (read: number) =>
        (await cardNames(h.page)).includes(`Bea Nkosi ${String(read)}`);
      const first = reads();

      await h.page.clock.fastForward(5_000);
      await h.page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await until(() => reads() === first + 1);
      assert.equal(reads(), first + 1, 'coming back to the tab did not re-read');
      await until(() => drawn(first + 1));
      assert.equal(await drawn(first + 1), true, 'the re-read was not drawn');

      await h.page.clock.fastForward(20_000);
      await until(() => reads() === first + 2);
      assert.equal(reads(), first + 2, 'the 20 s poll did not re-read');
    } finally {
      await h.close();
    }
  });
});

void describe('links out', () => {
  void test('Waiting for review says 200+ when the server’s queue is capped', async () => {
    // D-092 item 5: a cap is labelled as one. The server returns its first 200
    // and `truncated: true`; the cap is not raised (LAI-818).
    const h = await open('/insights?tab=capacity', {
      ...orgStub('owner'),
      '/api/v1/review': {
        tasks: Array.from({ length: 200 }, (_, i) => ({
          task: { id: `q${String(i)}` },
          waiting_since: NOW - 86_400_000,
        })),
        truncated: true,
      },
    });
    try {
      await ready(h.page);
      const review = out(h.page, 'review');
      await review.waitFor({ timeout: 10_000 });
      await until(
        async () => (await review.innerText()).includes('200+ waiting for review'),
        10_000,
      );
      assert.match(await review.innerText(), /^200\+ waiting for review$/);
    } finally {
      await h.close();
    }
  });

  void test('Waiting for review and Unlisted work open their pages', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const review = out(h.page, 'review');
      await review.waitFor({ timeout: 10_000 });
      await until(async () => (await review.innerText()).includes('3 waiting for review'));
      assert.match(await review.innerText(), /^3 waiting for review$/);
      assert.equal(await review.getAttribute('href'), '/inbox?tab=review');

      // The sidebar's Inbox carries both counts added (LAI-796): 3 waiting for
      // review — all three this reader's to decide (D-146) — and 1 unlisted.
      // The shell reads its counts apart from the page, so the entry can be
      // drawn before the number is (LAI-765): wait for it, then assert it.
      const entry = h.page.locator('#sidebar .sidebar-link', { hasText: 'Inbox' });
      await until(async () => /Inbox\s*4/.test(await entry.innerText()), 10_000);
      assert.match(await entry.innerText(), /Inbox\s*4/);

      await out(h.page, 'unlisted').click();
      await h.page.waitForURL(
        (url) => url.pathname === '/inbox' && url.search === '?tab=unlisted',
        { timeout: 10_000 },
      );
    } finally {
      await h.close();
    }
  });

  void test('an old space-tab link opens the one global page (LAI-754, LAI-796)', async () => {
    // `/capacity?project=` is two moves old: Capacity left the space (LAI-754)
    // and became Insights' first tab (LAI-796). The link still lands there,
    // without the space.
    const h = await open('/capacity?project=laika', orgStub('owner'));
    try {
      await ready(h.page);
      await h.page.waitForURL(
        (url) => url.pathname === '/insights' && url.search === '?tab=capacity',
        { timeout: 10_000 },
      );
      assert.equal(await h.page.locator('.view-tab').count(), 0, 'the space tabs are drawn');
      assert.equal(await h.page.locator('.screen-page-title').innerText(), 'Insights');
      assert.match(await h.page.locator('.page-tab-active').innerText(), /Capacity/);
    } finally {
      await h.close();
    }
  });
});

/*
 * **The space bar has no Agents chip** (LAI-1233, the owner): it repeated the
 * board Filter's *Agent-created only* and read `/presence` on every tab.
 * Presence is now read only by Activity, the screen that draws it.
 */
void describe('presence is read where it is drawn (LAI-1233)', () => {
  void test('no Agents chip on a space; Activity still asks for presence', async () => {
    const h = await open('/activity?project=laika', orgStub('owner'));
    try {
      await h.page.locator('.space-name').waitFor({ timeout: 20_000 });
      await until(() => h.calls.some((c) => c.path === '/api/v1/presence'));
      assert.ok(
        h.calls.some((c) => c.path === '/api/v1/presence'),
        'Activity drew presence without asking for it',
      );
      assert.equal(await h.page.locator('.space-agents-start').count(), 0);
      assert.equal(
        await h.page.locator('.space-bar .space-chip', { hasText: /^Agents/ }).count(),
        0,
        'the Agents chip is back in the space bar',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('one shape a card, and a list of the same people (LAI-991)', () => {
  void test('every card draws every block, with a 0 where there is nothing', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      await h.page.locator('.cap-never').getByRole('button', { name: 'Show' }).click();
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 5);
      // Cal has no agents, no spaces, no tasks and no activity — and still
      // every block, each saying so with a figure.
      const cal = card(h.page, 'Cal Mokoena');
      // The glance line says nothing is going, in figures, before any press.
      assert.equal((await cal.locator('.cap-oldest').innerText()).trim(), 'nothing in progress');
      assert.equal(
        (await cal.locator('.cap-keys').innerText()).replace(/\s+/g, ' ').trim(),
        '0 agents running 0 in review Details',
      );
      await expand(h.page, 'Cal Mokoena');
      // Labels are drawn in capitals by CSS, and innerText reports them so.
      const labels = (await cal.locator('.cap-label').allInnerTexts()).map((t) =>
        t.replace(/\s+/g, ' ').trim().toLowerCase(),
      );
      assert.deepEqual(labels, [
        'pipeline',
        'agents 0 running',
        'activity 14 days · 0',
        'spaces 0 spaces',
      ]);
      assert.equal(
        (await cal.locator('.cap-figs').innerText()).replace(/\s+/g, ' ').trim(),
        '0 by hand 0 by agents 0 bookkeeping',
      );
      assert.equal(
        (await cal.locator('.cap-counts').innerText()).replace(/\s+/g, ' ').trim(),
        '0 in progress 0 to do',
      );
      assert.equal(
        (await cal.locator('.cap-waits').innerText()).replace(/\s+/g, ' ').trim(),
        '0 waiting on reviewers 0 due in 7 days 0 backlog',
      );
      assert.equal(
        (await cal.locator('.cap-agents-block .cap-quiet').innerText()).trim(),
        'No agents running',
      );
      assert.equal(
        (await cal.locator('.cap-spaces-block .cap-quiet').innerText()).trim(),
        'No spaces',
      );
      // Every card has the same blocks in the same order; only the figures differ.
      for (const name of ['Pawan Sirsat', 'Bea Nkosi', 'Dee Pillay', 'Eli van Wyk']) {
        await expand(h.page, name);
        const got = (await card(h.page, name).locator('.cap-label').allInnerTexts()).map((t) =>
          t.replace(/\s+/g, ' ').trim().split(' ')[0]?.toLowerCase(),
        );
        assert.deepEqual(got, ['pipeline', 'agents', 'activity', 'spaces'], name);
        assert.equal(await card(h.page, name).locator('.cap-tasks').count(), 0, `${name}: footer`);
      }
    } finally {
      await h.close();
    }
  });

  void test('a member sees the same blocks less Activity, and never a hole', async () => {
    const h = await open('/insights?tab=capacity', orgStub('member'));
    try {
      await ready(h.page);
      await h.page.locator('.cap-never').getByRole('button', { name: 'Show' }).click();
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 5);
      for (const name of ['Pawan Sirsat', 'Cal Mokoena']) {
        await expand(h.page, name);
        const got = (await card(h.page, name).locator('.cap-label').allInnerTexts()).map((t) =>
          t.replace(/\s+/g, ' ').trim().split(' ')[0]?.toLowerCase(),
        );
        assert.deepEqual(got, ['pipeline', 'agents', 'spaces'], name);
      }
      assert.equal(await h.page.locator('.cap-activity-block').count(), 0);
      assert.equal(await h.page.locator('.cap-tasks').count(), 0);
    } finally {
      await h.close();
    }
  });

  void test('cards in a row are one height', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await h.page.setViewportSize({ width: 1440, height: 1000 });
      await ready(h.page);
      await h.page.locator('.cap-never').getByRole('button', { name: 'Show' }).click();
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 5);
      await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
      // Three across at this width: the first row is Pawan, Bea, Dee — the
      // fullest card and an empty one side by side.
      const boxes = await h.page.evaluate(() =>
        [...document.querySelectorAll('.cap-grid > .cap-card')].map((el) => {
          const card = el.getBoundingClientRect();
          return { top: card.top, height: card.height };
        }),
      );
      const firstRow = boxes.filter((b) => Math.abs(b.top - boxes[0]!.top) < 1);
      assert.equal(firstRow.length, 3, 'three cards in the first row');
      for (const b of firstRow) {
        assert.ok(
          Math.abs(b.height - firstRow[0]!.height) <= 1,
          `a card is ${String(b.height)}px beside ${String(firstRow[0]!.height)}px`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('every figure says its rule on hover, the same words on a card and in the list', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      const titleOf = async (sel: string) => await tipText(pawan.locator(sel).first());
      assert.match(await titleOf('.cap-load'), /^Load is committed work/);
      assert.match(await titleOf('.cap-overdue'), /past their due date/);
      assert.match(await titleOf('.cap-status'), /an agent session/);
      await expand(h.page, 'Pawan Sirsat');
      const counts = await tipTexts(pawan.locator('.cap-counts .cap-count, .cap-waits .cap-count'));
      assert.equal(counts.length, 5);
      assert.ok(
        counts.every((t) => t.length > 20),
        `a count has no rule: ${counts.join(' | ')}`,
      );
      const figs = await tipTexts(pawan.locator('.cap-fig'));
      assert.deepEqual(
        figs.map((t) => t.split(' ').slice(0, 3).join(' ')),
        ['Board actions they', 'Board actions made', 'Sprint moves and'],
      );
      assert.match(await titleOf('.cap-agent'), /^Running now · last signal/);
      assert.match(await titleOf('.cap-agents-block .cap-label-note'), /live session/);

      // The list says the same things in the same words.
      await h.page.getByRole('button', { name: 'List', exact: true }).click();
      const row = h.page.locator('.cap-list tbody tr', { hasText: 'Pawan Sirsat' });
      await row.waitFor();
      assert.match(await tipText(row.locator('.cap-load')), /^Load is committed work/);
      assert.match(await tipText(row.locator('.cap-overdue')), /past their due date/);
      const cells = await tipTexts(row.locator('td.cap-list-num'));
      assert.ok(
        cells.every((t) => t.length > 20),
        `a column has no rule: ${cells.join(' | ')}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('List: the same people as rows, every column drawn, bars to one scale, remembered', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const cardsButton = h.page.getByRole('button', { name: 'Cards', exact: true });
      const listButton = h.page.getByRole('button', { name: 'List', exact: true });
      assert.equal(await cardsButton.getAttribute('aria-pressed'), 'true');
      await listButton.click();
      assert.equal(await listButton.getAttribute('aria-pressed'), 'true');
      const rows = h.page.locator('.cap-list tbody tr');
      await until(async () => (await rows.count()) === 2);
      // The never-seen fold applies to rows as it does to cards.
      assert.equal(await h.page.locator('.cap-grid').count(), 0);
      assert.match(await h.page.locator('.cap-never').innerText(), /3 people never seen/);
      await h.page.locator('.cap-never').getByRole('button', { name: 'Show' }).click();
      await until(async () => (await rows.count()) === 5);

      const heads = (await h.page.locator('.cap-list thead th').allInnerTexts()).map((t) =>
        t.replace(/\s+/g, ' ').trim().toLowerCase(),
      );
      assert.deepEqual(heads, [
        'person',
        'load',
        'workload',
        'in progress',
        'to do',
        'review',
        'agents',
        'hand · agents · bookkeeping',
        'spaces',
      ]);

      const cellsOf = async (name: string) =>
        (
          await h.page
            .locator('.cap-list tbody tr', { hasText: name })
            .locator('td')
            .allInnerTexts()
        ).map((t) => t.replace(/\s+/g, ' ').trim());
      const pawan = await cellsOf('Pawan Sirsat');
      assert.equal(pawan.length, 9);
      assert.deepEqual(pawan.slice(1), [
        'Heavy 1 overdue',
        '',
        '7',
        '3',
        '2',
        '2',
        '21 40 18',
        '2 Laika 8 committed, 12 in backlog, 1 waiting on reviewers Onroute 2 committed, 0 in backlog, 1 waiting on reviewers',
      ]);
      const cal = await cellsOf('Cal Mokoena');
      assert.deepEqual(cal.slice(1), ['No load', '', '0', '0', '0', '0', '0 0 0', '0 No spaces']);

      // One scale: Pawan's 10 committed fill the bar; Bea's 3 are three tenths of it.
      const widths = await h.page.locator('.cap-list tbody tr .cap-bar').evaluateAll((bars) =>
        bars.map((bar) => {
          const parts = [...bar.querySelectorAll('.cap-bar-part')] as HTMLElement[];
          return parts.reduce((sum, p) => sum + parseFloat(p.style.width), 0);
        }),
      );
      assert.equal(Math.round(widths[0]!), 100);
      assert.equal(Math.round(widths[1]!), 30);

      // Remembered for next time, in this browser.
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.capacity.view')),
        'list',
      );
      await cardsButton.click();
      await h.page.locator('.cap-grid').waitFor();
      assert.equal(
        await h.page.evaluate(() => localStorage.getItem('laika.capacity.view')),
        'cards',
      );
    } finally {
      await h.close();
    }
  });

  void test('List for a member: no activity column, no profile links', async () => {
    const h = await open('/insights?tab=capacity', orgStub('member'));
    try {
      await ready(h.page);
      await h.page.getByRole('button', { name: 'List', exact: true }).click();
      await h.page.locator('.cap-list tbody tr').first().waitFor();
      const heads = (await h.page.locator('.cap-list thead th').allInnerTexts()).map((t) =>
        t.replace(/\s+/g, ' ').trim().toLowerCase(),
      );
      assert.deepEqual(heads, [
        'person',
        'load',
        'workload',
        'in progress',
        'to do',
        'review',
        'agents',
        'spaces',
      ]);
      const pawan = (
        await h.page
          .locator('.cap-list tbody tr', { hasText: 'Pawan Sirsat' })
          .locator('td')
          .allInnerTexts()
      ).map((t) => t.replace(/\s+/g, ' ').trim());
      assert.equal(pawan.length, 8);
      assert.deepEqual(pawan.slice(3, 7), ['7', '3', '2', '2']);
      assert.equal(
        await h.page.locator('.cap-list a.cap-name-link').count(),
        0,
        'a member got profile links',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('no task is read (LAI-992)', () => {
  void test('Capacity asks for /capacity, /presence and /projects, never a task', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      await h.page.locator('.cap-never').getByRole('button', { name: 'Show' }).click();
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 5);
      // A deliberate *nothing happens* window: a read that was coming would
      // have gone with the cards.
      await h.page.waitForTimeout(300);
      const paths = h.calls.map((c) => c.path);
      assert.deepEqual(
        paths.filter((p) => p.startsWith('/api/v1/tasks')),
        [],
        `tasks were read: ${paths.join(', ')}`,
      );
      for (const want of ['/api/v1/capacity', '/api/v1/presence', '/api/v1/projects']) {
        assert.ok(paths.includes(want), `${want} was not read`);
      }
      assert.equal(await h.page.locator('.cap-working').count(), 0);
      assert.equal(await h.page.getByRole('button', { name: /Show tasks/ }).count(), 0);
      // The list view reads nothing more either.
      await h.page.getByRole('button', { name: 'List', exact: true }).click();
      await h.page.locator('.cap-list tbody tr').first().waitFor();
      await h.page.waitForTimeout(300);
      assert.deepEqual(
        h.calls.map((c) => c.path).filter((p) => p.startsWith('/api/v1/tasks')),
        [],
      );
    } finally {
      await h.close();
    }
  });
});

void describe('the view lives in the address (LAI-1201)', () => {
  const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

  void test('search, chip, space and sort are written to the URL and survive a reload', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const search = h.page.getByRole('searchbox', { name: 'Search people' });
      await search.fill('bea');
      await until(() => param(h.page, 'q') === 'bea');
      await pick(h.page.getByRole('combobox', { name: 'Sort' }), 'name');
      await until(() => param(h.page, 'sort') === 'name');
      await pick(h.page.getByRole('combobox', { name: 'Space' }), 'p1');
      await until(() => param(h.page, 'space') === 'p1');
      await kpi(h.page, 'online').click();
      await until(() => param(h.page, 'show') === 'online');

      await h.page.reload();
      await h.page.getByRole('searchbox', { name: 'Search people' }).waitFor({ timeout: 20_000 });
      const again = h.page.getByRole('searchbox', { name: 'Search people' });
      assert.equal(await again.inputValue(), 'bea', 'the reload forgot the search');
      assert.equal(await valueOf(h.page.getByRole('combobox', { name: 'Sort' })), 'name');
      assert.equal(await valueOf(h.page.getByRole('combobox', { name: 'Space' })), 'p1');
      assert.equal(await kpi(h.page, 'online').getAttribute('aria-pressed'), 'true');

      // Clearing empties the address of every filter it wrote.
      await again.fill('nobody-here');
      await h.page.getByRole('button', { name: 'Clear search and filters' }).click();
      await until(() => param(h.page, 'q') === null && param(h.page, 'show') === null);
      assert.equal(param(h.page, 'q'), null);
      assert.equal(param(h.page, 'show'), null);
      assert.equal(param(h.page, 'space'), null);
      assert.equal(param(h.page, 'sort'), 'name', 'clearing filters is not resetting the sort');
    } finally {
      await h.close();
    }
  });

  void test('a pasted link opens the filter it names; one it does not know is ignored', async () => {
    const h = await open('/insights?tab=capacity&show=never&sort=bogus', orgStub('owner'));
    try {
      await kpi(h.page, 'never').waitFor({ timeout: 20_000 });
      await until(async () => (await kpi(h.page, 'never').getAttribute('aria-pressed')) === 'true');
      assert.equal(
        await kpi(h.page, 'never').getAttribute('aria-pressed'),
        'true',
        '?show=never did not open the Never seen figure',
      );
      assert.equal(await valueOf(h.page.getByRole('combobox', { name: 'Sort' })), 'online');
    } finally {
      await h.close();
    }
  });
});

void describe('the list on a phone (LAI-1201)', () => {
  void test('at 390 the table scrolls inside its card with a fade and a hint; at 768 and 1440 the page never scrolls sideways', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      await h.page.getByRole('button', { name: 'List', exact: true }).click();
      await h.page.locator('.cap-list').waitFor({ timeout: 10_000 });
      for (const theme of ['Light', 'Dark']) {
        await h.page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(h.page, theme);
        for (const width of [1440, 768, 390]) {
          await h.page.setViewportSize({ width, height: 900 });
          const overflow = await h.page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(overflow <= 0, `${theme} at ${String(width)}: ${String(overflow)} px sideways`);
        }
        const cue = h.page.locator('.scroll-cue');
        await until(async () => (await cue.getAttribute('data-more-end')) === 'true');
        assert.equal(await cue.getAttribute('data-more-end'), 'true', `${theme}: no edge cue`);
        const hint = h.page.locator('.scroll-cue-hint');
        assert.ok(await hint.isVisible(), `${theme}: no hint to scroll`);
        const fade = cue.locator('.scroll-cue-edge-end');
        await until(
          async () => (await fade.evaluate((el) => getComputedStyle(el).opacity)) === '1',
        );
        assert.equal(await fade.evaluate((el) => getComputedStyle(el).opacity), '1');
        const region = h.page.getByRole('region', { name: 'People and their load' });
        assert.equal(await region.getAttribute('tabindex'), '0', 'the scroller is not focusable');
        // Scrolled to its end, the cue turns round.
        await region.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        await until(async () => (await cue.getAttribute('data-more-start')) === 'true');
        assert.equal(await cue.getAttribute('data-more-start'), 'true', `${theme}: no start cue`);
        assert.equal(await cue.getAttribute('data-more-end'), null);
        await region.evaluate((el) => {
          el.scrollLeft = 0;
        });
        await until(async () => (await cue.getAttribute('data-more-start')) === null);
        assert.equal(await cue.getAttribute('data-more-start'), null);
      }
      // Wide enough for every column (an owner's table, with its activity
      // column, is wider than a 1440 screen's content): no cue, no hint.
      await h.page.setViewportSize({ width: 1920, height: 1000 });
      await until(async () => (await h.page.locator('.scroll-cue-hint').count()) === 0);
      assert.equal(await h.page.locator('.scroll-cue-hint').count(), 0);
    } finally {
      await h.close();
    }
  });
});
