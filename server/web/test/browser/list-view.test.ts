/**
 * The List view's geometry (LAI-256).
 *
 * The design's widths are exact numbers (prototype lines 166–203) and the
 * screen's frame is a *negative* fact: List has no right rail, no WORKING NOW
 * and no sprint chips, because the design wraps all three in `boardLive`
 * (line 2273). Ours had every one of them, which is what made List read as the
 * board with its middle swapped out.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub, type Harness } from './harness.ts';

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

const task = (over: Record<string, unknown>) => ({
  id: 'x',
  key: 'LC-9',
  number: 9,
  project_id: 'laika-core',
  title: 'A task',
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
  updated_at: Date.now() - 3_600_000,
  started_at: null,
  completed_at: null,
  ...over,
});

const BLOCKER = task({ id: 't1', key: 'LC-1', number: 1, title: 'The blocker' });
const BLOCKED = task({
  id: 't6',
  key: 'LC-6',
  number: 6,
  title: 'Org settings and org-role management',
  status: 'in_progress',
  priority: 'p1',
  assignee_id: 'u1',
  tags: ['auth', 'core'],
  blocked_by: ['t1'],
});

const STUB: ApiStub = {
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
        task_counts: { backlog: 1, todo: 0, in_progress: 1, review: 0, done: 0, cancelled: 0 },
        blocked_count: 1,
        member_count: 1,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  '/api/v1/projects/laika-core/tasks': { data: [BLOCKER, BLOCKED], next_cursor: null },
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
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u1',
        name: 'Ada Lovelace',
        is_agent: true,
        matched_task_id: null,
        project_ids: ['laika-core'],
        last_seen: Date.now(),
        repo: 'kvelld/laika',
        branch: 'lc-1',
      },
    ],
  },
};

void after(async () => {
  await closeBrowser();
});

void describe('the List view', () => {
  void test('uses the design’s column widths', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      const width = async (selector: string) =>
        Math.round((await h.page.locator(selector).first().boundingBox())?.width ?? -1);

      // The design's own figures: KEY 74 · STATUS 104 · PRI 42 · ASSIGNEE 150 ·
      // SPR 46, with SUMMARY taking what is left. PRI is 58 since LAI-705 put
      // Jira's icon before `P1`; it is asserted in priority-icons.test.ts.
      assert.equal(await width('.list-key'), 74, 'KEY');
      assert.equal(await width('.list-spr'), 46, 'SPR');
      /*
       * **UPDATED is no longer the design's 84** (LAI-491, re-aimed on
       * purpose). 84px was sized for `6d`; D-065 made the label
       * `25 Aug 2025, 01:01`, which wrapped onto three lines. What holds now
       * is that the two date columns match — the one-line property itself is
       * asserted where a long date is on screen (LAI-491's own test).
       */
      assert.equal(await width('.list-updated'), await width('.list-created'), 'CREATED ≠ UPDATED');

      const summary = await width('.list-summary');
      assert.ok(summary > 200, `SUMMARY collapsed to ${String(summary)}px`);
    } finally {
      await h.close();
    }
  });

  void test('carries none of the board’s chrome', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      /*
       * **Positive control first.** Every assertion below is an absence, and a
       * page that failed to render would satisfy all three — the blank-login
       * defect of LAI-251, which passed for exactly that reason. So: prove the
       * screen is really here before proving what is not.
       */
      assert.equal(await h.page.locator('.list-row').count(), 2, 'the rows must be present');

      /*
        The rail is nobody's now: LAI-281 moved those panels to the Activity
        tab and left the board plain, so this asserts the *space* chrome — the
        presence strip and the sprint chips — which is still the board's alone.
      */
      assert.equal(await h.page.locator('.presence').count(), 0, 'WORKING NOW is the board’s');
      assert.equal(await h.page.locator('.strip').count(), 0, 'the sprint chips are the board’s');

      // And the board still has all three, or the fix went too far.
      await h.page.goto(`${h.origin}/board?project=laika-core`);
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.presence').count(), 1, 'the board lost WORKING NOW');
      // Not the sprint chips: this stub has no sprints, so their absence is the
      // fixture rather than the board. The lanes are the board's own chrome.
      assert.ok((await h.page.locator('.lane').count()) >= 4, 'the board lost its lanes');
    } finally {
      await h.close();
    }
  });

  void test('renders the blocker’s key and the design’s status pill', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });

      const blocked = h.page
        .locator('.list-row')
        .filter({ has: h.page.locator('.list-key', { hasText: 'LC-6' }) });

      assert.equal(await blocked.locator('.list-blocked').innerText(), 'blocked by LC-1');
      assert.equal(await blocked.locator('.list-labels').innerText(), 'auth, core');
      assert.equal(await blocked.locator('.list-pri').innerText(), 'P1');
      assert.equal(await blocked.locator('.list-status').innerText(), 'In progress');

      // The pill is a bordered box, not bare text — the design's treatment.
      const pill = await blocked.locator('.list-status').evaluate((el) => {
        const s = getComputedStyle(el);
        return { radius: s.borderTopLeftRadius, border: s.borderTopWidth };
      });
      assert.equal(pill.radius, '5px');
      assert.equal(pill.border, '1px');
    } finally {
      await h.close();
    }
  });

  void test('a row opens the task drawer', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.list-row').first().click();
      await h.page.waitForURL(/task=/, { timeout: 10_000 });
      await h.page.locator('.drawer').waitFor({ timeout: 10_000 });
    } finally {
      await h.close();
    }
  });

  void test('never pushes the page sideways, at any width', async () => {
    const h = await open('/list?project=laika-core', STUB);
    try {
      await h.page.locator('.list-row').first().waitFor({ timeout: 20_000 });
      for (const width of [1440, 1280, 900, 420]) {
        await h.page.setViewportSize({ width, height: 900 });
        await h.page.waitForTimeout(150);
        const overflow = await h.page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert.equal(overflow, 0, `the page scrolls sideways at ${String(width)}px`);
      }
    } finally {
      await h.close();
    }
  });
});

