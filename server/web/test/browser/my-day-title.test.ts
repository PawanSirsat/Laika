/**
 * A title on a To settle block, in a real browser (LAI-865): typed in the
 * inspector before the block is confirmed, shown on its row and in the
 * inspector, carried into the confirmed entry as its note — which stays
 * editable — and reached from the keyboard with T, where ↵ saves it without
 * confirming and Esc leaves it. Both themes, existing tokens, and a phone.
 *
 * The API is stubbed (`my-day-week.ts`) and **keeps what it is sent**, so the
 * day re-read after each write shows that write; every write's body is
 * asserted, so a screen that sent the wrong thing cannot pass.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Locator, Page } from 'playwright';
import {
  closeBrowser,
  open,
  reply,
  setTheme,
  until,
  withHeaders,
  type Harness,
  type StubCall,
} from './harness.ts';
import { TODAY, weekData, weekStub, type DayData, type Entry } from './my-day-week.ts';

const TITLE = 'Planning the sprint';

/** Today's week, its untied block `d2` changed by `extra`. */
function data(extra: Record<string, unknown> = {}): Map<string, DayData> {
  const week = weekData();
  const today = week.get(TODAY);
  assert.ok(today !== undefined);
  const i = today.drafts.findIndex((d) => d.id === 'd2');
  const d2 = today.drafts[i];
  assert.ok(d2 !== undefined);
  today.drafts[i] = { ...d2, ...extra };
  return week;
}

/**
 * Today's writes, answered as the server would and kept: a draft's PATCH
 * merges into it (General unties it), a confirm turns the draft into an entry
 * carrying its note, and an entry's PATCH changes it.
 */
function stub(week: Map<string, DayData>): Record<string, unknown> {
  const today = week.get(TODAY);
  assert.ok(today !== undefined);
  const routes: Record<string, unknown> = { ...weekStub(week) };
  const undoId = (call: StubCall) => ({ 'X-Undo-Id': `u:${call.method}:${call.path}` });
  for (const { id } of today.drafts) {
    routes[`/api/v1/me/time-drafts/${id}`] = (call: StubCall) => {
      const i = today.drafts.findIndex((d) => d.id === id);
      const was = today.drafts[i];
      assert.ok(was !== undefined, id);
      const patch = call.body as Record<string, unknown>;
      const next = {
        ...was,
        ...patch,
        ...(patch.general === true ? { task: null, project: null, task_key: null } : {}),
      };
      today.drafts[i] = next;
      return withHeaders(next, undoId(call));
    };
    routes[`/api/v1/me/time-drafts/${id}/confirm`] = (call: StubCall) => {
      const i = today.drafts.findIndex((d) => d.id === id);
      const [was] = today.drafts.splice(i, 1);
      assert.ok(was !== undefined, id);
      const made: Entry = {
        id: `n-${id}`,
        day: TODAY,
        tz: 'UTC',
        started_at: was.started_at,
        ended_at: was.ended_at,
        minutes: was.minutes,
        source: 'draft',
        task: was.task,
        project: was.project,
        note: was.note,
        revision: 1,
        created_at: 1,
        updated_at: 1,
      };
      today.entries.push(made);
      routes[`/api/v1/me/time-entries/${made.id}`] = (edit: StubCall) => {
        const at = today.entries.findIndex((e) => e.id === made.id);
        const entry = today.entries[at];
        assert.ok(entry !== undefined);
        const next = {
          ...entry,
          ...(edit.body as object),
          revision: Number(entry.revision) + 1,
        };
        today.entries[at] = next;
        return next;
      };
      return reply(201, made, undoId(call));
    };
  }
  return routes;
}

async function openDay(week: Map<string, DayData> = data()): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub(week));
  await h.page.locator('.myday-week').waitFor({ timeout: 20_000 });
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  // An open day starts on its first draft.
  await h.page.locator('[data-inspector-for="d1"]').waitFor({ timeout: 5_000 });
  return h;
}

const writes = (h: Harness): StubCall[] => h.calls.filter((c) => c.method !== 'GET');

