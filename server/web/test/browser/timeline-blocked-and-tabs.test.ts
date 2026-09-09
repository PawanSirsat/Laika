/**
 * A blocked row is identifiable, and a sprint can be selected (LAI-436).
 *
 * ## Why this is a browser test and not a class-name assertion
 *
 * The defect it exists to prevent was **two elements with different classes
 * rendering identically**. `.tl-bar-planned.tl-bar-blocked` set the fill
 * transparent to keep the outline and inherited the grey border with it, so a
 * blocked task that had never started computed byte-for-byte the same as an
 * unblocked one: `rgba(0, 0, 0, 0)` on `rgba(255, 255, 255, 0.2)`, in both
 * themes. The strip said `BLOCKED 2`; one row showed it.
 *
 * A test on class names would have passed throughout. So this reads **computed
 * colour**, and compares the blocked bar against the unblocked one beside it
 * rather than against a constant — the property is "these two differ", which is
 * what a person scanning the chart is relying on.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, type ApiStub } from './harness.ts';

const DAY = 86_400_000;

/**
 * Midnight UTC, `days` from today.
 *
 * **The fixture is anchored to today and the first version was not.** It used
 * fixed calendar dates with S3 running to 6 September — and the screen decides
 * "current" by comparing the sprint's range to `Date.now()`, so on the 7th the
 * active sprint became S4 and three assertions failed. **A six-day shelf life,
 * and it expired in the gate rather than in review.**
 *
 * Anchoring here is not a workaround for a clock: it is what the fixture always
 * meant. "A sprint that contains today" is the *property* these tests are about,
 * and spelling it as a date only happened to be that in the week it was written.
 */
const day = (days: number): number => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY;
};

const SPRINTS = [
  // Over: it ended a fortnight ago.
  { id: 's1', name: 'S1', starts_on: day(-28), ends_on: day(-15), status: 'completed' },
  // Contains today, wherever today falls — which is the whole point of it.
  { id: 's3', name: 'S3', starts_on: day(-7), ends_on: day(6), status: 'active' },
  // Not yet begun.
  { id: 's4', name: 'S4', starts_on: day(7), ends_on: day(20), status: 'planned' },
].map((s) => ({
  ...s,
  project_id: 'p1',
  goal: null,
  created_at: s.starts_on,
  updated_at: s.starts_on,
}));

let seq = 0;
function task(over: Record<string, unknown>): Record<string, unknown> {
  seq += 1;
  return {
    id: `t${String(seq)}`,
    key: `LAI-${String(seq)}`,
    project_id: 'p1',
    number: seq,
    title: 'A task',
    description_md: null,
    acceptance_md: null,
    status: 'todo',
    priority: 'p2',
    assignee_id: null,
    sprint_id: 's3',
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    discovered_from: null,
    ready: true,
    stale_flagged_at: null,
    blocked: false,
    blocked_by: [],
    blocks: [],
    tags: [],
    comment_count: 0,
    branch: null,
    external_ref: null,
    started_at: null,
    completed_at: null,
    created_at: day(-7),
    updated_at: day(-7),
    ...over,
  };
}

const BLOCKER = task({ title: 'The blocker, not finished' });
/** The pair the test turns on: same shape, same sprint, one blocked. */
const PLANNED_BLOCKED = task({ title: 'Blocked and only planned', blocked_by: [BLOCKER.id] });
const PLANNED_CLEAR = task({ title: 'Not blocked, also only planned' });
const DONE_IN_S1 = task({
  title: 'Finished in the first sprint',
  sprint_id: 's1',
  status: 'done',
  started_at: day(-27),
  completed_at: day(-21),
});

const PROJECT = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LAI',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 3, in_progress: 0, review: 0, done: 1, cancelled: 0 },
  blocked_count: 1,
  member_count: 1,
  members: [],
  last_activity_at: 2,
};

