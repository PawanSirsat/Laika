/**
 * A work folder's chosen name on My day, in a real browser (LAI-866, D-098):
 * an untied block from a folder the person named reads *Needs a card · Acme*
 * in To settle and in the inspector; a block the name put under a matching
 * project reads as a space block, the name shown; the confirmed entry shows
 * it; and *Drafted from* says the name went with the counts — in both themes.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator } from 'playwright';
import { closeBrowser, setTheme, type Harness } from './harness.ts';
import { open } from './my-day-clock.ts';
import { TODAY, weekData, weekStub, type DayData } from './my-day-week.ts';

const ACME = { id: 'p9', slug: 'acme', name: 'Acme Billing' };

/** Today's fixture, three of its items from a folder named "Acme". */
function data(): Map<string, DayData> {
  const week = weekData();
  const today = week.get(TODAY);
  assert.ok(today !== undefined);
  const named = (id: string, extra: Record<string, unknown>) => {
    const i = today.drafts.findIndex((d) => d.id === id);
    const d = today.drafts[i];
    assert.ok(d !== undefined, id);
    today.drafts[i] = { ...d, ...extra };
  };
  // d2: untied, from Acme, its branch sent.
  named('d2', { folder: 'Acme', branch: 'feature/acme-7' });
  // d4: the name matched a project the reader can read.
  named('d4', { task_key: null, project: ACME, folder: 'Acme', branch: null });
  const e = today.entries.findIndex((x) => x.id === 'e1');
  const e1 = today.entries[e];
  assert.ok(e1 !== undefined);
  today.entries[e] = { ...e1, folder: 'Acme', branch: null };
  return week;
}

async function openDay(): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, weekStub(data()));
  await h.page.locator('.myday-week').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  return h;
}

async function select(h: Harness, row: string): Promise<Locator> {
  await h.page.locator(`[data-select="${row}"]`).click();
  const inspector = h.page.locator(`[data-inspector-for="${row}"]`);
  await inspector.waitFor({ timeout: 5_000 });
  return inspector;
}

/** The text is drawn: an opaque colour unlike the page behind it. */
async function visible(locator: Locator, what: string): Promise<void> {
  const { colour, back } = await locator.evaluate((el) => {
    let node: Element | null = el;
    let back = 'rgba(0, 0, 0, 0)';
    while (node !== null && back === 'rgba(0, 0, 0, 0)') {
      back = getComputedStyle(node).backgroundColor;
      node = node.parentElement;
    }
    return { colour: getComputedStyle(el).color, back };
  });
  assert.notEqual(colour, 'rgba(0, 0, 0, 0)', `${what} is drawn invisible`);
  assert.notEqual(colour, back, `${what} is the colour of what is behind it`);
}

after(async () => {
  await closeBrowser();
});

void describe('a work folder’s chosen name on My day (LAI-866)', () => {
  for (const theme of ['Light', 'Dark']) {
    void test(`${theme}: Needs a card · Acme, a matched space with its name, and the entry`, async () => {
      const h = await openDay();
      try {
        await setTheme(h.page, theme);

        // To settle: the untied block says the name.
        const untied = h.page.locator('[data-settle-row="d2"]');
        assert.equal(
          (await untied.locator('.myday-row-key').innerText()).trim(),
          'Needs a card · Acme',
        );
        assert.equal(
          (await untied.locator('.myday-row-line').innerText()).trim(),
          'Pick a card, or General',
        );
        await visible(untied.locator('.myday-row-key'), 'the untied row’s label');

        // The block the name put under Acme Billing reads as a space, the name shown.
        const space = h.page.locator('[data-settle-row="d4"]');
        assert.equal((await space.locator('.myday-row-key').innerText()).trim(), 'Acme Billing');
        assert.equal(
          (await space.locator('.myday-row-line').innerText()).trim(),
          'A space, no card · Acme',
        );
        await visible(space.locator('.myday-row-line'), 'the space row’s line');

        // Its inspector names the space, and the folder beside it.
        const spaced = await select(h, 'd4');
        assert.equal(
          (await spaced.locator('.inspector-card').first().innerText()).trim(),
          'Acme Billing · Acme',
        );

        // The inspector: the warning, and Drafted from saying the name went too.
        const inspector = await select(h, 'd2');
        assert.match(
          await inspector.locator('[data-card-warning]').innerText(),
          /^Needs a card · Acme\. Pick one, or General if it was general work\.$/,
        );
        assert.equal(
          (await inspector.locator('[data-drafted-folder]').innerText()).trim(),
          'Acme · feature/acme-7',
        );
        assert.match(
          await inspector.innerText(),
          /Counts, the name you gave this folder and its branch — never what you typed, file names or commit messages\./,
        );
        await visible(inspector.locator('[data-drafted-folder]'), 'the folder under Drafted from');

        // The confirmed entry shows the name.
        const entry = h.page.locator('[data-ledger-row="e1"]');
        assert.equal((await entry.locator('[data-entry-folder]').innerText()).trim(), 'Acme');
        await visible(entry.locator('[data-entry-folder]'), 'the entry’s folder');
        const entryInspector = await select(h, 'e1');
        assert.match(
          await entryInspector.locator('.inspector-card').first().innerText(),
          / · Acme$/,
        );
      } finally {
        await h.close();
      }
    });
  }
});