async function select(h: Harness, row: string): Promise<Locator> {
  await h.page.locator(`[data-select="${row}"]`).click();
  const inspector = h.page.locator(`[data-inspector-for="${row}"]`);
  await inspector.waitFor({ timeout: 5_000 });
  return inspector;
}

/** What has the focus: the title field, the inspector it sits in, or something else. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return 'nothing';
    if (el.hasAttribute('data-draft-title-field')) {
      return `field:${el.closest('[data-inspector-for]')?.getAttribute('data-inspector-for') ?? ''}`;
    }
    const home = el.getAttribute('data-inspector-for');
    return home === null ? el.tagName.toLowerCase() : `inspector:${home}`;
  });

/** The text of `locator` once it says `want` — or what it says when time is up. */
async function reads(locator: Locator, want: string): Promise<string> {
  const text = async () =>
    (await locator.count()) === 0 ? '(absent)' : (await locator.innerText()).trim();
  await until(async () => (await text()) === want);
  return text();
}

/** A colour token as this theme resolves it, for comparing with what is drawn. */
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);

/** The colour `locator` is drawn in, and the first opaque background behind it. */
const drawn = (locator: Locator, pseudo?: string) =>
  locator.evaluate((el, p) => {
    let node: Element | null = el;
    let back = 'rgba(0, 0, 0, 0)';
    while (node !== null && back === 'rgba(0, 0, 0, 0)') {
      back = getComputedStyle(node).backgroundColor;
      node = node.parentElement;
    }
    return { colour: getComputedStyle(el, p ?? null).color, back };
  }, pseudo);

after(async () => {
  await closeBrowser();
});

void describe('a title on a To settle block (LAI-865)', () => {
  const seen: Record<string, string> = {};
  for (const theme of ['Light', 'Dark']) {
    void test(`${theme}: typed and saved in the inspector, shown on the row and in the inspector`, async () => {
      const h = await openDay();
      try {
        await setTheme(h.page, theme);

        // An agent's note is where its title starts.
        const agent = await select(h, 'd5');
        assert.equal(
          await agent.locator('[data-draft-title-field]').inputValue(),
          'Reviewed the retry backoff',
        );

        const inspector = await select(h, 'd2');
        const field = inspector.locator('[data-draft-title-field]');
        assert.equal(await field.inputValue(), '');
        assert.equal(await field.getAttribute('placeholder'), 'A title for this block');
        assert.equal(await field.getAttribute('maxlength'), '200');

        // The placeholder and, once typed, the text: the theme's own tokens.
        const muted = await token(h.page, '--text-muted');
        const placeholder = await drawn(field, '::placeholder');
        assert.equal(placeholder.colour, muted, `${theme}: the placeholder is not --text-muted`);
        assert.notEqual(placeholder.colour, placeholder.back, `${theme}: placeholder unseen`);

        await field.click();
        await field.fill(`  ${TITLE}  `);
        const primary = await token(h.page, '--text-primary');
        const typed = await drawn(field);
        assert.equal(typed.colour, primary, `${theme}: the field's text is not --text-primary`);
        assert.notEqual(typed.colour, typed.back, `${theme}: the field's text is unseen`);

        await inspector.getByRole('button', { name: 'Save title' }).click();
        await until(() => writes(h).length > 0);
        assert.deepEqual(writes(h), [
          { method: 'PATCH', path: '/api/v1/me/time-drafts/d2', body: { note: TITLE } },
        ]);

        // Read back from both places, once the day is re-read.
        const row = h.page.locator('[data-settle-row="d2"] [data-draft-title]');
        assert.equal(await reads(row, TITLE), TITLE);
        assert.equal(
          await reads(inspector.locator('[data-inspector-title]'), `“${TITLE}”`),
          `“${TITLE}”`,
        );
        assert.equal(await field.inputValue(), TITLE);

        const secondary = await token(h.page, '--text-secondary');
        const onRow = await drawn(row);
        assert.equal(onRow.colour, secondary, `${theme}: the row's title is not --text-secondary`);
        assert.notEqual(onRow.colour, onRow.back, `${theme}: the row's title is unseen`);
        seen[theme] = `${typed.colour} ${placeholder.colour} ${onRow.colour}`;
      } finally {
        await h.close();
      }
    });
  }

  void test('the two themes draw it differently: the colours above came from each theme', () => {
    assert.ok(seen.Light !== undefined && seen.Dark !== undefined, 'a theme case did not run');
    assert.notEqual(seen.Light, seen.Dark);
  });
});

