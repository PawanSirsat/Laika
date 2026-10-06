/**
 * The card's anatomy (LAI-263).
 *
 * Owner-reported against the reference with a populated board: too little
 * padding, too light a title, no comment count, no timestamp, and a blocked
 * banner that wrapped to two lines. Every figure here is the design's own
 * (`docs/design/Laika Prototype.dc.html`, card at ~line 290) and every value
 * comes from `TaskView` — nothing on a card is generated.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

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
  task_counts: { backlog: 2, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
  blocked_count: 1,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const HOUR = 3_600_000;

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
  // Relative to *now*, never a fixed epoch — a pinned fixture read as 240 days
  // old twice before (LAI-420).
  updated_at: Date.now() - 2 * HOUR,
  started_at: null,
  completed_at: null,
  ...over,
});

const BLOCKER = task({
  id: 't-blocker',
  key: 'LC-1',
  number: 1,
  title: 'Presence strip reads the heartbeat table and keeps it current',
});

const BLOCKED = task({
  id: 't-blocked',
  key: 'LC-6',
  number: 6,
  title: 'Org settings and org-role management',
  comment_count: 3,
  blocked_by: ['t-blocker'],
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
  '/api/v1/projects': { data: [CORE], next_cursor: null },
  '/api/v1/projects/laika-core': {
    id: CORE.id,
    slug: CORE.slug,
    prefix: CORE.prefix,
    name: CORE.name,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/projects/laika-core/tasks': { data: [BLOCKER, BLOCKED], next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: false,
    created_at: 1,
    updated_at: 1,
  },
  '/api/v1/presence': { enabled: false, present: [] },
};

void after(async () => {
  await closeBrowser();
});

void describe('the column header and the board’s air (LAI-272)', () => {
  /**
   * **Dot, name and count read as one group on the left.**
   *
   * A pre-rebuild `.lane-head` carried `justify-content: space-between` and the
   * rebuilt rule below it set none, so the count drifted to the far edge of the
   * column and the name floated in the middle. Measured by position, because
   * both arrangements contain exactly the same three elements.
   */
  void test('groups the dot, name and count to the left', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.lane-head').first().waitFor({ timeout: 20_000 });
      const head = h.page.locator('.lane-head').first();

      const lane = (await head.boundingBox())?.width ?? 0;
      const title = await head.locator('.lane-title').boundingBox();
      const count = await head.locator('.lane-count').boundingBox();
      assert.ok(lane > 0 && title !== null && count !== null, 'the header is missing a part');

      // The count begins just after the name ends, rather than at the far edge.
      const gap = count.x - (title.x + title.width);
      assert.ok(gap < 14, `the count is ${String(Math.round(gap))}px adrift of the name`);

      /*
       * And the column's slack is to the **right** of the group, not inside it.
       * `space-between` puts the count hard against the right edge, so this is
       * the assertion that tells the two layouts apart at any column width —
       * a fraction-of-the-width bound is not, because a narrow column can be
       * more than half full of a correctly grouped header.
       */
      const headBox = (await head.boundingBox())!;
      const slack = headBox.x + headBox.width - (count.x + count.width);
      assert.ok(slack > 20, `only ${String(Math.round(slack))}px right of the count — it is flush`);
    } finally {
      await h.close();
    }
  });

  /**
   * **The gap above the tubs**, which the owner reported missing against the
   * reference: our columns began on the band's own border, with nothing
   * between them.
   */
  void test('leaves air between the band above and the first tub', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.lane').first().waitFor({ timeout: 20_000 });
      const main = await h.page.locator('.board-main').boundingBox();
      const lane = await h.page.locator('.lane').first().boundingBox();
      assert.ok(main !== null && lane !== null);

      const air = lane.y - main.y;
      assert.ok(air >= 12, `the tubs start ${String(Math.round(air))}px in — they are flush`);
    } finally {
      await h.close();
    }
  });
});

void describe('the card', () => {
  void test('carries the design’s padding and title', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });

      const box = await h.page
        .locator('.card')
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return { padding: s.padding };
        });
      /*
       * LAI-605: the prototype file's own card — 13px round, 11 at the foot.
       * (The addendum's 20/20/16 was the interim scale before the owner chose
       * the file's numbers.)
       */
      assert.equal(box.padding, '13px 13px 11px', 'the prototype’s card padding');

      const title = await h.page
        .locator('.card-title')
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return { size: s.fontSize, weight: s.fontWeight, clamp: s.webkitLineClamp };
        });
      // `.t-body` carries the title: the file's 13.5/600 (LAI-605).
      assert.equal(title.size, '13.5px');
      assert.equal(title.weight, '600');
      assert.equal(title.clamp, '2', 'the title must clamp rather than push the footer about');
    } finally {
      await h.close();
    }
  });

  /*
   * The comment count and the age tests that stood here were removed with
   * the fields themselves (LAI-701): the owner took both off the card.
   * `card-footer.test.ts` proves their absence on a task that has comments.
   */

  void test('keeps the blocked banner on one line, however long the blocker', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      const banner = h.page.locator('.card-blocked').first();
      await banner.waitFor({ timeout: 20_000 });

      const text = await banner.innerText();
      assert.match(text, /blocked by/);
      assert.match(text, /LC-1/, 'the blocker’s key must never truncate away');

      /*
       * One line. The blocker's title here is deliberately long — the banner
       * wrapped to two before, and a height that grows with the title is the
       * thing the owner reported.
       */
      const height = (await banner.boundingBox())?.height ?? 0;
      // 28px IS the banner's height now (min-height, LAI-606); one line of
      // 13px caption inside it tops out well under 34, two lines cannot fit.
      assert.ok(height <= 30, `the banner is ${String(Math.round(height))}px — it wrapped`);
    } finally {
      await h.close();
    }
  });
});

