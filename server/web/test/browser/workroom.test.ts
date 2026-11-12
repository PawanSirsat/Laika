/**
 * The Workroom, `/task/:key` (LAI-1199): a task as a page in three panels.
 *
 * Every property here is about history, layout, focus or what a lane says
 * from the fixture it was given — none of it is visible to a source scan,
 * which is why it is a browser test.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, until, type ApiStub, type Harness } from './harness.ts';
import { STUB, T1 } from './workroom-fixtures.ts';

const PANELS_KEY = 'laika.workroom.panels.v1';

async function openWorkroom(
  path: string,
  width = 1440,
  stub: ApiStub = STUB,
  before?: Parameters<typeof open>[2],
): Promise<Harness> {
  const h = await open(path, stub, before);
  await h.page.setViewportSize({ width, height: 900 });
  return h;
}

const title = (h: Harness) => h.page.locator('.wr-title');
const lane = (h: Harness, id: string) => h.page.locator(`.wr-lane[data-lane="${id}"]`);
const separator = (h: Harness, name: string) => h.page.getByRole('separator', { name });

async function ready(h: Harness): Promise<void> {
  await title(h).waitFor({ timeout: 20_000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('opening the Workroom', () => {
  void test('by direct URL: the task by key, in three labelled panels', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      assert.equal((await title(h).textContent())?.trim(), 'Ship the workroom');
      assert.equal(await h.page.getByRole('navigation', { name: 'Task navigation' }).count(), 1);
      assert.equal(
        await h.page.getByRole('complementary', { name: 'Agents and review' }).count(),
        1,
      );
      assert.equal(await h.page.getByRole('article', { name: 'Ship the workroom' }).count(), 1);
      assert.equal(await h.page.getByRole('separator').count(), 2);
      // Description through the existing renderer: bold is an element, not asterisks.
      await h.page
        .locator('.wr-centre strong', { hasText: 'description' })
        .waitFor({ timeout: 10_000 });
      // The hierarchy from the set: the subtask and the blocker, as links to their pages.
      assert.equal(
        await h.page.locator('.wr-left a[href="/task/LC-2"]').count(),
        1,
        'the subtask is not linked',
      );
      assert.equal(await h.page.locator('.wr-left a[href="/task/LC-3"]').count(), 1);
      assert.match(await h.page.title(), /^LC-1 · Ship the workroom · Laika$/);
    } finally {
      await h.close();
    }
  });

  void test('a key that names nothing says so; an unknown prefix too', async () => {
    for (const key of ['LC-99', 'ZZ-1']) {
      const h = await openWorkroom(`/task/${key}`);
      try {
        const missing = h.page.locator('[data-state="not-found"]');
        await missing.waitFor({ timeout: 20_000 });
        assert.equal(
          (await h.page.getByRole('heading', { level: 1 }).textContent())?.trim(),
          `No task ${key}`,
        );
      } finally {
        await h.close();
      }
    }
  });

  void test('a space the reader may not read says so, not "not found"', async () => {
    const h = await openWorkroom('/task/LC-1', 1440, {
      ...STUB,
      '/api/v1/projects/laika-core/tasks': refuse(403, 'forbidden', 'No.'),
    });
    try {
      await h.page.locator('[data-state="forbidden"]').waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('[data-state="not-found"]').count(), 0);
    } finally {
      await h.close();
    }
  });
});

void describe('history', () => {
  void test('Expand from the drawer pushes; Back returns to the board with the drawer open', async () => {
    const h = await openWorkroom('/board?project=laika-core&task=t1');
    try {
      const expand = h.page.locator('.drawer').getByRole('link', { name: 'Expand to full page' });
      await expand.waitFor({ timeout: 20_000 });
      assert.equal(await expand.getAttribute('href'), '/task/LC-1');
      await expand.click();
      await ready(h);
      assert.equal(new URL(h.page.url()).pathname, '/task/LC-1');

      await h.page.goBack();
      await h.page.locator('.drawer .panel-title').waitFor({ timeout: 10_000 });
      const url = new URL(h.page.url());
      assert.equal(url.pathname, '/board');
      assert.equal(url.searchParams.get('task'), 't1');

      // Forward, then the page's own Back: it steps back rather than pushing.
      await h.page.goForward();
      await ready(h);
      const back = h.page.getByRole('link', { name: 'Back to Board' });
      await back.click();
      await h.page.locator('.drawer .panel-title').waitFor({ timeout: 10_000 });
      await h.page.goForward();
      await ready(h);
      assert.equal(
        new URL(h.page.url()).pathname,
        '/task/LC-1',
        'Back to Board pushed a new entry instead of stepping back',
      );
    } finally {
      await h.close();
    }
  });

  void test('switching sections replaces: Back leaves the page, not the last section', async () => {
    const h = await openWorkroom('/board?project=laika-core&task=t1');
    try {
      const expand = h.page.locator('.drawer').getByRole('link', { name: 'Expand to full page' });
      await expand.waitFor({ timeout: 20_000 });
      await expand.click();
      await ready(h);
      const length = await h.page.evaluate(() => history.length);
      const nav = h.page.getByRole('navigation', { name: 'Task navigation' });
      for (const name of ['Evidence', 'Discussion', 'Execution']) {
        await nav.getByRole('button', { name, exact: true }).click();
        await until(() => new URL(h.page.url()).searchParams.get('area') === name.toLowerCase());
      }
      assert.equal(new URL(h.page.url()).searchParams.get('area'), 'execution');
      assert.equal(await h.page.evaluate(() => history.length), length);
      assert.equal(
        await nav
          .getByRole('button', { name: 'Execution', exact: true })
          .getAttribute('aria-current'),
        'true',
      );
      await h.page.goBack();
      await until(() => new URL(h.page.url()).pathname === '/board');
      assert.equal(new URL(h.page.url()).pathname, '/board');
    } finally {
      await h.close();
    }
  });

  void test('a pasted link: Back to Board opens the task in its space', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      await h.page.getByRole('link', { name: 'Back to Board' }).click();
      await h.page.locator('.drawer .panel-title').waitFor({ timeout: 20_000 });
      const url = new URL(h.page.url());
      assert.equal(url.pathname, '/board');
      assert.equal(url.searchParams.get('project'), 'laika-core');
      assert.equal(url.searchParams.get('task'), 't1');
    } finally {
      await h.close();
    }
  });
});

void describe('panels', () => {
  void test('the separator answers its keys, and the width survives a reload', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      const nav = separator(h, 'Resize navigation');
      assert.equal(await nav.getAttribute('aria-valuenow'), '248');
      assert.equal(await nav.getAttribute('aria-valuemin'), '200');
      assert.equal(await nav.getAttribute('aria-valuemax'), '360');
      assert.equal(await nav.getAttribute('aria-controls'), 'wr-left');
      await nav.focus();
      await h.page.keyboard.press('ArrowRight');
      await h.page.keyboard.press('ArrowRight');
      assert.equal(await nav.getAttribute('aria-valuenow'), '280');
      await h.page.keyboard.press('Shift+ArrowLeft');
      assert.equal(await nav.getAttribute('aria-valuenow'), '216');
      await h.page.keyboard.press('Home');
      assert.equal(await nav.getAttribute('aria-valuenow'), '200');
      await h.page.keyboard.press('End');
      assert.equal(await nav.getAttribute('aria-valuenow'), '360');
      // The panel really is that wide — the value is not just an attribute.
      const width = await h.page
        .locator('#wr-left')
        .evaluate((el) => el.getBoundingClientRect().width);
      assert.equal(Math.round(width), 360);

      await h.page.reload();
      await ready(h);
      assert.equal(await separator(h, 'Resize navigation').getAttribute('aria-valuenow'), '360');
      const kept = await h.page.evaluate((k) => localStorage.getItem(k), PANELS_KEY);
      assert.match(kept ?? '', /"left":360/);
    } finally {
      await h.close();
    }
  });

  void test('Enter collapses and expands; the header button says so with aria-expanded', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      const right = separator(h, 'Resize details');
      await right.focus();
      await h.page.keyboard.press('Enter');
      await h.page.locator('#wr-right').waitFor({ state: 'hidden', timeout: 5_000 });
      assert.equal(await right.getAttribute('aria-valuenow'), '0');
      const toggle = h.page.getByRole('button', { name: 'Show details' });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await h.page.keyboard.press('Enter');
      await h.page.locator('#wr-right').waitFor({ state: 'visible', timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('a drag resizes the right panel', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      const right = separator(h, 'Resize details');
      const box = await right.boundingBox();
      assert.ok(box);
      const y = box.y + 100;
      await h.page.mouse.move(box.x + box.width / 2, y);
      await h.page.mouse.down();
      await h.page.mouse.move(box.x - 60, y, { steps: 6 });
      await h.page.mouse.up();
      // 60px left from where the pointer took hold: the right panel grows by that.
      await until(async () => Number(await right.getAttribute('aria-valuenow')) > 360);
      const now = Number(await right.getAttribute('aria-valuenow'));
      assert.ok(Math.abs(now - 380) <= 5, `the drag left the panel at ${String(now)}px`);
    } finally {
      await h.close();
    }
  });

  void test('storage that throws: the page still opens at the default widths', async () => {
    const h = await openWorkroom('/task/LC-1', 1440, STUB, {
      before: async (page) => {
        await page.addInitScript(() => {
          Storage.prototype.getItem = () => {
            throw new Error('blocked');
          };
          Storage.prototype.setItem = () => {
            throw new Error('blocked');
          };
        });
      },
    });
    try {
      await ready(h);
      assert.equal(await separator(h, 'Resize navigation').getAttribute('aria-valuenow'), '248');
      assert.equal(await separator(h, 'Resize details').getAttribute('aria-valuenow'), '320');
    } finally {
      await h.close();
    }
  });

  void test('one scroller: the centre is not a scroll box, the side panels are sticky', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      const style = (sel: string, prop: string) =>
        h.page.locator(sel).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
      assert.equal(await style('.wr-centre', 'overflow-y'), 'visible');
      assert.equal(await style('.wr-left', 'position'), 'sticky');
      assert.equal(await style('.wr-right', 'position'), 'sticky');
    } finally {
      await h.close();
    }
  });
});

void describe('focus mode', () => {
  void test('`.` hides both panels and the app sidebar; Escape brings them back', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      await h.page.locator('body').press('.');
      await until(() => new URL(h.page.url()).searchParams.get('focus') === '1');
      assert.equal(await h.page.locator('#wr-left').count(), 0);
      assert.equal(await h.page.locator('#wr-right').count(), 0);
      assert.equal(await h.page.locator('#sidebar').isVisible(), false);
      assert.equal(
        await h.page.getByRole('button', { name: 'Leave focus' }).getAttribute('aria-pressed'),
        'true',
      );
      await h.page.keyboard.press('Escape');
      await until(() => new URL(h.page.url()).searchParams.get('focus') === null);
      await h.page.locator('#wr-left').waitFor({ timeout: 5_000 });
      assert.equal(await h.page.locator('#sidebar').isVisible(), true);
    } finally {
      await h.close();
    }
  });

  void test('`.` typed into a field is text, not a shortcut', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      // The title, opened for editing, is a field like any other.
      await h.page.locator('.wr-title .inline-edit-can').click();
      const field = h.page.locator('.wr-title textarea');
      await field.waitFor({ timeout: 5_000 });
      await h.page.keyboard.type('.');
      assert.match(await field.inputValue(), /\.$/);
      assert.equal(new URL(h.page.url()).searchParams.get('focus'), null);
    } finally {
      await h.close();
    }
  });
});

void describe('agent lanes, from the fixture and nothing else', () => {
  void test('the task in review: each lane its own fact, and never "assigned to an agent"', async () => {
    const h = await openWorkroom('/task/LC-1');
    try {
      await ready(h);
      await until(async () => (await lane(h, 'outcome').getAttribute('data-state')) === 'set');
      const text = async (id: string) => (await lane(h, id).innerText()).replace(/\s+/g, ' ');
      assert.match(await text('accountable'), /Ada Lovelace/);
      assert.match(await text('requested'), /shell-cc.*Selected/);
      await until(async () => (await text('executing')).includes('Last claim 2 ended'));
      assert.match(await text('executing'), /No live claim.*Last claim 2 ended/);
      assert.match(await text('outcome'), /In review.*Round 2/);
      const lanes = await h.page.locator('.wr-lanes').innerText();
      assert.doesNotMatch(lanes, /assigned to/i);
      // Decisions and questions, verbatim, labelled as the agent's own.
      const notes = h.page.locator('[data-card="notes"]');
      await notes.getByText('Keep the harness line once').waitFor({ timeout: 10_000 });
      await notes.getByText('Touch drag on the separators?').waitFor();
      assert.match(await notes.innerText(), /Agent-reported/);
      // The latest save is labelled a save, not proof.
      assert.match(
        await h.page.locator('[data-card="latest-save"]').innerText(),
        /A save, not yet proof/,
      );
      // The timeline holds the claim, the save and the round, each badged.
      const rows = h.page.locator('.wr-row');
      await until(async () => (await rows.count()) >= 3);
      const sources = await rows.evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-source')),
      );
      assert.deepEqual([...new Set(sources)].sort(), ['activity', 'round', 'save']);
    } finally {
      await h.close();
    }
  });

  void test('a task nobody is on: no lane invents a state', async () => {
    const h = await openWorkroom('/task/LC-4');
    try {
      await ready(h);
      await until(async () => (await lane(h, 'outcome').getAttribute('data-state')) === 'empty');
      await until(async () => (await lane(h, 'executing').getAttribute('data-state')) === 'empty');
      const states = await h.page
        .locator('.wr-lane')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
      assert.deepEqual(states, ['empty', 'empty', 'empty', 'empty']);
      const values = await h.page.locator('.wr-lane-value').allInnerTexts();
      for (const value of values)
        assert.doesNotMatch(value, /^(Working|In review|Accepted|shell-cc)/);
      assert.equal(await h.page.locator('.wr-lane-detail').count(), 0, 'a lane added a detail');
      assert.match(await h.page.locator('[data-card="review"]').innerText(), /Nothing to decide/);
      assert.match(
        await h.page.locator('.wr-timeline').innerText(),
        /No agent has worked this yet/,
      );
    } finally {
      await h.close();
    }
  });

  void test('Accept is the existing endpoint, and only for the task in review', async () => {
    const h = await openWorkroom('/task/LC-1', 1440, {
      ...STUB,
      '/api/v1/tasks/t1/accept': { ...T1, status: 'done' },
    });
    try {
      await ready(h);
      const review = h.page.locator('[data-card="review"]');
      await review.getByRole('button', { name: 'Accept' }).click();
      await until(() =>
        h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/tasks/t1/accept'),
      );
      assert.ok(h.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/tasks/t1/accept'));
    } finally {
      await h.close();
    }
  });
});

void describe('breakpoints', () => {
  void test('≥1280 three panels; 1024 two, the left behind Contents; 768 and 390 one column', async () => {
    const h = await openWorkroom('/task/LC-1', 1280);
    try {
      await ready(h);
      const separators = () => h.page.getByRole('separator').count();
      assert.equal(await separators(), 2);
      assert.equal(await h.page.locator('.wr').getAttribute('data-mode'), 'three');

      await h.page.setViewportSize({ width: 1024, height: 800 });
      await until(async () => (await h.page.locator('.wr').getAttribute('data-mode')) === 'two');
      assert.equal(await separators(), 1, 'the left separator should be unmounted');
      assert.equal(await h.page.locator('#wr-left').count(), 0);
      const contents = h.page.getByRole('button', { name: 'Contents' });
      await contents.click();
      await h.page.locator('#wr-contents a[href="/task/LC-2"]').waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('Escape');
      await h.page.locator('#wr-contents').waitFor({ state: 'detached', timeout: 5_000 });

      for (const width of [768, 390]) {
        await h.page.setViewportSize({ width, height: 800 });
        await until(async () => (await h.page.locator('.wr').getAttribute('data-mode')) === 'one');
        assert.equal(await separators(), 0, `${String(width)}: separators remain`);
        const tabs = h.page.getByRole('tablist', { name: 'Sections' });
        assert.equal(await tabs.count(), 1);
        const overflow = await h.page
          .locator('.wr')
          .evaluate((el) => el.scrollWidth - el.clientWidth);
        assert.ok(
          overflow <= 1,
          `${String(width)}: the page scrolls sideways by ${String(overflow)}px`,
        );
      }
      await h.page.getByRole('tab', { name: 'Agents & review' }).click();
      await lane(h, 'accountable').waitFor({ timeout: 5_000 });
      assert.equal(new URL(h.page.url()).searchParams.get('area'), 'agents');
    } finally {
      await h.close();
    }
  });
});