/*
 * **Every task, on a board that does not fit in one page** (LAI-621).
 *
 * `useBoard` asked for `limit: 200` once and took that page as the whole
 * answer. No fixture in this repo returned a `next_cursor`, so nothing could
 * see it: measured on the owner's live board, 251 tasks existed and 200 were
 * drawn — with the lane counts derived from the 200, so the headers stated
 * numbers that were not the project's.
 *
 * The fixture therefore pages. Page one answers with a cursor, page two
 * closes it, and the assertions are about the *total* — a client that stops
 * early cannot satisfy them, which is the property the old fixture could not
 * express.
 *
 * **`getComputedStyle(scroller).overflowY` is deliberately not asserted.**
 * It was, and it could not fail: with `overflow-x: auto` the spec coerces a
 * `visible` counterpart to `auto`, so the computed value reads `auto` however
 * the rule is written. Measured — setting `overflow-y: visible` left every
 * assertion green. What is asserted instead is the behaviour: more table than
 * box, a header that stays, and a `scrollTop` that moves. Restoring the
 * pre-fix stylesheet reds this test, which is the control that says so.
 */
const PAGE_ONE = Array.from({ length: 60 }, (_, i) =>
  task({
    id: `p1-${String(i)}`,
    key: `LC-${String(100 + i)}`,
    number: 100 + i,
    title: `First page task ${String(i)}`,
  }),
);

const PAGE_TWO = Array.from({ length: 5 }, (_, i) =>
  task({
    id: `p2-${String(i)}`,
    key: `LC-${String(200 + i)}`,
    number: 200 + i,
    title: `Second page task ${String(i)}`,
  }),
);

const PAGED: ApiStub = {
  ...STUB,
  /*
   * Keyed by the query on purpose. Page two carries both `limit` and `cursor`,
   * so it matches the more specific key and page one — which sends no cursor —
   * cannot match it. A request for a third page matches neither and is
   * recorded in `unmatched` rather than quietly served page one again.
   */
  '/api/v1/projects/laika-core/tasks?limit=200': {
    data: PAGE_ONE,
    next_cursor: 'PAGE2',
  },
  '/api/v1/projects/laika-core/tasks?limit=200&cursor=PAGE2': {
    data: PAGE_TWO,
    next_cursor: null,
  },
};

/*
 * A cursor that never closes: page one carries a task and a cursor, and every
 * later page is empty and hands the same cursor back. The only way out is the
 * page cap, which is the path this fixture exists to reach.
 */
const ENDLESS: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/tasks?limit=200': {
    data: [task({ id: 'e1', key: 'LC-300', number: 300, title: 'The only loaded task' })],
    next_cursor: 'MORE',
  },
  '/api/v1/projects/laika-core/tasks?limit=200&cursor=MORE': {
    data: [],
    next_cursor: 'MORE',
  },
};

/** Scroll the List with a real mouse wheel and say how far it went. */
async function wheel(h: Harness, by: number): Promise<number> {
  const box = await h.page.locator('.list-scroll').boundingBox();
  if (box === null) return 0;
  await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await h.page.mouse.wheel(0, by);
  await h.page.waitForTimeout(300);
  return h.page.locator('.list-scroll').evaluate((el) => el.scrollTop);
}

