/**
 * What a card's footer says (LAI-701, D-069).
 *
 * This file was `stale-marker.test.ts`, which proved the card drew a stale
 * pill. The owner asked for it gone, with the comment count and the age —
 * *"I don't need that"* — and for the due date to appear only when it is
 * today or already past. So the assertions here are absences, each behind a
 * positive control, plus the due chip's three states and the footer fitting.
 *
 * Staleness itself is not lost: the server still flags it (§11.6) and the
 * Activity tab still lists it. Only the card stops drawing it.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, setTheme, type ApiStub } from './harness.ts';

const DAY = 86_400_000;
const NOW = Date.now();
const TODAY = NOW - (NOW % DAY);
const PROJECT = { id: 'p1', slug: 'laika-core', name: 'Laika Core', prefix: 'LAI' };

const task = (n: number, over: Record<string, unknown> = {}) => ({
  id: `t${String(n)}`,
  key: `LAI-${String(n)}`,
  project_id: 'p1',
  number: n,
  title: `Task ${String(n)}`,
  description_md: null,
  acceptance_md: null,
  status: 'in_progress',
  priority: 'p2',
  assignee_id: null,
  sprint_id: null,
  created_by: 'u1',
  created_via: 'web',
  created_by_client: null,
  discovered_from: null,
  parent_task_id: null,
  due_on: null,
  planned_start: null,
  ready: false,
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
  created_at: 1,
  updated_at: NOW - 2 * 3_600_000,
  ...over,
});

/** Everything the three removed fields used to draw from, all at once. */
const NOISY = task(1, { stale_flagged_at: NOW - 12 * DAY, comment_count: 3 });

const OVERDUE = task(3, { due_on: TODAY - DAY });
const DUE_TODAY = task(4, { due_on: TODAY });
const LATER = task(5, { due_on: TODAY + 7 * DAY });
const DONE_LATE = task(6, { status: 'done', due_on: TODAY - DAY });

/** The fullest footer there now is: sprint, due, subtasks, avatar. */
const PARENT = task(7, { sprint_id: 's1', assignee_id: 'u1', due_on: TODAY, title: 'Parent' });
const CHILD = task(8, {
  sprint_id: 's1',
  assignee_id: 'u1',
  due_on: TODAY - 3 * DAY,
  parent_task_id: 't7',
  title: 'Child',
});

const SPRINT = {
  id: 's1',
  project_id: 'p1',
  name: 'Sprint four',
  goal: 'Ship it.',
  status: 'active',
  starts_on: TODAY - 3 * DAY,
  ends_on: TODAY + 10 * DAY,
  created_at: 1,
  updated_at: 1,
};

function stub(tasks: readonly unknown[]): ApiStub {
  const project = {
    ...PROJECT,
    description: null,
    repo: null,
    visibility: 'private',
    context_md: '',
    archived_at: null,
    created_at: 1,
    updated_at: 1,
    task_counts: {
      backlog: 0,
      todo: 0,
      in_progress: tasks.length,
      review: 0,
      done: 0,
      cancelled: 0,
    },
    blocked_count: 0,
    member_count: 1,
    members: [{ user_id: 'u1', name: 'Ada Lovelace' }],
    last_activity_at: 2,
  };
  return {
    '/api/v1/me': {
      id: 'u1',
      email: 'a@example.com',
      name: 'Ada Lovelace',
      org_role: 'owner',
      is_active: true,
      memberships: [{ project_id: 'p1', role: 'lead' }],
    },
    '/api/v1/projects': { data: [project], next_cursor: null },
    '/api/v1/projects/laika-core': project,
    '/api/v1/projects/laika-core/tasks': { data: tasks, next_cursor: null },
    '/api/v1/projects/laika-core/members': {
      members: [{ user_id: 'u1', name: 'Ada Lovelace', role: 'lead' }],
    },
    '/api/v1/projects/laika-core/sprints': { data: [SPRINT], next_cursor: null },
    '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
    '/api/v1/projects/laika-core/tags': { tags: [] },
  };
}

const card = (h: Awaited<ReturnType<typeof open>>, key: string) =>
  h.page
    .locator('article.card')
    .filter({ has: h.page.locator('.card-key', { hasText: new RegExp(`^${key}\\b`) }) });

void after(async () => {
  await closeBrowser();
});

void describe('the card footer drops what the owner does not need', () => {
  void test('no stale marker, no comment count and no age, on a task that has all three', async () => {
    const h = await open('/board?project=laika-core', stub([NOISY, task(2)]));
    try {
      // Positive control: both cards are on the page, so every absence below
      // is about the footer and not about an empty board.
      await h.page.locator('article.card').first().waitFor({ timeout: 15_000 });
      assert.equal(await h.page.locator('article.card').count(), 2, 'both cards must render');
      assert.equal(await card(h, 'LAI-1').count(), 1, 'the noisy card is not on the board');

      const noisy = card(h, 'LAI-1');
      assert.equal(await noisy.locator('.marker-stale').count(), 0, 'the stale pill is drawn');
      assert.equal(await noisy.locator('.card-comments').count(), 0, 'the comment count is drawn');
      assert.equal(await noisy.locator('.card-age').count(), 0, 'the age is drawn');

      // By text too, so a renamed class cannot bring them back unnoticed.
      const text = (await noisy.locator('.card-foot').innerText()).replace(/\s+/g, ' ');
      assert.doesNotMatch(text, /stale/i, `the footer still says stale: "${text}"`);
      assert.doesNotMatch(text, /\b2h\b/, `the footer still carries the age: "${text}"`);
      assert.doesNotMatch(text, /(^|\s)3(\s|$)/, `the footer still carries the count: "${text}"`);
    } finally {
      await h.close();
    }
  });
});