void describe('T, from the keyboard (LAI-865)', () => {
  void test('J, T, a title, ↵ saves it and does not confirm, the next ↵ confirms; the entry’s note then changes', async () => {
    // d2 on General, so it is ready to confirm.
    const h = await openDay(data({ general: true }));
    try {
      // 1. J selects a block.
      await h.page.keyboard.press('j');
      const inspector = h.page.locator('[data-inspector-for="d2"]');
      await inspector.waitFor({ timeout: 5_000 });
      const field = inspector.locator('[data-draft-title-field]');

      // 2. T puts the focus in its title field — and types no "t" there.
      await h.page.keyboard.press('t');
      await until(async () => (await focused(h.page)) === 'field:d2');
      assert.equal(await focused(h.page), 'field:d2');
      assert.equal(await field.inputValue(), '');

      // In the field, every key of My day is a letter and fires nothing.
      await h.page.keyboard.type('jkgxt?');
      assert.equal(await field.inputValue(), 'jkgxt?');
      assert.equal(await h.page.getByRole('dialog').count(), 0, 'the sheet opened while typing');
      assert.equal(await inspector.count(), 1, 'J or K moved the selection while typing');
      assert.deepEqual(writes(h), [], 'a shortcut fired while typing');

      // Esc leaves the field without saving.
      await h.page.keyboard.press('Escape');
      assert.equal(await focused(h.page), 'inspector:d2');
      assert.equal(await field.inputValue(), '');
      assert.deepEqual(writes(h), [], 'Esc saved');

      // 3. The person types a title. 4. ↵ saves it — and only that.
      await h.page.keyboard.press('t');
      await until(async () => (await focused(h.page)) === 'field:d2');
      await h.page.keyboard.type(TITLE);
      await h.page.keyboard.press('Enter');
      await until(() => writes(h).length > 0);
      assert.deepEqual(writes(h), [
        { method: 'PATCH', path: '/api/v1/me/time-drafts/d2', body: { note: TITLE } },
      ]);
      assert.equal(await focused(h.page), 'inspector:d2', '↵ left the focus in the field');
      const row = h.page.locator('[data-settle-row="d2"] [data-draft-title]');
      assert.equal(await reads(row, TITLE), TITLE);
      assert.equal(writes(h).length, 1, '↵ in the field confirmed the block');

      // 5. The next ↵ confirms the block, its title with it.
      await h.page.keyboard.press('Enter');
      await until(() => writes(h).length > 1);
      assert.deepEqual(writes(h)[1], {
        method: 'POST',
        path: '/api/v1/me/time-drafts/d2/confirm',
        body: undefined,
      });
      const ledger = h.page.locator('[data-ledger-row="n-d2"] .myday-row-note');
      assert.equal(await reads(ledger, `· ${TITLE}`), `· ${TITLE}`);
      assert.equal(await h.page.locator('[data-settle-row="d2"]').count(), 0);

      // The entry's Note holds the title, and Save note changes it.
      const entry = await select(h, 'n-d2');
      const note = entry.locator('#inspector-note-field');
      assert.equal(await note.inputValue(), TITLE);
      await note.fill('Planned the sprint');
      await entry.getByRole('button', { name: 'Save note' }).click();
      await until(() => writes(h).length > 2);
      assert.deepEqual(writes(h)[2], {
        method: 'PATCH',
        path: '/api/v1/me/time-entries/n-d2',
        body: { note: 'Planned the sprint' },
      });
      assert.equal(await reads(ledger, '· Planned the sprint'), '· Planned the sprint');
      assert.equal(writes(h).length, 3);
    } finally {
      await h.close();
    }
  });

  void test('G after the title puts the block on General, and it keeps its title', async () => {
    const h = await openDay();
    try {
      await h.page.keyboard.press('j');
      await h.page.locator('[data-inspector-for="d2"]').waitFor({ timeout: 5_000 });
      await h.page.keyboard.press('t');
      await until(async () => (await focused(h.page)) === 'field:d2');
      await h.page.keyboard.type(TITLE);
      await h.page.keyboard.press('Enter');
      const row = h.page.locator('[data-settle-row="d2"]');
      assert.equal(await reads(row.locator('[data-draft-title]'), TITLE), TITLE);

      await h.page.keyboard.press('g');
      await until(() => writes(h).length > 1);
      assert.deepEqual(writes(h), [
        { method: 'PATCH', path: '/api/v1/me/time-drafts/d2', body: { note: TITLE } },
        { method: 'PATCH', path: '/api/v1/me/time-drafts/d2', body: { general: true } },
      ]);
      assert.equal(await reads(row.locator('.myday-row-key'), 'General'), 'General');
      assert.equal(await reads(row.locator('[data-draft-title]'), TITLE), TITLE);
    } finally {
      await h.close();
    }
  });

  void test('the inspector’s hint row lists T beside the others', async () => {
    const h = await openDay();
    try {
      const hints = h.page.locator('[data-inspector-for="d1"] .inspector-keys');
      assert.deepEqual(await hints.locator('kbd').allInnerTexts(), [
        '↵',
        'G',
        'X',
        'T',
        'J',
        'K',
        '?',
      ]);
      // `innerText` breaks a line between flex items; the words are what is read.
      assert.equal(
        ((await hints.textContent()) ?? '').replace(/\s+/g, ' ').trim(),
        '↵ confirm G general X not work T title J K next / prev ? all keys',
      );
    } finally {
      await h.close();
    }
  });
});