void describe('a board larger than one page', () => {
  void test('follows the cursor, so the rows and the count are the whole project', async () => {
    const h = await open('/list?project=laika-core', PAGED);
    try {
      await h.page.locator('.list-pager-count').waitFor({ timeout: 20_000 });

      // 60 + 5. A client that stopped at page one reports 60 here.
      assert.match(
        (await h.page.locator('.list-pager-count').innerText()).trim(),
        /of 65$/,
        'the count is not the whole project — the second page was not fetched',
      );

      // Both pages were actually requested, and nothing was refused for want
      // of a matching stub.
      const asked = h.calls.filter((c) => c.path.endsWith('/tasks')).length;
      assert.ok(asked >= 2, `only ${String(asked)} task request(s) — the cursor was not followed`);
      assert.deepEqual(h.unmatched, [], 'a task request matched no fixture');
    } finally {
      await h.close();
    }
  });

  void test('pages the table rather than drawing every row at once', async () => {
    const h = await open('/list?project=laika-core', PAGED);
    try {
      await h.page.locator('.list-pager-count').waitFor({ timeout: 20_000 });

      assert.equal(await h.page.locator('.list tbody tr').count(), 50, 'a page is not 50 rows');

      const pager = h.page.locator('.list-pager-count');
      assert.match((await pager.innerText()).trim(), /^1–50 of 65$/);

      await h.page.locator('.list-page-button', { hasText: 'Next' }).click();
      await h.page.waitForFunction(
        () => (document.querySelector('.list-pager-count')?.textContent ?? '').startsWith('51'),
        undefined,
        { timeout: 10_000 },
      );

      assert.equal(await h.page.locator('.list tbody tr').count(), 15, 'the last page is short');
      assert.match((await pager.innerText()).trim(), /^51–65 of 65$/);

      // At the end, forward is refused and back is offered — disabled rather
      // than removed, so the row does not change height as you page.
      assert.equal(
        await h.page.locator('.list-page-button', { hasText: 'Next' }).isDisabled(),
        true,
      );
      assert.equal(
        await h.page.locator('.list-page-button', { hasText: 'Previous' }).isDisabled(),
        false,
      );
    } finally {
      await h.close();
    }
  });

  void test('the table scrolls inside its own box, under a header that stays', async () => {
    const h = await open('/list?project=laika-core', PAGED);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });

      const seen = await h.page.evaluate(() => {
        const scroller = document.querySelector('.list-scroll');
        const head = document.querySelector('.list thead th');
        if (scroller === null || head === null) return null;
        return {
          headPosition: getComputedStyle(head).position,
          // The property that matters: there is more table than box, and the
          // box is the thing that scrolls.
          scrollable: scroller.scrollHeight > scroller.clientHeight,
        };
      });

      assert.ok(seen !== null, 'no list scroller on the page');
      assert.equal(seen.headPosition, 'sticky', 'the header scrolls away with the rows');
      assert.ok(
        seen.scrollable,
        'fifty rows did not overflow the box — this assertion is measuring nothing',
      );

      /*
       * **A real wheel, not `scrollTop` from script** (LAI-621 review). Setting
       * `scrollTop` works on `overflow-y: hidden` too — measured: that rule
       * left this test green while the box could not be scrolled by a person.
       * A wheel over a clipped box does nothing, which is the difference.
       */
      const moved = await wheel(h, 600);
      assert.ok(moved > 0, 'the wheel did not scroll the list — the box clips instead');
    } finally {
      await h.close();
    }
  });

  void test('the header stays at the top of the box while the rows scroll under it', async () => {
    const h = await open('/list?project=laika-core', PAGED);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });

      /*
       * **Where the header is, not what it computes** (LAI-621 review). The
       * test above asserts `position: sticky`, which stayed true while the
       * header scrolled 700px out of view: a leftover `.list { overflow:
       * hidden }` in `board.css` made the *table* the header's scroll
       * container, so it stuck to the table and left with it.
       */
      const moved = await wheel(h, 600);
      assert.ok(moved > 0, 'nothing scrolled, so this cannot say anything about the header');

      const gap = await h.page.evaluate(() => {
        const scroller = document.querySelector('.list-scroll');
        const head = document.querySelector('.list thead th');
        if (scroller === null || head === null) return null;
        return head.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      });
      assert.ok(gap !== null, 'no header or no scroller');
      assert.ok(
        Math.abs(gap) <= 2,
        `the header is ${String(Math.round(gap))}px from the top of the box — it scrolled away`,
      );
    } finally {
      await h.close();
    }
  });

  void test('the board lane counts are the whole project too, not the first page', async () => {
    /*
     * AC2's other half. The lanes and the List read the same array today,
     * which is exactly why it is pinned: a later change that gives the board
     * its own fetch would otherwise be free to stop at page one again.
     */
    const h = await open('/board?project=laika-core', PAGED);
    try {
      await h.page.locator('.lane-count').first().waitFor({ timeout: 20_000 });
      await h.page.waitForTimeout(300);
      const counts = (await h.page.locator('.lane-count').allInnerTexts()).map((t) =>
        Number(t.replace(/\D/g, '') || '0'),
      );
      const total = counts.reduce((a, b) => a + b, 0);
      assert.equal(total, 65, `the lanes count ${String(total)} (${counts.join(' + ')}), not 65`);
    } finally {
      await h.close();
    }
  });

  void test('a board past the page cap says so rather than looking complete', async () => {
    /*
     * `useBoard` stops after 25 pages and records `truncated`. It used to say
     * *"the screen says so"* while nothing read it. A cursor that never ends
     * is the shape that reaches the cap without 5,000 fixtures.
     */
    const h = await open('/list?project=laika-core', ENDLESS);
    try {
      await h.page.locator('.list-pager-count').waitFor({ timeout: 20_000 });
      const note = h.page.locator('.board-truncated');
      await note.waitFor({ timeout: 10_000 });
      assert.match(await note.innerText(), /first 1 task/i);
      // The note only exists once the loop has *ended* — `truncated` is set
      // after it — so reaching this line already proves the loop is bounded.
      // What is left to prove is that it ended at the cap, not early. (Not an
      // exact count: another screen part also asks `/tasks` once, and the
      // harness records paths without their query.)
      const asked = h.calls.filter((c) => c.path.endsWith('/tasks')).length;
      assert.ok(asked >= 25, `only ${String(asked)} task requests — it stopped before the cap`);
    } finally {
      await h.close();
    }
  });

  void test('says when a task was made, as well as when it was touched', async () => {
    const h = await open('/list?project=laika-core', PAGED);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });

      const headers = (await h.page.locator('.list thead th').allInnerTexts()).map((t) =>
        t.replace(/[▲▼]/g, '').trim().toLowerCase(),
      );
      assert.ok(headers.includes('created'), `no Created column: ${headers.join(', ')}`);
      assert.ok(headers.includes('updated'), `no Updated column: ${headers.join(', ')}`);

      const first = h.page.locator('.list tbody tr').first();
      assert.equal(await first.locator('.list-created').count(), 1, 'no created cell in a row');
      assert.notEqual(
        (await first.locator('.list-created').innerText()).trim(),
        '',
        'the created cell is empty',
      );
    } finally {
      await h.close();
    }
  });
});

