import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { closeBrowser, setTheme, until, type ApiStub, type Harness } from './harness.ts';
import { open, TODAY } from './my-day-clock.ts';
import { at, weekData, weekStub } from './my-day-week.ts';

/**
 * A meeting the Outlook calendar sync logged (D-157, LAI-1316), on My day:
 * the row's *From Outlook* pill, the Timeline block that says so, and the
 * editor — editable like a typed entry, with words saying where it came from
 * and that a change keeps later syncs off it, and a first revision reading
 * *From Outlook*. Both themes.
 *
 * `LAIKA_SHOTS=<dir>` also writes the screenshots there.
 */

const START = at(TODAY, 16, 20);

function stub(): ApiStub {
  const data = weekData();
  const today = data.get(TODAY);
  if (today !== undefined) {
    today.entries = [
      ...today.entries,
      {
        id: 'o1',
        day: TODAY,
        // Stored in a zone that is not the day's (LAI-1362): the head must
        // still read in the day's zone, as the When fields do.
        tz: 'Asia/Kolkata',
        started_at: START,
        ended_at: START + 45 * 60_000,
        minutes: 45,
        source: 'calendar',
        task: null,
        project: null,
        note: null,
        kind: 'meeting',
        title: 'Sprint planning',
        description: null,
        revision: 1,
        created_at: START,
        updated_at: START,
      },
    ];
  }
  return {
    ...weekStub(data),
    '/api/v1/me/time-entries/o1/revisions': {
      revisions: [
        {
          revision: 1,
          change: 'created',
          // The sync writes it in the person's own name.
          changed_by: 'u1',
          changed_by_name: 'Ada Lovelace',
          day: TODAY,
          tz: 'UTC',
          minutes: 45,
          task_id: null,
          project_id: null,
          note: null,
          kind: 'meeting',
          title: 'Sprint planning',
          description: null,
          started_at: START,
          ended_at: START + 45 * 60_000,
          created_at: START,
        },
      ],
    },
  };
}

async function myDay(): Promise<Harness> {
  const h = await open(`/my-day?day=${TODAY}`, stub());
  await h.page.locator('[data-myday-ready]').waitFor({ timeout: 20_000 });
  await h.page.setViewportSize({ width: 1440, height: 900 });
  return h;
}

after(async () => {
  await closeBrowser();
});

void describe('a meeting from Outlook on My day (D-157)', () => {
  for (const theme of ['light', 'dark'] as const) {
    void test(`${theme}: its pill, its block and its editor say it came from Outlook, and it can be changed`, async () => {
      const h = await myDay();
      try {
        await setTheme(h.page, theme);
        // The Timeline block: marked, and named so a screen reader hears it.
        const block = h.page.locator('.dayline-block[data-block-id="o1"]');
        await block.waitFor({ timeout: 10_000 });
        assert.equal(await block.getAttribute('data-source'), 'calendar');
        assert.match(
          (await block.locator('[data-block-select="o1"]').getAttribute('aria-label')) ?? '',
          /^Confirmed, from Outlook, /,
        );
        // A typed entry's block says nothing of Outlook.
        assert.equal(
          await h.page.locator('.dayline-block[data-block-id="e1"]').getAttribute('data-source'),
          null,
        );

        // The row's pill.
        const tab = h.page.locator('[data-day-tab="confirmed"]');
        if ((await tab.getAttribute('aria-current')) !== 'page') await tab.click();
        const row = h.page.locator('[data-ledger-row="o1"]');
        await row.waitFor({ timeout: 5_000 });
        assert.equal(await row.locator('.myday-source').innerText(), 'From Outlook');
        assert.match(
          (await row.locator('.myday-source').getAttribute('class')) ?? '',
          /myday-source-calendar/,
        );

        // The editor: Outlook's words, and Delete — it is the person's to change.
        await h.page.locator('[data-select="o1"]').click();
        const editor = h.page.locator('[data-inspector-for="o1"]');
        await editor.waitFor({ timeout: 5_000 });
        assert.match(await editor.locator('.inspector-kind').innerText(), /From Outlook$/);
        assert.match(
          await editor.locator('[data-editor-banner]').innerText(),
          /Synced from your Outlook calendar\. Once you change or delete it here, later syncs leave it alone\./,
        );
        // The source is said by the pill and the banner, not a third time
        // in the sub line (LAI-1362).
        const sub = await editor.locator('.editor-sub').innerText();
        assert.match(sub, /Owners and admins can see it$/);
        assert.doesNotMatch(sub, /Outlook/);
        // The head's time is the day's, like the When fields under it.
        assert.match(sub, /^4:20/, `head "${sub}" reads 4:20, the day's zone, not Kolkata's 9:50`);
        assert.equal(await editor.locator('[data-entry-delete]').count(), 1);
        assert.equal(await editor.locator('[data-entry-done]').count(), 1);
        const history = editor.locator('[data-entry-history] .editor-history-row');
        await until(async () => (await history.count()) > 0);
        assert.match(await history.first().innerText(), /From Outlook · 45 min/);

        const shots = process.env.LAIKA_SHOTS;
        if (shots !== undefined && shots !== '') {
          mkdirSync(shots, { recursive: true });
          // The block on the Timeline beside the editor, then its row's pill.
          await block.scrollIntoViewIfNeeded();
          await h.page.waitForTimeout(400);
          await h.page.screenshot({ path: join(shots, `my-day-outlook-${theme}-1440.png`) });
          await row.scrollIntoViewIfNeeded();
          await h.page.waitForTimeout(400);
          await h.page.screenshot({ path: join(shots, `my-day-outlook-row-${theme}-1440.png`) });
        }
      } finally {
        await h.close();
      }
    });
  }
});
