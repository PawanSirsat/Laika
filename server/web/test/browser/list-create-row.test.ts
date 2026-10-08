/**
 * The List's "+ Create task" row is pinned to the foot of the table card
 * (LAI-717, the owner's addition).
 *
 * The owner's screenshot: one result, the Create row directly under it near
 * the top of the card, and the rest of the card blank beneath. Each assertion
 * here fails against the code before LAI-717 — each was run against it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, type ApiStub, type Harness } from './harness.ts';

const CORE = {
  id: 'laika-core',
  slug: 'laika-core',
  prefix: 'LC',
  name: 'Laika Core',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
};

const task = (n: number) => ({
  id: `t${String(n)}`,
  key: `LC-${String(n)}`,
  number: n,
  project_id: 'laika-core',
  title: `Task number ${String(n)}`,
  description_md: '',
  acceptance_md: '',
  status: 'backlog',
  priority: 'p2',
  assignee_id: null,
  created_by: 'u1',
  created_via: 'web',
  sprint_id: null,
  tags: [],
  ready: false,
  comment_count: 0,
  blocked_by: [],
  blocks: [],
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  branch: null,
  external_ref: null,
  stale_flagged_at: null,
  created_at: 1,
  updated_at: Date.now() - n * 60_000,
  started_at: null,
  completed_at: null,
});

const stub = (count: number): ApiStub => ({
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    org_role: 'owner',
    is_active: true,
    memberships: [{ project_id: 'laika-core', role: 'lead' }],
  },
  '/api/v1/projects': {
    data: [
      {
        ...CORE,
        task_counts: { backlog: count, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        blocked_count: 0,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': {
    data: Array.from({ length: count }, (_, i) => task(i + 1)),
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/members': {
    members: [{ user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' }],
  },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: true, present: [] },
});

void after(async () => {
  await closeBrowser();
});

/** The card's inner box, the Create row, the table and the last row, in px. */
const measure = (h: Harness) =>
  h.page.evaluate(() => {
    const card = document.querySelector('.list-scroll')!;
    const box = card.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(card).borderBottomWidth);
    const create = document.querySelector('.list-create')!.getBoundingClientRect();
    const rows = document.querySelectorAll('.list tbody tr');
    const last = rows[rows.length - 1]!.getBoundingClientRect();
    const head = document.querySelector('.list thead')!.getBoundingClientRect();
    return {
      cardBottom: box.bottom - border,
      createTop: create.top,
      createBottom: create.bottom,
      lastTop: last.top,
      lastBottom: last.bottom,
      headBottom: head.bottom,
      rows: rows.length,
      // What is actually painted on top at the Create row's middle.
      onTop:
        document
          .elementFromPoint(create.left + create.width / 2, create.top + create.height / 2)
          ?.closest('.list-create') !== null,
    };
  });