/*
 * **The List's sort is URL state** (LAI-485, D-065).
 *
 * It was `useState` inside `ListView`, which `BoardScreen` unmounts on every
 * refetch — every stream tick, Refresh, create and edit — so the reader's sort
 * snapped back to KEY ▲ whenever anyone touched any task, and a sorted List
 * could not be linked. The default is newest-updated first, and it is not
 * written to the URL.
 */
const SORTABLE: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/tasks': {
    data: [
      task({ id: 's1', key: 'LC-1', number: 1, title: 'Oldest touch', updated_at: 1_000 }),
      task({ id: 's3', key: 'LC-3', number: 3, title: 'Newest touch', updated_at: 3_000 }),
      task({ id: 's2', key: 'LC-2', number: 2, title: 'Middle touch', updated_at: 2_000 }),
    ],
    next_cursor: null,
  },
};

const firstKey = async (h: Harness): Promise<string> =>
  (await h.page.locator('.list tbody tr').first().locator('.list-key').innerText()).trim();

const sortOf = async (h: Harness, label: string): Promise<string | null> =>
  h.page.locator('.list thead th', { hasText: label }).first().getAttribute('aria-sort');

void describe('the List sort lives in the URL (LAI-485)', () => {
  void test('a bare /list is newest-updated first, and says so without writing it', async () => {
    const h = await open('/list?project=laika-core', SORTABLE);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.match(await firstKey(h), /LC-3/, 'the newest-updated task is not first');
      assert.equal(await sortOf(h, 'Updated'), 'descending', 'UPDATED does not say it is the sort');
      assert.doesNotMatch(h.page.url(), /[?&](sort|dir)=/, 'the default was written to the URL');
    } finally {
      await h.close();
    }
  });

  void test('clicking a header writes the URL, and a reload keeps the order', async () => {
    const h = await open('/list?project=laika-core', SORTABLE);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      await h.page
        .locator('.list thead th', { hasText: 'Key' })
        .first()
        .locator('.list-sort')
        .click();
      await h.page.waitForURL(/sort=key/, { timeout: 10_000 });
      assert.match(h.page.url(), /dir=asc/, 'KEY did not start ascending');
      assert.match(await firstKey(h), /LC-1/);

      await h.page.reload();
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.match(await firstKey(h), /LC-1/, 'a reload lost the sort');
      assert.equal(await sortOf(h, 'Key'), 'ascending');
    } finally {
      await h.close();
    }
  });

  void test('a new sort or a new filter goes back to page one', async () => {
    // A page number from a different ordering, or a different set of rows,
    // points at arbitrary work.
    const h = await open('/list?project=laika-core&page=2', PAGED);
    try {
      await h.page.locator('.list-pager-count').waitFor({ timeout: 20_000 });
      assert.match((await h.page.locator('.list-pager-count').innerText()).trim(), /^51–65/);

      await h.page
        .locator('.list thead th', { hasText: 'Summary' })
        .first()
        .locator('.list-sort')
        .click();
      await h.page.waitForURL(/sort=title/, { timeout: 10_000 });
      assert.doesNotMatch(h.page.url(), /[?&]page=/, 'a sort change kept the page');

      await h.page.locator('.list-page-button', { hasText: 'Next' }).click();
      await h.page.waitForURL(/page=2/, { timeout: 10_000 });
      // A filter written by the toolbar's search box, not by this screen.
      await h.page.getByPlaceholder('Search board').fill('task');
      await h.page.waitForURL(/[?&]q=task/, { timeout: 10_000 });
      await h.page.waitForFunction(() => !/[?&]page=/.test(location.search), undefined, {
        timeout: 10_000,
      });
      assert.match((await h.page.locator('.list-pager-count').innerText()).trim(), /^1–50/);
    } finally {
      await h.close();
    }
  });

  void test('sort and page survive a live refresh', async () => {
    // The defect the owner saw: any refetch remounted the table and reset it.
    const h = await open('/list?project=laika-core', PAGED);
    try {
      await h.page.locator('.list-pager-count').waitFor({ timeout: 20_000 });
      await h.page
        .locator('.list thead th', { hasText: 'Key' })
        .first()
        .locator('.list-sort')
        .click();
      await h.page.waitForURL(/sort=key/, { timeout: 10_000 });
      await h.page.locator('.list-page-button', { hasText: 'Next' }).click();
      await h.page.waitForURL(/page=2/, { timeout: 10_000 });
      const before = await firstKey(h);

      await h.page.locator('button[title="Refresh the board"]').click();
      await h.page.waitForTimeout(600);
      await h.page.locator('.list-pager-count').waitFor({ timeout: 20_000 });

      assert.match((await h.page.locator('.list-pager-count').innerText()).trim(), /^51–65 of 65$/);
      assert.equal(await firstKey(h), before, 'the refresh moved the reader');
      assert.equal(await sortOf(h, 'Key'), 'ascending', 'the refresh reset the sort');
    } finally {
      await h.close();
    }
  });
});