const STUB: ApiStub = {
  '/api/v1/me': {
    id: 'u1',
    email: 'a@example.com',
    name: 'Ada',
    org_role: 'owner',
    is_active: true,
    memberships: [],
  },
  '/api/v1/projects': { data: [PROJECT], next_cursor: null },
  '/api/v1/projects/laika-core': PROJECT,
  '/api/v1/projects/laika-core/tasks': {
    data: [BLOCKER, PLANNED_BLOCKED, PLANNED_CLEAR, DONE_IN_S1],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core/sprints': { data: SPRINTS, next_cursor: null },
  '/api/v1/projects/laika-core/members': { members: [] },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
};

interface Painted {
  readonly background: string;
  readonly border: string;
}

void after(async () => {
  await closeBrowser();
});

void describe('a blocked bar is not the same as an unblocked one', () => {
  void test('blocked differs from clear, planned or not, in both themes', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-row').first().waitFor({ timeout: 20_000 });

      const read = async (selector: string): Promise<Painted> =>
        h.page
          .locator(selector)
          .first()
          .evaluate((el) => {
            const s = getComputedStyle(el);
            return { background: s.backgroundColor, border: s.borderColor };
          });

      for (const theme of ['Light', 'Dark']) {
        await h.page.getByRole('radio', { name: theme }).click();
        await h.page.waitForTimeout(300);

        // The probe must be able to see both, or "they differ" proves nothing.
        assert.equal(
          await h.page.locator('.tl-bar-planned.tl-bar-blocked').count(),
          1,
          `${theme}: no planned blocked bar to measure`,
        );
        assert.ok(
          (await h.page.locator('.tl-bar-planned:not(.tl-bar-blocked)').count()) > 0,
          `${theme}: no unblocked planned bar to compare against`,
        );

        const blocked = await read('.tl-bar-planned.tl-bar-blocked');
        const clear = await read('.tl-bar-planned:not(.tl-bar-blocked)');

        assert.notDeepEqual(
          blocked,
          clear,
          `${theme}: a blocked planned bar renders identically to an unblocked one — ${JSON.stringify(blocked)}`,
        );
        assert.notEqual(
          blocked.border,
          clear.border,
          `${theme}: the difference is not in the border, which is all an outline has`,
        );
      }
    } finally {
      await h.close();
    }
  });

  void test('the blocked treatment is not colour alone', async () => {
    // Same rule as solid-versus-outline (LAI-434): a colour-only difference is
    // gone for a colour-blind reader and in a greyscale screenshot.
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      const bar = h.page.locator('.tl-bar-planned.tl-bar-blocked');
      await bar.waitFor({ timeout: 20_000 });
      assert.equal(await bar.locator('.tl-blocked-dot').count(), 1, 'no non-colour marker');

      const dot = await bar.locator('.tl-blocked-dot').evaluate((el) => {
        const s = getComputedStyle(el);
        return { background: s.backgroundColor, box: el.getBoundingClientRect().width };
      });
      // It was `var(--card)` on a transparent bar: a card-coloured dot on the
      // card, which is no marker at all.
      assert.ok(dot.box > 0, 'the marker has no width');
      assert.notEqual(dot.background, 'rgba(0, 0, 0, 0)', 'the marker is transparent');
    } finally {
      await h.close();
    }
  });
});

void describe('the sprint tabs select what the strip describes', () => {
  void test('the active sprint is chosen on load', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-tab').first().waitFor({ timeout: 20_000 });
      assert.equal(await h.page.locator('.tl-tab').count(), SPRINTS.length);
      assert.equal(await h.page.locator('.tl-tab-on .tl-tab-name').innerText(), 'S3');
      assert.match(await h.page.locator('.tl-strip').innerText(), /S3/);
    } finally {
      await h.close();
    }
  });

  void test('selecting a completed sprint changes the strip, and it does not say days left', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-tab').first().waitFor({ timeout: 20_000 });
      const before = await h.page.locator('.tl-strip').innerText();
      assert.match(before, /DAYS LEFT/, 'the active sprint should be counting down');

      await h.page.locator('.tl-tab', { hasText: 'S1' }).first().click();
      await h.page.waitForTimeout(250);

      const after = await h.page.locator('.tl-strip').innerText();
      assert.notEqual(after, before, 'the strip did not follow the selection');
      assert.match(after, /S1/);
      assert.match(after, /ENDED/, 'a finished sprint must not report days left');
      assert.doesNotMatch(
        after,
        /DAYS LEFT/,
        'a clamped `DAYS LEFT 0` cannot be told from a sprint ending tonight',
      );
      // Its own numbers, not the active sprint's.
      assert.match(after, /DONE\s*1\/1/);
    } finally {
      await h.close();
    }
  });

  void test('a future sprint counts to its start', async () => {
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-tab').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.tl-tab', { hasText: 'S4' }).first().click();
      await h.page.waitForTimeout(250);
      assert.match(await h.page.locator('.tl-strip').innerText(), /STARTS IN/);
    } finally {
      await h.close();
    }
  });

  void test('being the current sprint is marked apart from being selected', async () => {
    // They coincide by default, so the distinction is only visible once you
    // select something else — which is exactly when a reader needs it.
    const h = await open('/timeline?project=laika-core', STUB);
    try {
      await h.page.locator('.tl-tab').first().waitFor({ timeout: 20_000 });
      await h.page.locator('.tl-tab', { hasText: 'S1' }).first().click();
      await h.page.waitForTimeout(250);

      assert.equal(await h.page.locator('.tl-tab-on .tl-tab-name').innerText(), 'S1');
      const live = h.page.locator('.tl-tab-live');
      assert.equal(await live.count(), 1, 'the current sprint lost its marker when deselected');
      const onCurrent = await h.page
        .locator('.tl-tab-now')
        .first()
        .locator('.tl-tab-name')
        .innerText();
      assert.equal(onCurrent, 'S3', 'the marker moved with the selection instead of staying put');
    } finally {
      await h.close();
    }
  });
});