/**
 * The meta row at the brief's worst case: 218px lanes (LAI-606).
 *
 * Two properties, asserted the honest way each: the key by `scrollWidth`
 * (an ellipsis is invisible to a bounding box), the single line by the row's
 * *height* against its tallest child — child `top`s are useless under
 * `align-items: center`, where a 36px avatar and a 12px dot legitimately
 * start at different y on the same line. That false positive was measured
 * before this comment was written.
 */
void describe('the meta row at 218px', () => {
  void test('the key never truncates; the row is one line at 218px and breaks, not escapes, at 120px', async () => {
    const h = await open('/board?project=laika-core', STUB);

    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await h.page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>('.kanban');
        if (grid === null) return;
        grid.style.setProperty('--lane-floor', '218px');
        grid.style.gridTemplateColumns = 'repeat(4, 218px)';
      });
      await h.page.waitForTimeout(400);

      const m = await h.page.evaluate(() => {
        const truncated: string[] = [];
        document.querySelectorAll('.card-key').forEach((k) => {
          if (k.scrollWidth > k.clientWidth + 1) truncated.push(k.textContent?.trim() ?? '?');
        });
        const tallFeet = [...document.querySelectorAll('.card-foot')].filter((f) => {
          const tallest = Math.max(
            0,
            ...[...f.children].map((c) => c.getBoundingClientRect().height),
          );
          const style = getComputedStyle(f);
          const inner =
            f.getBoundingClientRect().height -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom) -
            parseFloat(style.borderTopWidth);
          /*
           * Against the larger of the tallest child and the row's own 36px
           * min-height — a row of small children (no avatar) is legitimately
           * taller than its tallest child because the *floor* holds it open.
           * The first version flagged exactly those rows as wrapped.
           */
          return inner > Math.max(tallest, 36) + 4;
        }).length;
        return { truncated, tallFeet, lanes: document.querySelectorAll('.lane').length };
      });

      assert.ok(m.lanes > 0, 'no lanes — nothing measured');
      assert.deepEqual(m.truncated, [], 'a key truncated at 218px');
      assert.equal(m.tallFeet, 0, 'a meta row wrapped at 218px');

      /*
       * **The squeeze, re-aimed (LAI-701, D-069).** This asserted that at
       * 120px the row still did *not* wrap, guarding LAI-606's one-line
       * footer — whose overflow the comment count and age absorbed by
       * ellipsising. The owner removed both, and an overfull row then pushed
       * the avatar off the card. So the property is now the opposite one: at
       * a width nothing fits, the row breaks between markers, and nothing —
       * the key least of all — is clipped or escapes the card.
       */
      await h.page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>('.kanban');
        if (grid !== null) grid.style.gridTemplateColumns = 'repeat(4, 120px)';
      });
      await h.page.waitForTimeout(300);

      const squeezed = await h.page.evaluate(() => {
        const cards = [...document.querySelectorAll('.card')];
        const escaped: string[] = [];
        let wrapped = 0;
        for (const card of cards) {
          const box = card.getBoundingClientRect();
          const foot = card.querySelector('.card-foot');
          if (foot === null) continue;
          const kids = [...foot.children].filter(
            (c) => !c.classList.contains('visually-hidden') && c.getBoundingClientRect().width > 0,
          );
          const tops = new Set(kids.map((c) => Math.round(c.getBoundingClientRect().top)));
          if (tops.size > 1) wrapped += 1;
          for (const c of kids) {
            if (c.getBoundingClientRect().right > box.right + 0.5) escaped.push(c.className);
          }
        }
        const truncated = [...document.querySelectorAll('.card-key')].filter(
          (k) => k.scrollWidth > k.clientWidth + 1,
        ).length;
        return { escaped, wrapped, truncated };
      });
      assert.deepEqual(squeezed.escaped, [], 'a footer item escaped its card at 120px');
      assert.equal(squeezed.truncated, 0, 'a key truncated at 120px');
      // The guard on the guard: at 120px some row must actually break, or the
      // two assertions above were measured on rows that fit anyway.
      assert.ok(squeezed.wrapped > 0, 'no row wraps at 120px — the squeeze proves nothing');
    } finally {
      await h.close();
    }
  });
});