/*
 * **Timestamps: relative for a day, then a date** (LAI-486, D-065).
 *
 * The clock is Playwright's, installed and then reloaded so the app's own
 * `Date.now()` and `setInterval` are the fake ones. Every fixture stamp is
 * relative to that fixed `T`, so the expected text never depends on when the
 * suite runs.
 */
const T = new Date(2026, 8, 28, 15, 30, 0).getTime();
const CLOCKED: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/tasks': {
    data: [
      task({
        id: 'c1',
        key: 'LC-1',
        number: 1,
        title: 'Fresh',
        created_at: T - 30_000,
        updated_at: T - 30_000,
      }),
      task({
        id: 'c2',
        key: 'LC-2',
        number: 2,
        title: 'Older',
        created_at: T - 3 * 86_400_000,
        updated_at: T - 3 * 86_400_000,
      }),
    ],
    next_cursor: null,
  },
  '/api/v1/tasks/c1': task({
    id: 'c1',
    key: 'LC-1',
    number: 1,
    title: 'Fresh',
    created_at: T - 30_000,
    updated_at: T - 30_000,
  }),
};

async function onTheClock(path: string): Promise<Harness> {
  const h = await open(path, CLOCKED);
  await h.page.clock.install({ time: T });
  await h.page.reload();
  await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
  return h;
}

const cell = (h: Harness, key: string, column: 'created' | 'updated') =>
  h.page
    .locator('.list tbody tr')
    .filter({ has: h.page.locator('.list-key', { hasText: key }) })
    .locator(`.list-${column} time`);

void describe('timestamps read as moments (LAI-486)', () => {
  void test('fresh work says just now, older work says a date, and the full moment is on hover', async () => {
    const h = await onTheClock('/list?project=laika-core');
    try {
      assert.equal((await cell(h, 'LC-1', 'updated').innerText()).trim(), 'just now');
      assert.equal((await cell(h, 'LC-2', 'updated').innerText()).trim(), '25 Sep, 15:30');
      assert.equal(
        await cell(h, 'LC-2', 'created').getAttribute('title'),
        'Fri 25 Sep 2026, 15:30:00',
      );
      assert.ok(
        (await cell(h, 'LC-1', 'created').getAttribute('datetime')) !== null,
        'no machine-readable moment',
      );
      const tone = await h.page
        .locator('.list tbody tr')
        .filter({ has: h.page.locator('.list-key', { hasText: 'LC-1' }) })
        .locator('.list-updated')
        .getAttribute('class');
      assert.match(tone ?? '', /list-tone-accent/, 'under an hour is not drawn as fresh');
    } finally {
      await h.close();
    }
  });

  void test('a table left open keeps moving: two minutes later it says so', async () => {
    const h = await onTheClock('/list?project=laika-core');
    try {
      assert.equal((await cell(h, 'LC-1', 'updated').innerText()).trim(), 'just now');
      await h.page.clock.fastForward('02:00');
      await h.page.waitForTimeout(200);
      assert.equal(
        (await cell(h, 'LC-1', 'updated').innerText()).trim(),
        '2 min ago',
        'the label did not move without a reload',
      );
    } finally {
      await h.close();
    }
  });

  void test('the drawer’s foot gives both moments in full, never "just now ago"', async () => {
    /*
     * The byline under the title is gone (D-066): the two times are the foot of
     * the rail now, written out as the Jira screenshot has them. The thing
     * LAI-486 fixed — an "ago" appended to a label that carries its own — can
     * no longer happen here, and this keeps it that way.
     */
    const h = await onTheClock('/list?project=laika-core&task=c1');
    try {
      const foot = h.page.locator('.panel-foot-times');
      await foot.waitFor({ timeout: 20_000 });
      const text = (await foot.innerText()).replace(/\s+/g, ' ').trim();
      assert.match(
        text,
        /^Created \w{3} \d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2} Updated /,
        `the foot reads "${text}"`,
      );
      assert.doesNotMatch(text, /ago/);
    } finally {
      await h.close();
    }
  });
});