void describe('the due chip, only when it is today or past (LAI-701)', () => {
  void test('red and marked when past, amber "Due today" today, nothing ahead or once done', async () => {
    const h = await open('/board?project=laika-core', stub([OVERDUE, DUE_TODAY, LATER, DONE_LATE]));
    try {
      await h.page.locator('article.card').first().waitFor({ timeout: 15_000 });
      for (const key of ['LAI-3', 'LAI-4', 'LAI-5', 'LAI-6']) {
        assert.equal(await card(h, key).count(), 1, `${key} is not on the board`);
      }

      const past = card(h, 'LAI-3').locator('.card-due');
      assert.equal(await past.count(), 1, 'an overdue task shows no due chip');
      assert.ok(
        (await past.getAttribute('class'))?.includes('card-due-overdue'),
        'the overdue chip is not marked overdue',
      );
      assert.match(await past.innerText(), /⚠/, 'the overdue chip carries no mark');
      assert.match(await past.innerText(), /\d{1,2} [A-Z][a-z]{2}/, 'the overdue chip has no date');

      const today = card(h, 'LAI-4').locator('.card-due');
      assert.equal(await today.count(), 1, 'a task due today shows no due chip');
      assert.ok(
        (await today.getAttribute('class'))?.includes('card-due-today'),
        'the today chip is not marked today',
      );
      assert.equal((await today.innerText()).trim(), 'Due today');
      assert.match((await today.getAttribute('title')) ?? '', /\d{4}/, 'no full date on hover');

      assert.equal(
        await card(h, 'LAI-5').locator('.card-due').count(),
        0,
        'a future date is drawn',
      );
      assert.equal(
        await card(h, 'LAI-6').locator('.card-due').count(),
        0,
        'done work shows a due date',
      );

      /*
       * **Each chip is its own token, in both themes.** The first version
       * compared the chips with the key's colour as "plain meta text", and a
       * mutation deleting `.card .card-due-today` stayed green: the key is not
       * painted by `.t-meta`, so a chip that lost the cascade to `.t-meta`'s
       * `--text-muted` still differed from it. Resolving the tokens through a
       * probe inside the card asks the question that matters — *is this the
       * colour the rule names* — whatever else is on the card.
       */
      const token = (name: string) =>
        card(h, 'LAI-3').evaluate((el, v) => {
          const probe = document.createElement('span');
          probe.style.color = `var(${v})`;
          el.appendChild(probe);
          const colour = getComputedStyle(probe).color;
          probe.remove();
          return colour;
        }, name);
      for (const theme of ['Dark', 'Light']) {
        await setTheme(h.page, theme);
        await h.page.waitForTimeout(250);
        const colour = (l: typeof past) => l.evaluate((el) => getComputedStyle(el).color);
        const [overdue, amber, muted] = [
          await token('--overdue'),
          await token('--chip-orange'),
          await token('--text-muted'),
        ];
        assert.notEqual(
          overdue,
          amber,
          `${theme}: the two tokens resolve alike — this proves nothing`,
        );
        assert.equal(await colour(past), overdue, `${theme}: the overdue chip is not --overdue`);
        assert.equal(await colour(today), amber, `${theme}: the today chip is not --chip-orange`);
        assert.notEqual(await colour(today), muted, `${theme}: the today chip lost to .t-meta`);
      }
    } finally {
      await h.close();
    }
  });

  void test('the fullest footer fits a 218px card with nothing clipped', async () => {
    const h = await open('/board?project=laika-core', stub([PARENT, CHILD]));
    try {
      await card(h, 'LAI-8').locator('.card-due').waitFor({ timeout: 15_000 });
      await h.page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>('.kanban');
        if (grid === null) return;
        grid.style.setProperty('--lane-floor', '218px');
        grid.style.gridTemplateColumns = 'repeat(4, 218px)';
      });
      await h.page.waitForTimeout(400);

      for (const key of ['LAI-7', 'LAI-8']) {
        const seen = await card(h, key).evaluate((el) => {
          const box = el.getBoundingClientRect();
          const foot = el.querySelector('.card-foot');
          // `.visually-hidden` is clipped to 1px on purpose — a name for a
          // screen reader, not something on the card. (The priority's name
          // was one until LAI-705; it is now the icon's own `aria-label`.)
          const kids =
            foot === null
              ? []
              : [...foot.children].filter((c) => !c.classList.contains('visually-hidden'));
          // By attribute: the priority icon is an <svg>, whose `className` is
          // an SVGAnimatedString rather than a string (LAI-705).
          const cls = (c: Element) => c.getAttribute('class') ?? '';
          return {
            width: Math.round(box.width),
            classes: kids.map(cls),
            clipped: kids
              .filter((c) => (c as HTMLElement).scrollWidth > (c as HTMLElement).clientWidth + 1)
              .map((c) => `${cls(c)}: ${c.textContent ?? ''}`),
            outside: kids.filter((c) => c.getBoundingClientRect().right > box.right + 0.5).map(cls),
          };
        });
        assert.ok(seen.width <= 220, `${key}: the card is ${String(seen.width)}px, not squeezed`);
        // Positive control: the fullest row really is full.
        for (const part of ['card-sprint', 'card-due', 'card-who']) {
          assert.ok(
            seen.classes.some((c) => c.includes(part)),
            `${key}: no ${part} in the footer — this fixture proves nothing`,
          );
        }
        assert.deepEqual(seen.clipped, [], `${key}: clipped in the footer`);
        assert.deepEqual(seen.outside, [], `${key}: past the card's right edge`);
      }
    } finally {
      await h.close();
    }
  });
});