void describe('a long title on a phone (LAI-865)', () => {
  // The most a draft holds, with a word too long for any line.
  const LONG = `${'Reviewed the retry backoff and the webhook queue '.repeat(3)}${'x'.repeat(53)}`;

  void test('390 px, light and dark: 200 characters cut on the row, wrapped in the inspector, the page never sideways', async () => {
    assert.equal(LONG.length, 200);
    const h = await openDay(data({ note: LONG }));
    try {
      await h.page.setViewportSize({ width: 390, height: 844 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const inspector = await select(h, 'd2');
        const fit = await h.page.evaluate(() => {
          const box = (el: Element | null) => el?.getBoundingClientRect();
          const row = document.querySelector('[data-settle-row="d2"]');
          const title = row?.querySelector('[data-draft-title]') ?? null;
          const card = document.querySelector('[data-inspector-for="d2"]');
          const said = card?.querySelector('[data-inspector-title]') ?? null;
          const main = document.querySelector('.shell-main') ?? document.scrollingElement;
          return {
            sideways: main === null ? 0 : main.scrollWidth - main.clientWidth,
            rowOver: row === null ? -1 : row.scrollWidth - row.clientWidth,
            titleRight: (box(title)?.right ?? 0) - (box(row)?.right ?? 0),
            cut:
              title !== null &&
              title.scrollWidth > title.clientWidth &&
              getComputedStyle(title).textOverflow === 'ellipsis',
            cardOver: card === null ? -1 : card.scrollWidth - card.clientWidth,
            saidRight: (box(said)?.right ?? 0) - (box(card)?.right ?? 0),
          };
        });
        assert.ok(
          fit.sideways <= 1,
          `${theme}: the page scrolls sideways by ${String(fit.sideways)}px`,
        );
        assert.ok(fit.rowOver <= 1, `${theme}: the row overflows by ${String(fit.rowOver)}px`);
        assert.ok(
          fit.titleRight <= 1,
          `${theme}: the title runs ${String(fit.titleRight)}px past its row`,
        );
        assert.ok(fit.cut, `${theme}: the row's title is not one line cut short`);
        assert.ok(
          fit.cardOver <= 1,
          `${theme}: the inspector overflows by ${String(fit.cardOver)}px`,
        );
        assert.ok(fit.saidRight <= 1, `${theme}: the inspector's title runs past it`);
        assert.equal(await inspector.locator('[data-draft-title-field]').inputValue(), LONG);
      }
    } finally {
      await h.close();
    }
  });
});