/*
 * **The shared Filter popover gains Status, Sprint, Blocked only and Updated
 * within** (LAI-487). Driven on `/list`, where no filter test existed, and once
 * on `/board`, where the same popover lives.
 *
 * Server-side filters are keyed by query, so the rows really change because
 * the request changed; `?limit=200` alone serves everything. `updated_since`
 * is a timestamp computed at request time, so that one is asserted on the
 * request itself.
 */
const DONE = task({ id: 't9', key: 'LC-9', number: 9, title: 'Shipped work', status: 'done' });
const FILTERABLE: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/sprints': {
    data: [
      {
        id: 's1',
        project_id: 'laika-core',
        name: 'Foundations',
        goal: null,
        status: 'active',
        starts_on: 1,
        ends_on: 2,
        created_at: 1,
        updated_at: 1,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/tasks': { data: [BLOCKER, BLOCKED, DONE], next_cursor: null },
  '/api/v1/projects/laika-core/tasks?limit=200': {
    data: [BLOCKER, BLOCKED, DONE],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/tasks?status=done&limit=200': { data: [DONE], next_cursor: null },
  '/api/v1/projects/laika-core/tasks?sprint=s1&limit=200': { data: [BLOCKED], next_cursor: null },
};

const keysOnScreen = async (h: Harness): Promise<string[]> =>
  (await h.page.locator('.list tbody .list-key').allInnerTexts())
    // The cell also carries a visually hidden "— open details" for a screen
    // reader; the key is the first line.
    .map((k) => (k.split('\n')[0] ?? '').trim())
    .sort();

const field = (h: Harness, label: string) =>
  h.page.locator('.bt-pop label.bt-field', { hasText: label }).locator('select');

const badge = async (h: Harness): Promise<string> =>
  (await h.page.locator('.bt-badge').count()) === 0
    ? '0'
    : (await h.page.locator('.bt-badge').innerText()).trim();

async function openFilter(h: Harness): Promise<void> {
  if ((await h.page.locator('.bt-pop').count()) === 0) {
    await h.page.getByRole('button', { name: /^Filter/ }).click();
  }
  await h.page.locator('.bt-pop').waitFor({ timeout: 5_000 });
}

void describe('the Filter popover on the List (LAI-487)', () => {
  void test('status, sprint, blocked and updated each write the URL, change what is asked, and count', async () => {
    const h = await open('/list?project=laika-core', FILTERABLE);
    const asked: string[] = [];
    h.page.on('request', (r) => {
      if (r.url().includes('/tasks?')) asked.push(r.url());
    });
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(
        await keysOnScreen(h),
        ['LC-1', 'LC-6', 'LC-9'],
        'positive control: all three',
      );

      // Status — server-side, so the rows change because the request did.
      await openFilter(h);
      await field(h, 'Status').selectOption('done');
      await h.page.waitForURL(/status=done/, { timeout: 10_000 });
      await h.page.waitForFunction(() => document.querySelectorAll('.list tbody tr').length === 1);
      assert.deepEqual(await keysOnScreen(h), ['LC-9']);
      assert.equal(await badge(h), '1');

      // Clear all empties every filter key and keeps the project.
      await openFilter(h);
      await h.page.locator('.bt-pop .bt-clear').click();
      await h.page.waitForFunction(() => !location.search.includes('status='));
      assert.match(h.page.url(), /project=laika-core/);
      await h.page.waitForFunction(() => document.querySelectorAll('.list tbody tr').length === 3);

      // Blocked only — decided in the browser. With everything loaded, LC-6's
      // blocker LC-1 is known and open: LC-6 stays, LC-1 and LC-9 go.
      await openFilter(h);
      await h.page
        .locator('.bt-pop label.bt-check', { hasText: 'Blocked only' })
        .locator('input')
        .check();
      await h.page.waitForURL(/blocked=true/, { timeout: 10_000 });
      await h.page.waitForFunction(() => document.querySelectorAll('.list tbody tr').length === 1);
      assert.deepEqual(await keysOnScreen(h), ['LC-6'], 'the blocked task is not the one shown');

      // Sprint — the same `?sprint=` the Board's strip writes. LC-1 is in no
      // sprint and is no longer loaded, so LC-6's blocker **cannot be judged**:
      // it stays, because hiding maybe-blocked work from "Blocked only" is the
      // damaging error.
      await openFilter(h);
      await field(h, 'Sprint').selectOption('s1');
      await h.page.waitForURL(/sprint=s1/, { timeout: 10_000 });
      await h.page.waitForTimeout(400);
      assert.deepEqual(await keysOnScreen(h), ['LC-6'], 'a maybe-blocked task was hidden');

      // Updated within — a window in the URL, a timestamp on the wire.
      await openFilter(h);
      const before = Date.now();
      await field(h, 'Updated within').selectOption('7d');
      await h.page.waitForURL(/updated=7d/, { timeout: 10_000 });
      await h.page.waitForTimeout(400);
      const sent = asked
        .map((u) => new URL(u).searchParams.get('updated_since'))
        .filter((v) => v !== null);
      assert.ok(sent.length > 0, 'no request carried updated_since');
      const since = Number(sent.at(-1));
      const expected = before - 7 * 86_400_000;
      assert.ok(
        Math.abs(since - expected) < 60_000,
        `updated_since ${String(since)} is not seven days back`,
      );
      assert.doesNotMatch(
        h.page.url(),
        /updated_since/,
        'the timestamp leaked into the address bar',
      );

      assert.equal(await badge(h), '3', 'sprint + blocked + updated');

      await openFilter(h);
      await h.page.locator('.bt-pop .bt-clear').click();
      await h.page.waitForFunction(
        () => !/(sprint|blocked|updated)=/.test(location.search),
        undefined,
        { timeout: 10_000 },
      );
      assert.equal(await badge(h), '0');
    } finally {
      await h.close();
    }
  });

  void test('a junk value in the URL is ignored, not sent and not counted', async () => {
    const h = await open(
      '/list?project=laika-core&status=bogus&updated=90d&blocked=yes',
      FILTERABLE,
    );
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await keysOnScreen(h), ['LC-1', 'LC-6', 'LC-9']);
      assert.equal(await badge(h), '0');
      assert.deepEqual(h.unmatched, [], 'a junk status reached the server');
    } finally {
      await h.close();
    }
  });

  void test('the same popover works on the Board', async () => {
    const h = await open('/board?project=laika-core', FILTERABLE);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await openFilter(h);
      const labels = (await h.page.locator('.bt-pop .bt-label').allInnerTexts()).map((t) =>
        t.trim().toLowerCase(),
      );
      assert.deepEqual(labels, [
        'status',
        'priority',
        'assignee',
        'label',
        'sprint',
        'updated within',
      ]);
      await field(h, 'Status').selectOption('done');
      await h.page.waitForURL(/status=done/, { timeout: 10_000 });
      assert.equal(await badge(h), '1');
    } finally {
      await h.close();
    }
  });
});

