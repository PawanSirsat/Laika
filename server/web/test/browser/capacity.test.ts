/**
 * The Capacity screen (LAI-439), one global page since LAI-754, redesigned by
 * LAI-767: a search and filter chips, tiles that count, one card a person with
 * a status ring and a load badge, never-seen people folded into a line, and a
 * *Team load* chart.
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
import { capacityFor, LAIKA, NOW, orgStub, PRESENCE, task } from './capacity-org.ts';
import { pick, valueOf } from './dropdown.ts';
import { closeBrowser, open, refuse, setTheme, until, type ApiStub } from './harness.ts';

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
      assert.match(
        (await bea.locator('.cap-status').getAttribute('title')) ?? '',
        /a board action/,
      );

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

  void test('each filter chip shows exactly its people', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const expected: readonly (readonly [string, readonly string[], number])[] = [
        // chip, the cards, how many fold into the never-seen line
        ['Online now', ['Pawan Sirsat'], 0],
        ['Agents running', ['Pawan Sirsat'], 0],
        ['Heavy load', ['Pawan Sirsat'], 0],
        ['Overdue', ['Pawan Sirsat'], 0],
        ['No load', [], 2],
        ['Never seen', ['Dee Pillay', 'Cal Mokoena', 'Eli van Wyk'], 0],
        ['All', ['Pawan Sirsat', 'Bea Nkosi'], 3],
      ];
      for (const [chip, names, folded] of expected) {
        const button = h.page.locator('.cap-chip', { hasText: chip });
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
      const tile = h.page.locator('.cap-tile', { hasText: 'Online now' });
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
      assert.match(
        await h.page.locator('.cap-tile', { hasText: 'In progress' }).innerText(),
        /In progress\s*2/,
      );
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

      const heavy = h.page.locator('.cap-chip', { hasText: 'Heavy load' });
      await heavy.click();
      await until(async () => (await cardNames(h.page)).length === 0);
      assert.deepEqual(await cardNames(h.page), [], 'nobody is heavy in Laika');

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
      assert.equal(counts, '7 in progress 3 to do 12 backlog');
      assert.match(await pawan.locator('.cap-waits').innerText(), /2\s*waiting on reviewers/);
      // Overdue is its own badge beside the load, not a count inside it.
      assert.equal((await pawan.locator('.cap-overdue').innerText()).trim(), '1 overdue');
      assert.equal(await card(h.page, 'Bea Nkosi').locator('.cap-overdue').count(), 0);
      // A space chip's figure is committed work; backlog is on hover.
      const laika = pawan.locator('.cap-space', { hasText: 'Laika' });
      assert.match(await laika.innerText(), /^Laika\s*8\b/);
      assert.match(
        (await laika.getAttribute('title')) ?? '',
        /8 committed in Laika.*12 in backlog/,
      );
    } finally {
      await h.close();
    }
  });
});

void describe('what an owner sees and a member does not', () => {
  void test('an owner: profile kind, 14-day activity, a profile link, every agent, Unlisted', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      assert.match(await pawan.locator('.cap-role').innerText(), /Owner · Builder/);
      assert.equal(await pawan.locator('.cap-spark-bar').count(), 14);
      // Who did the fortnight's 79 (LAI-818): bookkeeping apart from both.
      assert.match(await pawan.locator('.cap-spark-block .cap-label-note').innerText(), /· 79$/);
      assert.equal(
        (await pawan.locator('.cap-spark-split').innerText()).replace(/\s+/g, ' ').trim(),
        '21 by hand 40 by agents 18 bookkeeping',
      );
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
      const unlisted = h.page.locator('.cap-tile-unlisted');
      assert.match(await unlisted.innerText(), /Unlisted work\s*1/);
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
      assert.equal(await pawan.locator('.cap-agent-dot').count(), 2);

      assert.equal(await h.page.locator('.cap-kind').count(), 0, 'a profile kind is drawn');
      assert.equal(await h.page.locator('.cap-spark').count(), 0, 'activity is drawn');
      assert.equal(await h.page.locator('.cap-spark-split').count(), 0, 'the split is drawn');
      assert.equal(await h.page.locator('a.cap-name-link').count(), 0, 'a profile link is drawn');
      assert.equal(await pawan.locator('.cap-agent', { hasText: 'Cursor' }).count(), 0);
      assert.equal(await h.page.locator('.cap-tile-unlisted').count(), 0);
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
      for (const chip of ['Online now', 'Agents running', 'Never seen']) {
        assert.equal(await h.page.locator('.cap-chip', { hasText: chip }).count(), 0, chip);
      }
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
      await until(async () => (await h.page.locator('.cap-tile-skeleton').count()) === 6);
      await until(async () => (await h.page.locator('.cap[aria-busy="true"]').count()) === 1);
      assert.equal(await h.page.locator('.cap-card-skeleton').count(), 3);
      assert.equal(await h.page.locator('.cap-tile-skeleton').count(), 6);
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
      // card, the matched task (its own read), the review and unlisted counts
      // (the shell's reads), and the self-hosted font's widths, not the
      // fallback's.
      await until(async () => (await h.page.locator('.cap-grid > .cap-card').count()) === 5);
      await h.page.locator('.cap-working').waitFor({ timeout: 10_000 });
      const review = h.page.locator('.cap-tile', { hasText: 'Waiting for review' });
      await until(async () => /Waiting for review\s*3/.test(await review.innerText()), 10_000);
      await h.page.locator('.cap-tile-unlisted').waitFor({ timeout: 10_000 });
      await h.page.evaluate(() => document.fonts.ready.then(() => undefined));
      const wide = await h.page.evaluate(() => ({
        page: document.documentElement.scrollWidth > window.innerWidth,
        cut: [...document.querySelectorAll('.cap-card, .cap-card *, .cap-tiles *, .cap-toolbar *')]
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

void describe('tasks are drawn only when asked for', () => {
  void test('only the matched task is read until Show tasks; then theirs', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      // The session's task, resolved to a key: "Claude Code · working on LAI-9".
      await pawan.locator('.cap-working').waitFor({ timeout: 10_000 });
      assert.match(
        await pawan.locator('.cap-working').innerText(),
        /Claude Code · working on\s*LAI-9/,
      );
      // A deliberate *nothing happens* window, which no condition can end
      // early (`until`'s doc; LAI-765 kept these): a folded task must not be
      // read, and a read that was coming would have gone with the matched one.
      await h.page.waitForTimeout(300);
      const tasksRead = () =>
        h.calls
          .map((c) => c.path)
          .filter((p) => p.startsWith('/api/v1/tasks/'))
          .sort();
      assert.deepEqual(tasksRead(), ['/api/v1/tasks/t1'], 'folded tasks were read');

      const toggle = pawan.getByRole('button', { name: /Show tasks/ });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.equal(
        await pawan.getByRole('button', { name: /Hide tasks/ }).getAttribute('aria-expanded'),
        'true',
      );
      await pawan.locator('button.cap-task', { hasText: 'ONR-360' }).waitFor({ timeout: 10_000 });
      await until(async () => (await pawan.locator('button.cap-task').count()) === 7, 10_000);
      assert.equal(await pawan.locator('button.cap-task').count(), 7);
      // Bea's are not drawn, so not read.
      assert.equal(tasksRead().includes('/api/v1/tasks/t10'), false);
    } finally {
      await h.close();
    }
  });

  /*
   * LAI-755: Capacity spans every space, so a task is usually in a space other
   * than the one last opened. It opens in its own.
   */
  void test('a task opens in its own space, not the last one opened (LAI-755)', async () => {
    const web = { ...LAIKA, id: 'p9', slug: 'laika-web', name: 'Laika Web', prefix: 'LW' };
    const lw1 = task('t9', 'LW-1', 'Toolbar reads its own width', 'in_progress', web);
    const board = (slug: string, tasks: unknown[]): ApiStub => ({
      [`/api/v1/projects/${slug}/tasks`]: { data: tasks, next_cursor: null },
      [`/api/v1/projects/${slug}/members`]: { members: [] },
      [`/api/v1/projects/${slug}/sprints`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${slug}/activity`]: { data: [], next_cursor: null },
      [`/api/v1/projects/${slug}/tags`]: { tags: [] },
      [`/api/v1/projects/${slug}/mentionable`]: { users: [] },
    });
    const view = capacityFor('owner');
    const stub: ApiStub = {
      ...orgStub('owner'),
      ...board('laika', []),
      ...board('laika-web', [lw1]),
      '/api/v1/projects': { data: [LAIKA, web], next_cursor: null },
      '/api/v1/projects/laika-web': web,
      '/api/v1/org': {
        id: 'o',
        name: 'Kvell',
        presence_enabled: true,
        created_at: 1,
        updated_at: 1,
      },
      '/api/v1/capacity': {
        ...view,
        people: view.people.map((p) =>
          p.user_id === 'u2' ? { ...p, in_progress_tasks: ['t9'] } : p,
        ),
      },
      '/api/v1/tasks/t9': lw1,
      '/api/v1/tasks/t9/comments': { data: [], next_cursor: null },
      '/api/v1/tasks/t9/watchers': { watchers: [] },
    };

    // Laika is the space last opened.
    const h = await open('/board?project=laika', stub);
    try {
      await h.page.locator('.board-bar').waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => {
        history.pushState({}, '', '/capacity');
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await ready(h.page);
      const bea = card(h.page, 'Bea Nkosi');
      await bea.getByRole('button', { name: /Show tasks/ }).click();
      const row = bea.locator('button.cap-task', { hasText: 'LW-1' });
      await row.waitFor({ timeout: 10_000 });
      await row.click();

      await h.page.waitForURL((url) => url.pathname === '/board', { timeout: 10_000 });
      const url = new URL(h.page.url());
      assert.equal(url.searchParams.get('project'), 'laika-web', 'not the task’s own space');
      assert.equal(url.searchParams.get('task'), 't9', 'the task is not opened by id');

      // `.drawer` is a frame whose slot the task panel fills afterwards, so it
      // exists empty first (LAI-765: GitHub's runner read '' here). Wait for
      // the content, then assert it.
      const drawer = h.page.locator('.drawer');
      await drawer.waitFor({ timeout: 10_000 });
      await until(async () => {
        const text = await drawer.innerText();
        return text.includes('LW-1') && text.includes('Toolbar reads its own width');
      }, 10_000);
      assert.match(await drawer.innerText(), /LW-1/);
      assert.match(await drawer.innerText(), /Toolbar reads its own width/);
    } finally {
      await h.close();
    }
  });

  void test('a task that failed to resolve is asked for again on the next poll', async () => {
    let tries = 0;
    const flaky: ApiStub = {
      ...orgStub('owner'),
      '/api/v1/tasks/t2': () => {
        tries += 1;
        return tries === 1
          ? refuse(503, 'unavailable', 'Try again.')
          : task('t2', 'LAI-12', 'Heartbeat retention job', 'in_progress');
      },
    };
    const h = await open('/insights?tab=capacity', flaky, {
      before: async (page) => {
        await page.clock.install();
      },
    });
    try {
      await ready(h.page);
      const pawan = card(h.page, 'Pawan Sirsat');
      await pawan.getByRole('button', { name: /Show tasks/ }).click();
      await pawan.locator('button.cap-task', { hasText: 'LAI-9' }).waitFor({ timeout: 10_000 });
      await until(() => tries === 1);
      assert.equal(tries, 1);
      // Wait for t2's failure to settle, not only to be asked (LAI-809): t3–t7
      // resolve in the same `Promise.all` as t2, so six are drawn only once its
      // 503 is back. A poll that fires while t2 is still in flight joins that
      // request rather than asking again.
      await until(async () => (await pawan.locator('button.cap-task').count()) === 6);
      assert.equal(await pawan.locator('button.cap-task').count(), 6);
      assert.equal(await pawan.locator('button.cap-task', { hasText: 'LAI-12' }).count(), 0);

      await h.page.clock.fastForward(21_000);
      await pawan.locator('button.cap-task', { hasText: 'LAI-12' }).waitFor({ timeout: 10_000 });
      assert.equal(tries, 2);
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
      const review = h.page.locator('.cap-tile', { hasText: 'Waiting for review' });
      await until(async () => /Waiting for review\s*200\+/.test(await review.innerText()), 10_000);
      assert.match(await review.innerText(), /Waiting for review\s*200\+/);
    } finally {
      await h.close();
    }
  });

  void test('Waiting for review and Unlisted work open their pages', async () => {
    const h = await open('/insights?tab=capacity', orgStub('owner'));
    try {
      await ready(h.page);
      const review = h.page.locator('.cap-tile', { hasText: 'Waiting for review' });
      await until(async () => /Waiting for review\s*3/.test(await review.innerText()));
      assert.match(await review.innerText(), /Waiting for review\s*3/);
      assert.equal(await review.getAttribute('href'), '/inbox?tab=review');

      // The sidebar's Inbox carries both counts added (LAI-796): 3 waiting for
      // review and 1 unlisted. The shell reads its counts apart from the page,
      // so the entry can be drawn before the number is (LAI-765): wait for it,
      // then assert it.
      const entry = h.page.locator('#sidebar .sidebar-link', { hasText: 'Inbox' });
      await until(async () => /Inbox\s*4/.test(await entry.innerText()), 10_000);
      assert.match(await entry.innerText(), /Inbox\s*4/);

      await h.page.locator('.cap-tile-unlisted').click();
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
 * The chip is the space bar's, not Capacity's: since LAI-754 Capacity has no
 * space frame, so this is asserted on a space tab with presence like Capacity's.
 */
void describe('the space bar’s Agents chip (LAI-737)', () => {
  void test('says what its number counts, and which agents', async () => {
    const stub: ApiStub = {
      ...orgStub('owner'),
      '/api/v1/presence': {
        enabled: true,
        present: [
          ...PRESENCE.present,
          {
            user_id: 'u3',
            name: 'Cal Mokoena',
            matched_task_id: null,
            project_ids: [],
            is_agent: true,
            client: 'cursor',
            clients: ['cursor'],
            last_seen: NOW - 30_000,
          },
        ],
      },
    };
    const h = await open('/activity?project=laika', stub);
    try {
      const chip = h.page.locator('.space-agents-start');
      await chip.locator('.agent-mark').first().waitFor({ timeout: 20_000 });
      const text = (await chip.textContent()) ?? '';
      assert.match(text, /2 people with agent sessions/, text);
      assert.match(text, /Claude Code, Codex, Cursor/, text);
    } finally {
      await h.close();
    }
  });
});