void describe('the List’s Create row (LAI-717)', () => {
  void test('few rows: it sits on the card’s foot, with the blank space above it', async () => {
    const h = await open('/list?project=laika-core', stub(1));
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      const m = await measure(h);

      assert.equal(m.rows, 1, 'positive control: one row');
      assert.ok(
        Math.abs(m.createBottom - m.cardBottom) <= 1,
        `the Create row ends at ${String(m.createBottom)}, the card at ${String(m.cardBottom)}`,
      );
      assert.ok(
        m.createTop - m.lastBottom > 200,
        `the blank is not between the row and Create: ${String(m.createTop - m.lastBottom)}px`,
      );

      // Still the control it was.
      await h.page.locator('.list-create').click();
      await h.page.locator('form.new-task').waitFor({ timeout: 5_000 });
    } finally {
      await h.close();
    }
  });

  void test('many rows: it stays in view while the rows scroll, and never hides the last one', async () => {
    const h = await open('/list?project=laika-core', stub(60));
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      const scroller = h.page.locator('.list-scroll');
      const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
      assert.ok(overflow > 500, `positive control: the table scrolls (${String(overflow)}px)`);

      // Halfway: the Create row is on the card's foot and painted on top.
      await scroller.evaluate((el) => {
        el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
      });
      let m = await measure(h);
      assert.ok(
        Math.abs(m.createBottom - m.cardBottom) <= 1,
        `mid-scroll the Create row ends at ${String(m.createBottom)}, the card at ${String(m.cardBottom)}`,
      );
      assert.equal(m.onTop, true, 'mid-scroll the Create row is covered by the rows');

      // At the end: the last row is whole, above the Create row, under the header.
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      m = await measure(h);
      assert.ok(
        m.lastBottom <= m.createTop + 0.5,
        `the Create row covers the last row: row ends ${String(m.lastBottom)}, Create starts ${String(m.createTop)}`,
      );
      assert.ok(m.lastTop >= m.headBottom, 'the last row is under the header');
      // No dead band between them either — the old 32px table margin.
      assert.ok(
        m.createTop - m.lastBottom <= 1,
        `a ${String(m.createTop - m.lastBottom)}px gap under the last row`,
      );
      assert.equal(m.onTop, true, 'at the end the Create row is not on top');
    } finally {
      await h.close();
    }
  });

  /*
   * **Half of this is not a regression catch.** The Create row's background
   * was already an opaque token before LAI-717, so the colour assertion passes
   * on the old code too; it guards the property now that rows pass beneath the
   * row. The `sticky` assertion is the one the old code fails.
   */
  void test('the Create row’s background is an opaque token in both themes', async () => {
    const h = await open('/list?project=laika-core', stub(1));
    try {
      await h.page.locator('.list-create').waitFor({ timeout: 20_000 });
      for (const theme of ['light', 'dark']) {
        await setTheme(h.page, theme);
        const [background, position] = await h.page
          .locator('.list-create')
          .evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).position]);
        assert.match(background ?? '', /^rgb\(/, `${theme}: not opaque — ${String(background)}`);
        assert.equal(position, 'sticky', `${theme}: the Create row is not pinned`);
      }
    } finally {
      await h.close();
    }
  });

  /*
   * **The bulk bar never covers the Create row** (review, should-fix 4). It
   * floated from the pane's foot, a pager's height below the card, which is
   * exactly where the pinned Create row now sits.
   *
   * **Nor the last row** (review, round 2). Round 1 lifted the bar off the
   * Create row and onto the last row at the end of a long scroll — the row the
   * reader had just ticked. A long list must also leave that row clear.
   */
  for (const [label, count, width, height] of [
    ['a short list, 1440×900', 1, 1440, 900],
    ['a long list scrolled to its end, 1440×900', 60, 1440, 900],
    ['a short list, 900 wide', 1, 900, 800],
    ['a long list scrolled to its end, 900 wide', 60, 900, 800],
  ] as const) {
    void test(`with a row selected, the bulk bar sits above the Create row — ${label}`, async () => {
      const h = await open('/list?project=laika-core', stub(count));
      try {
        await h.page.setViewportSize({ width, height });
        await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
        const scroller = h.page.locator('.list-scroll');
        if (count > 1) {
          // Positive control: the card bounds its height and the rows scroll.
          // A card that grew to its content would have nothing to scroll and
          // nothing to cover, and would pass everything below.
          const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
          assert.ok(overflow > 500, `positive control: the table scrolls (${String(overflow)}px)`);
        }
        await scroller.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await h.page.locator('.list-row .list-checkbox').last().check();
        await h.page.locator('.list-bulk').waitFor({ timeout: 5_000 });
        // The selection may add room at the end; read the end as it now is.
        await scroller.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        const g = await h.page.evaluate(() => {
          const rows = document.querySelectorAll('.list tbody tr');
          return {
            bulkTop: document.querySelector('.list-bulk')!.getBoundingClientRect().top,
            bulkBottom: document.querySelector('.list-bulk')!.getBoundingClientRect().bottom,
            createTop: document.querySelector('.list-create')!.getBoundingClientRect().top,
            lastBottom: rows[rows.length - 1]!.getBoundingClientRect().bottom,
          };
        });
        assert.ok(
          g.bulkBottom <= g.createTop,
          `the bulk bar ends at ${String(g.bulkBottom)}, over the Create row from ${String(g.createTop)}`,
        );
        assert.ok(
          g.lastBottom <= g.bulkTop,
          `the bulk bar covers the last row: row ends ${String(g.lastBottom)}, bar starts ${String(g.bulkTop)}`,
        );
      } finally {
        await h.close();
      }
    });
  }
});