/*
 * **Board and List keep the same filters, and the List hides what cannot
 * apply** (LAI-488). Every absence is asserted **against its presence on the
 * Board**, so a control deleted everywhere cannot pass as "hidden on the List".
 */
const tabTo = async (h: Harness, label: 'Board' | 'List'): Promise<void> => {
  await h.page
    .locator('.view-tabs a', { hasText: new RegExp(`^${label}`) })
    .first()
    .click();
};

const vsLabels = async (h: Harness): Promise<string[]> => {
  await h.page.locator('button[title="View settings"]').click();
  await h.page.locator('.vs-label').first().waitFor({ timeout: 5_000 });
  const labels = (await h.page.locator('.vs-label').allInnerTexts()).map((t) =>
    t.trim().toLowerCase(),
  );
  await h.page.keyboard.press('Escape');
  return labels;
};

const moreItems = async (h: Harness): Promise<string[]> => {
  await h.page.locator('button[title="More"]').click();
  await h.page.locator('.bt-menu').waitFor({ timeout: 5_000 });
  const items = (await h.page.locator('.bt-menu .bt-menu-item').allInnerTexts()).map((t) =>
    t.trim(),
  );
  await h.page.keyboard.press('Escape');
  return items;
};

void describe('Board and List share one filter state (LAI-488)', () => {
  void test('filters and search travel Board → List, and back', async () => {
    const h = await open('/board?project=laika-core&status=done&q=shipped', FILTERABLE);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await tabTo(h, 'List');
      await h.page.waitForURL(/\/list\?/, { timeout: 10_000 });
      const onList = new URL(h.page.url()).searchParams;
      assert.equal(onList.get('status'), 'done', 'status was dropped by the tab');
      assert.equal(onList.get('q'), 'shipped', 'search was dropped by the tab');
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(
        await keysOnScreen(h),
        ['LC-9'],
        'the List is not showing the filtered rows',
      );

      // And back, with a filter set on the List side.
      await openFilter(h);
      await h.page
        .locator('.bt-pop label.bt-check', { hasText: 'Blocked only' })
        .locator('input')
        .check();
      await h.page.waitForURL(/blocked=true/, { timeout: 10_000 });
      await h.page.keyboard.press('Escape');
      await tabTo(h, 'Board');
      await h.page.waitForURL(/\/board\?/, { timeout: 10_000 });
      const onBoard = new URL(h.page.url()).searchParams;
      for (const key of ['status', 'q', 'blocked']) {
        assert.ok(onBoard.has(key), `${key} did not come back to the Board`);
      }

      // A reload keeps them — already true, asserted so it stays true.
      await h.page.reload();
      await h.page.waitForTimeout(500);
      assert.equal(new URL(h.page.url()).searchParams.get('status'), 'done');
    } finally {
      await h.close();
    }
  });

  void test('sort, page and group do not travel', async () => {
    const h = await open(
      '/list?project=laika-core&sort=key&dir=asc&page=1&group=assignee',
      FILTERABLE,
    );
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      await tabTo(h, 'Board');
      await h.page.waitForURL(/\/board/, { timeout: 10_000 });
      const sent = new URL(h.page.url()).searchParams;
      for (const key of ['sort', 'dir', 'page', 'group']) {
        assert.equal(sent.has(key), false, `${key} travelled to the Board`);
      }
    } finally {
      await h.close();
    }
  });

  void test('the Board offers Group, card settings and "Show as list" — the control', async () => {
    const h = await open('/board?project=laika-core', FILTERABLE);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.bt-button', { hasText: 'Group' }).count(),
        1,
        'no Group on the Board',
      );
      const labels = await vsLabels(h);
      for (const section of ['group by', 'show fields', 'card density', 'column width', 'filter']) {
        assert.ok(labels.includes(section), `the Board lost "${section}" — ${labels.join(', ')}`);
      }
      assert.ok((await moreItems(h)).includes('Show as list'));
    } finally {
      await h.close();
    }
  });

  void test('the List hides them — absent, not disabled — and keeps Filter and Hide done', async () => {
    const h = await open('/list?project=laika-core&group=assignee', FILTERABLE);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.bt-button', { hasText: 'Group' }).count(),
        0,
        'Group is on the List',
      );
      assert.equal(await h.page.locator('.board-scope', { hasText: /Grouped by/i }).count(), 0);
      const labels = await vsLabels(h);
      for (const section of ['group by', 'show fields', 'card density', 'column width']) {
        assert.ok(!labels.includes(section), `"${section}" is offered on the List`);
      }
      assert.ok(labels.includes('filter'), 'the List lost its filter chips');
      assert.ok(labels.includes('hide done work items'), 'the List lost Hide done');
      const items = await moreItems(h);
      assert.ok(items.length > 0, 'positive control: the menu opened');
      assert.ok(
        !items.some((i) => i.startsWith('Show as')),
        `"Show as" is on the List: ${items.join(', ')}`,
      );
      // `?group=` is ignored here, and not deleted: it is the Board's to keep.
      assert.equal(new URL(h.page.url()).searchParams.get('group'), 'assignee');
    } finally {
      await h.close();
    }
  });

  void test('a legacy /board?view=list link still renders the List', async () => {
    const h = await open('/board?project=laika-core&view=list', FILTERABLE);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('table.list').count(), 1);
    } finally {
      await h.close();
    }
  });
});

/*
 * **No date wraps** (LAI-491). LAI-486's labels are longer than the `6d` the
 * design's 84px column was sized for, and wrapped onto two and three lines.
 * Asserted by the `<time>` element's own line count, on the longest form a
 * date takes — an old year — so a width constant is never the thing trusted.
 */
void describe('the date columns hold one line (LAI-491)', () => {
  void test('the longest form, with a year, stays on one line in both columns', async () => {
    const old = new Date(2025, 7, 25, 1, 1, 0).getTime();
    const OLD: ApiStub = {
      ...STUB,
      '/api/v1/projects/laika-core/tasks': {
        data: [
          task({
            id: 'o1',
            key: 'LC-1',
            number: 1,
            title: 'Old',
            created_at: old,
            updated_at: old,
          }),
          task({
            id: 'o2',
            key: 'LC-2',
            number: 2,
            title: 'Fresh',
            created_at: Date.now() - 20 * 60_000,
            updated_at: Date.now() - 20 * 60_000,
          }),
        ],
        next_cursor: null,
      },
    };
    const h = await open('/list?project=laika-core', OLD);
    try {
      await h.page.locator('.list tbody tr').first().waitFor({ timeout: 20_000 });
      const lines = await h.page.evaluate(() =>
        [...document.querySelectorAll('.list-created time, .list-updated time')].map((t) => ({
          text: t.textContent ?? '',
          lines: t.getClientRects().length,
        })),
      );
      assert.ok(
        lines.some((l) => l.text.includes('2025')),
        'positive control: a dated-year label is on screen',
      );
      for (const l of lines) {
        assert.equal(l.lines, 1, `"${l.text}" wraps onto ${String(l.lines)} lines`);
      }
    } finally {
      await h.close();
    }
  });
});
