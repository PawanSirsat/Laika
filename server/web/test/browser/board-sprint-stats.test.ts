/**
 * The Board's two top rows are gone, and DONE / BLK / LEFT live in the toolbar
 * (LAI-727).
 *
 * The owner, with two screenshots of production's Board: *"remove this row
 * completely from the board, but I want that DONE, BLK and LEFT — add that
 * somewhere on top, adjust that one; then also remove this row, that's it."*
 * Row one was the sprint strip, row two WORKING NOW.
 *
 * The figures must mean what the strip's summary meant. `stripSummary` is the
 * strip's `countFor` and `LEFT` from `board/SprintStrip.tsx` at 5adbfae, run
 * over the same fixture the stub serves, and each test also states the numbers
 * by hand — a reference that drifted with the code would agree with anything.
 *
 * The stub answers `GET /tasks` by its query, as the server does: a sprint
 * scopes it, an assignee narrows it. Every task request is recorded with its
 * full URL, which is what tells "counted from the board's set" apart from
 * "walked the whole project again".
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { pick } from './dropdown.ts';
import { closeBrowser, open, setTheme, type ApiStub, type Harness } from './harness.ts';

const DAY = 86_400_000;
const NOW = Date.now();
const today = new Date(NOW);
const MIDNIGHT = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

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

const sprint = (id: string, name: string, status: string, from: number, to: number) => ({
  id,
  project_id: 'laika-core',
  name,
  goal: null,
  status,
  starts_on: MIDNIGHT + from * DAY,
  ends_on: MIDNIGHT + to * DAY,
  created_at: 1,
  updated_at: 1,
});

const SPRINTS = [
  sprint('s1', 'Baseline build', 'completed', -28, -15),
  sprint('s2', 'Finish what’s open', 'active', -14, 9),
  sprint('s3', 'Reliability', 'planned', 10, 23),
];

let n = 0;
const task = (
  status: string,
  sprintId: string | null,
  over: { ready?: boolean; assignee?: string | null; parent?: string | null } = {},
) => {
  n += 1;
  return {
    id: `t${String(n)}`,
    key: `LC-${String(n)}`,
    number: n,
    project_id: 'laika-core',
    title: `Task ${String(n)}`,
    description_md: '',
    acceptance_md: '',
    status,
    priority: 'p2',
    position: null,
    assignee_id: over.assignee ?? null,
    created_by: 'u1',
    created_via: 'web',
    created_by_client: null,
    sprint_id: sprintId,
    tags: [],
    ready: over.ready ?? true,
    comment_count: 0,
    blocked_by: [],
    blocks: [],
    discovered_from: null,
    parent_task_id: over.parent ?? null,
    due_on: null,
    planned_start: null,
    branch: null,
    external_ref: null,
    stale_flagged_at: null,
    created_at: 1,
    updated_at: NOW - 3_600_000,
    started_at: null,
    completed_at: null,
  };
};

type Row = ReturnType<typeof task>;

const TASKS: readonly Row[] = [
  task('done', 's1'),
  task('done', 's1'),
  task('done', 's2', { assignee: 'u2' }),
  task('done', 's2'),
  task('done', 's2', { parent: 't4' }),
  task('in_progress', 's2', { assignee: 'u2' }),
  task('in_progress', 's2'),
  task('review', 's2'),
  task('todo', 's2', { ready: false, assignee: 'u2' }),
  task('todo', 's2', { ready: false }),
  task('todo', 's2', { ready: false, parent: 't4' }),
  task('backlog', 's2', { ready: false }),
  task('todo', 's3', { ready: false }),
  task('todo', 's3'),
  task('backlog', null, { ready: false }),
];

/** `SprintStrip.tsx` at 5adbfae: `countFor` and its LEFT, the figures LAI-727 keeps. */
function stripSummary(sprintId: string | undefined): string {
  const inScope = sprintId === undefined ? TASKS : TASKS.filter((t) => t.sprint_id === sprintId);
  const done = inScope.filter((t) => t.status === 'done').length;
  const blocked = inScope.filter((t) => !t.ready && t.status !== 'done').length;
  const current = SPRINTS.find((s) => s.id === sprintId);
  const left =
    current === undefined
      ? '—'
      : String(Math.max(0, Math.round((current.ends_on - MIDNIGHT) / DAY) + 1));
  return `DONE ${String(done)}/${String(inScope.length)} BLK ${String(blocked)} LEFT ${left}`;
}

const page = (rows: readonly Row[]) => ({ data: rows, next_cursor: null });

/** `?sprint=` and `?assignee=` answered as the server would; keys are subset-matched. */
function taskRoutes(): Record<string, unknown> {
  const routes: Record<string, unknown> = {
    '/api/v1/projects/laika-core/tasks?limit=200': page(TASKS),
    '/api/v1/projects/laika-core/tasks?limit=200&assignee=u2': page(
      TASKS.filter((t) => t.assignee_id === 'u2'),
    ),
  };
  for (const s of SPRINTS) {
    const inSprint = TASKS.filter((t) => t.sprint_id === s.id);
    routes[`/api/v1/projects/laika-core/tasks?limit=200&sprint=${s.id}`] = page(inSprint);
    routes[`/api/v1/projects/laika-core/tasks?limit=200&sprint=${s.id}&assignee=u2`] = page(
      inSprint.filter((t) => t.assignee_id === 'u2'),
    );
  }
  return routes;
}

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
        task_counts: { backlog: 2, todo: 5, in_progress: 2, review: 1, done: 5, cancelled: 0 },
        blocked_count: 0,
        member_count: 2,
        members: [],
        last_activity_at: 2,
      },
    ],
    next_cursor: null,
  },
  '/api/v1/projects/laika-core': CORE,
  ...taskRoutes(),
  '/api/v1/projects/laika-core/sprints': { data: SPRINTS, next_cursor: null },
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' },
      { user_id: 'u2', name: 'Grace Hopper', email: 'g@example.com', role: 'member' },
    ],
  },
  '/api/v1/projects/laika-core/mentionable': { users: [] },
  '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
  '/api/v1/projects/laika-core/tags': { tags: [] },
  '/api/v1/projects/laika-core/meeting-reviews': { data: [], next_cursor: null },
  '/api/v1/org': {
    id: 'o',
    name: 'Borealis Labs',
    presence_enabled: true,
    created_at: 1,
    updated_at: 1,
  },
  // Presence **on, with an agent in it** — WORKING NOW drew its row in exactly
  // this state, so its absence here is the change and not the fixture.
  '/api/v1/presence': {
    enabled: true,
    present: [
      {
        user_id: 'u2',
        name: 'Grace Hopper',
        is_agent: true,
        matched_task_id: null,
        project_ids: ['laika-core'],
        last_seen: NOW,
        repo: 'kvelld/laika',
        branch: 'lc-1',
      },
    ],
  },
};

/** Every `GET …/tasks` the page asked for, as full URLs, from before the first. */
function recordTaskReads(target: string[]) {
  return (p: Page): Promise<void> => {
    p.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/v1/projects/laika-core/tasks') target.push(url.search);
    });
    return Promise.resolve();
  };
}

/** What the group shows a sighted reader, whitespace folded: `S2 DONE 3/10 BLK 4 LEFT 10`. */
const shown = async (h: Harness): Promise<string> =>
  (
    await h.page
      .locator('.bstats [aria-hidden="true"]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? '').join(' '))
  )
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .trim();

/** Wait until the group reads `expected` (the figures land after the board's read). */
async function reads(h: Harness, expected: string): Promise<void> {
  await h.page.locator('.bstats').waitFor({ timeout: 20_000 });
  try {
    await h.page.waitForFunction(
      (want) =>
        [...document.querySelectorAll('.bstats [aria-hidden="true"]')]
          .map((el) => el.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .replace(/\s*\/\s*/g, '/')
          .trim() === want,
      expected,
      { timeout: 10_000 },
    );
  } catch {
    assert.fail(`the stats never read "${expected}" — they read "${await shown(h)}"`);
  }
}

const sprintInUrl = (h: Harness): string | null => new URL(h.page.url()).searchParams.get('sprint');

void after(async () => {
  await closeBrowser();
});

void describe('the Board’s top rows are gone (LAI-727)', () => {
  for (const path of ['/board', '/list']) {
    void test(`${path}: no sprint strip and no WORKING NOW, with sprints and people present`, async () => {
      const h = await open(`${path}?project=laika-core&sprint=s2`, STUB);
      try {
        // Positive controls first: every assertion after them is an absence.
        await h.page
          .locator(path === '/board' ? '.card' : '.list-row')
          .first()
          .waitFor({
            timeout: 20_000,
          });
        await h.page.locator('.bstats').waitFor({ timeout: 10_000 });
        // Presence still reaches the one thing that reads it: the header's count.
        await h.page.waitForFunction(
          () =>
            /Agents\s*1/.test(
              [...document.querySelectorAll('.space-chip')]
                .map((el) => el.textContent ?? '')
                .join(' '),
            ),
          undefined,
          { timeout: 10_000 },
        );
        // Kept as a sleep (LAI-715 sweep): a quiet window before absences: a condition cannot show that nothing more arrives.
        await h.page.waitForTimeout(400);

        assert.equal(await h.page.locator('.strip').count(), 0, 'the sprint strip is drawn');
        assert.equal(await h.page.locator('.presence').count(), 0, 'WORKING NOW is drawn');
        assert.doesNotMatch(await h.page.locator('body').innerText(), /WORKING NOW/i);
        assert.doesNotMatch(await h.page.locator('body').innerText(), /agent sessions? live/);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('DONE / BLK / LEFT are the strip’s figures (LAI-727)', () => {
  void test('the active sprint, which the board opens on', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await reads(h, `S2 ${stripSummary('s2')}`);
      // By hand: 2 of 8 top-level tasks and 1 of 2 subtasks done; four open
      // and not ready; the sprint ends nine days after today, so ten are left.
      assert.equal(await shown(h), 'S2 DONE 3/10 BLK 4 LEFT 10');
      assert.equal(sprintInUrl(h), 's2', 'the board no longer opens on the active sprint');
    } finally {
      await h.close();
    }
  });

  void test('All sprints counts every task, sprint or not, and has no days left', async () => {
    const h = await open('/board?project=laika-core&sprint=all', STUB);
    try {
      await reads(h, `All sprints ${stripSummary(undefined)}`);
      assert.equal(await shown(h), 'All sprints DONE 5/15 BLK 6 LEFT —');
    } finally {
      await h.close();
    }
  });

  void test('a sprint with blocked work', async () => {
    const h = await open('/board?project=laika-core&sprint=s3', STUB);
    try {
      await reads(h, `S3 ${stripSummary('s3')}`);
      assert.equal(await shown(h), 'S3 DONE 0/2 BLK 1 LEFT 24');
      // BLK is the danger token, as it was in the strip.
      const colours = await h.page.evaluate(() => {
        const blk = document.querySelector('.bstats-blocked [aria-hidden="true"] b');
        const probe = document.createElement('span');
        probe.style.color = 'var(--overdue)';
        document.body.append(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return { blk: blk === null ? null : getComputedStyle(blk).color, want };
      });
      assert.ok(colours.blk !== null, 'no BLK figure to colour');
      assert.equal(colours.blk, colours.want, 'BLK is not the danger token');
    } finally {
      await h.close();
    }
  });
});

/**
 * **No read of their own** (LAI-727 on LAI-724's store). The board holds the
 * project's whole task set and filters it in memory, so the one walk of the
 * project is the only task read there is — the strip's second walk, and the
 * `?sprint=` read LAI-727 first made under a narrowing filter, are both gone.
 */
const theWalk = (urls: readonly string[]): string[] =>
  urls.filter((q) => {
    const p = new URLSearchParams(q);
    return [...p.keys()].every((k) => k === 'limit' || k === 'cursor');
  });

void describe('the figures come from the task set in the browser (LAI-727)', () => {
  void test('a sprint-scoped board makes one task read: the project’s walk', async () => {
    const urls: string[] = [];
    const h = await open('/board?project=laika-core', STUB, { before: recordTaskReads(urls) });
    try {
      await reads(h, `S2 ${stripSummary('s2')}`);
      // Kept as a sleep (LAI-715 sweep): a quiet window: a second read would come after this, so no condition can stand in.
      await h.page.waitForTimeout(800);
      assert.deepEqual(urls, ['?limit=200'], 'a task read beside the project’s one walk');
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('narrowed by assignee, a sprint’s figures stay the sprint’s — and nothing is read', async () => {
    const urls: string[] = [];
    const h = await open('/board?project=laika-core&sprint=s2&assignee=u2', STUB, {
      before: recordTaskReads(urls),
    });
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.card').count(),
        3,
        'positive control: the board is narrowed',
      );
      await reads(h, `S2 ${stripSummary('s2')}`);
      // Kept as a sleep (LAI-715 sweep): a quiet window: a second read would come after this, so no condition can stand in.
      await h.page.waitForTimeout(800);
      assert.deepEqual(urls, theWalk(urls), `a scoped task read: ${urls.join(' ')}`);
      assert.equal(urls.length, 1, `expected the one walk, saw ${urls.join(' ')}`);
    } finally {
      await h.close();
    }
  });

  void test('narrowed on All sprints, the figures are still every task’s', async () => {
    const urls: string[] = [];
    const h = await open('/board?project=laika-core&sprint=all&assignee=u2', STUB, {
      before: recordTaskReads(urls),
    });
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      assert.equal(
        await h.page.locator('.card').count(),
        3,
        'positive control: the board is narrowed',
      );
      await reads(h, `All sprints ${stripSummary(undefined)}`);
      assert.doesNotMatch(
        (await h.page.locator('.bstats').getAttribute('aria-label')) ?? '',
        /filtered/i,
        'the figures are the project’s, not the filtered tasks’',
      );
      // Kept as a sleep (LAI-715 sweep): a quiet window: a second read would come after this, so no condition can stand in.
      await h.page.waitForTimeout(800);
      assert.equal(urls.length, 1, `expected the one walk, saw ${urls.join(' ')}`);
    } finally {
      await h.close();
    }
  });
});

void describe('sprints are switched in the Filter now (LAI-727)', () => {
  const sprintSelect = (h: Harness) =>
    h.page
      .locator('.bt-field')
      .filter({ has: h.page.locator('.bt-label', { hasText: /^Sprint$/ }) })
      .locator('[role="combobox"]');

  void test('choosing a sprint moves the figures; Any and the chip’s × are All sprints', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await reads(h, `S2 ${stripSummary('s2')}`);

      await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
      await pick(sprintSelect(h), 's3');
      await h.page.waitForFunction(() => location.search.includes('sprint=s3'), undefined, {
        timeout: 5000,
      });
      await reads(h, `S3 ${stripSummary('s3')}`);

      // Any is the empty value, as it was on the `<select>`.
      await pick(sprintSelect(h), '');
      await h.page.waitForFunction(() => location.search.includes('sprint=all'), undefined, {
        timeout: 5000,
      });
      await reads(h, `All sprints ${stripSummary(undefined)}`);

      await pick(sprintSelect(h), 's1');
      await h.page.waitForFunction(() => location.search.includes('sprint=s1'), undefined, {
        timeout: 5000,
      });
      await reads(h, `S1 ${stripSummary('s1')}`);
      await h.page.keyboard.press('Escape');
      await h.page.locator('.bt-chip', { hasText: 'Sprint: S1' }).click();
      await h.page.waitForFunction(() => location.search.includes('sprint=all'), undefined, {
        timeout: 5000,
      });
      await reads(h, `All sprints ${stripSummary(undefined)}`);
    } finally {
      await h.close();
    }
  });
});

void describe('the group is readable without sight (LAI-727)', () => {
  void test('a named group, and each figure a sentence', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await reads(h, `S2 ${stripSummary('s2')}`);
      const group = h.page.locator('.bstats');
      assert.equal(await group.getAttribute('role'), 'group');
      assert.match((await group.getAttribute('aria-label')) ?? '', /S2.*Finish what’s open/);
      const spoken = await h.page
        .locator('.bstats .visually-hidden')
        .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
      assert.deepEqual(spoken, ['Done 3 of 10', 'Blocked 4', '10 days left']);
    } finally {
      await h.close();
    }
  });
});

/** Every box the group must not touch, and the group's own. */
function measureToolbar(h: Harness) {
  return h.page.evaluate(() => {
    const r = (el: Element | null | undefined) => {
      if (el === null || el === undefined) return null;
      const b = el.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width };
    };
    const button = (text: string) =>
      [...document.querySelectorAll('.bt-button')].find((b) =>
        (b.textContent ?? '').includes(text),
      );
    const others: Record<string, ReturnType<typeof r>> = {
      search: r(document.querySelector('.bt-search')),
      faces: r(document.querySelector('.bt-members')),
      filter: r(button('Filter')),
      group: r(button('Group')),
      chips: r(document.querySelector('.bt-chips')),
      popover: r(document.querySelector('.bt-pop')),
    };
    document.querySelectorAll('.bt-icon').forEach((el, i) => {
      others[`icon${String(i)}`] = r(el);
    });
    const rail = document.querySelector('#sidebar, .sidebar')?.getBoundingClientRect();
    const group = document.querySelector('.bstats');
    const row = document.querySelector('.bt')?.getBoundingClientRect();
    const box = group?.getBoundingClientRect();
    const tier = ['full', 'compact', 'pill'].find((t) => group?.classList.contains(`bstats-${t}`));
    return {
      stats: r(group),
      tier: tier ?? 'none',
      // Inside the toolbar row's own box, top to bottom — not merely in its DOM.
      contained:
        box !== undefined &&
        row !== undefined &&
        box.top >= row.top - 0.5 &&
        box.bottom <= row.bottom + 0.5,
      // Anything of the group's drawn above the controls: the round-1 fallback.
      above:
        document.querySelector('.bstats-above') !== null ||
        (box !== undefined && row !== undefined && box.bottom <= row.top + 0.5),
      clipped: group !== null && group.scrollWidth > group.clientWidth + 1,
      offscreen: box !== undefined && (box.left < -0.5 || box.right > window.innerWidth + 0.5),
      others,
      search: Math.round(document.querySelector('.bt-search')?.getBoundingClientRect().width ?? 0),
      spacer: document.querySelector('.bt-spacer')?.getBoundingClientRect().width ?? 0,
      inRow: document.querySelector('.bt .bstats') !== null,
      railOpen: rail !== undefined && rail.left >= 0 && rail.width > 150,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

type Measured = Awaited<ReturnType<typeof measureToolbar>>;

function assertFits(m: Measured, when: string): void {
  assert.ok(m.stats !== null, `${when}: no stat group`);
  assert.ok(m.stats.w > 40, `${when}: the group collapsed to nothing`);
  // The figures never get a row of their own (LAI-727 review, round 2).
  assert.equal(m.inRow, true, `${when}: the group is not in the toolbar row`);
  assert.equal(m.contained, true, `${when}: the group is drawn outside the toolbar row`);
  assert.equal(m.above, false, `${when}: the group is drawn above the toolbar`);
  assert.equal(m.clipped, false, `${when}: the group's content is clipped`);
  assert.equal(m.offscreen, false, `${when}: the group runs off the screen`);
  assert.equal(m.sideways, false, `${when}: the page scrolls sideways`);
  for (const [name, box] of Object.entries(m.others)) {
    if (box === null) continue;
    const overlaps: boolean =
      m.stats.l < box.r - 0.5 &&
      box.l < m.stats.r - 0.5 &&
      m.stats.t < box.b - 0.5 &&
      box.t < m.stats.b - 0.5;
    assert.equal(overlaps, false, `${when}: the group overlaps ${name}`);
  }
}

/** Closed, then with the Filter popover open — the group must clear both. */
async function assertFitsOpenAndClosed(h: Harness, when: string): Promise<void> {
  assertFits(await measureToolbar(h), `${when}, closed`);
  await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
  await h.page.locator('.bt-pop').waitFor({ timeout: 5000 });
  const opened = await measureToolbar(h);
  assert.ok(opened.others.popover !== null, `${when}: positive control: the popover is open`);
  assertFits(opened, `${when}, popover open`);
  await h.page.keyboard.press('Escape');
}

void describe('the group fits the toolbar (LAI-727)', () => {
  const SIZES = [
    { width: 1366, height: 768 },
    { width: 900, height: 768 },
  ];

  for (const size of SIZES) {
    for (const theme of ['Light', 'Dark']) {
      void test(`${String(size.width)}px, ${theme}: overlaps nothing and never scrolls sideways`, async () => {
        const h = await open('/board?project=laika-core', STUB);
        try {
          await reads(h, `S2 ${stripSummary('s2')}`);
          // The theme first: below 900px its switch is in the off-canvas rail.
          await setTheme(h.page, theme);
          await h.page.setViewportSize(size);
          // The chips row is drawn: the default sprint is an active filter.
          await h.page.locator('.bt-chip').first().waitFor({ timeout: 10_000 });
          await assertFitsOpenAndClosed(h, `${String(size.width)}px ${theme}`);
        } finally {
          await h.close();
        }
      });
    }
  }
});

/**
 * **The tightest row there is** (LAI-727 review, should-fix 2).
 *
 * The sidebar folds away below 900px, so the narrowest *toolbar* is just
 * above that, with the sidebar open: 212px gone from a ~920px window. Crowd it
 * the way a real project does — six members, so the face pile is at its
 * widest (four faces and `+2`; `CLUSTER_LIMIT` is 4), and an active Group,
 * whose button then carries its label. Measured on 2d6036a: the search field
 * was **26px** at 920 and **35px** at 1024, its floor.
 *
 * **What the group owes search is all of it, below 120px.** At 920 on a
 * sprint the toolbar's own controls leave search **113px** with no group in
 * the row at all — the Filter badge is the difference from All sprints, which
 * clears 120. That floor is the toolbar's (filed as LAI-730), and nothing the
 * group sheds can lift it. So the assertion is: search is at least 120px, or
 * the group is down to its pill — **in the row** — and the row has no slack
 * left to give. Round 1 let the group leave the row instead; round 2 forbids
 * that (the owner asked for these rows to go), so the pill is the floor.
 */
const SIX_MEMBERS: ApiStub = {
  ...STUB,
  '/api/v1/projects/laika-core/members': {
    members: [
      { user_id: 'u1', name: 'Ada Lovelace', email: 'a@example.com', role: 'lead' },
      { user_id: 'u2', name: 'Grace Hopper', email: 'g@example.com', role: 'member' },
      { user_id: 'u3', name: 'Tomas Nel', email: 't@example.com', role: 'member' },
      { user_id: 'u4', name: 'Priya Raman', email: 'p@example.com', role: 'member' },
      { user_id: 'u5', name: 'Kenji Sato', email: 'k@example.com', role: 'member' },
      { user_id: 'u6', name: 'Lena Fischer', email: 'l@example.com', role: 'member' },
    ],
  },
};

void describe('the sidebar open, the row crowded (LAI-727 review)', () => {
  for (const width of [1024, 920]) {
    for (const scope of ['s2', 'all']) {
      for (const theme of ['Light', 'Dark']) {
        void test(`${String(width)}px, ${scope === 'all' ? 'All sprints' : 'S2'}, ${theme}: search keeps 120px`, async () => {
          const h = await open(
            `/board?project=laika-core&sprint=${scope}&group=assignee`,
            SIX_MEMBERS,
          );
          try {
            await h.page.locator('.bstats').waitFor({ timeout: 20_000 });
            await setTheme(h.page, theme);
            await h.page.setViewportSize({ width, height: 768 });
            await h.page.locator('.lane').first().waitFor({ timeout: 10_000 });
            await settled(h);

            // The crowding is real, or the width proves nothing.
            const m = await measureToolbar(h);
            assert.equal(m.railOpen, true, 'the sidebar is not open — the wrong state');
            assert.equal(
              await h.page.locator('.bt-member').count(),
              4,
              'the face pile is not full',
            );
            assert.equal(
              (await h.page.locator('.bt-member-more').textContent())?.trim(),
              '+2',
              'six members should overflow the pile by two',
            );
            assert.match(
              (await h.page.locator('.bt-button', { hasText: 'Group' }).textContent()) ?? '',
              /Group: Assignee/,
              'the Group button is not carrying an active label',
            );

            assert.equal(m.inRow, true, 'the group left the toolbar row');
            assert.ok(
              m.search >= 120 || (m.tier === 'pill' && m.spacer < 1),
              `the search field is ${String(m.search)}px wide with the group ${m.tier} and ${String(
                Math.round(m.spacer),
              )}px of slack`,
            );
            await assertFitsOpenAndClosed(h, `${String(width)}px ${scope} ${theme}`);
          } finally {
            await h.close();
          }
        });
      }
    }
  }
});

/**
 * **All sprints keeps a visible scope at every width** (LAI-727 review).
 *
 * A sprint is named twice — the group's scope and its Filter chip — so the
 * scope may give way when room is short. *All sprints* has no chip
 * (`sprint=all` is not a filter), so if the scope went, nothing on screen
 * would say what the figures are of.
 */
void describe('All sprints is always named (LAI-727 review)', () => {
  for (const width of [920, 901, 760, 600, 360]) {
    void test(`${String(width)}px: the scope reads "All sprints" and is visible`, async () => {
      const h = await open('/board?project=laika-core&sprint=all', STUB);
      try {
        await reads(h, `All sprints ${stripSummary(undefined)}`);
        await h.page.setViewportSize({ width, height: 768 });
        await settled(h);
        assert.equal(await h.page.locator('.bt-chip').count(), 0, 'positive control: no chip');
        const scope = h.page.locator('.bstats-scope');
        assert.equal(await scope.isVisible(), true, 'the scope is hidden');
        const box = await scope.boundingBox();
        assert.ok(box !== null && box.width > 20, 'the scope has no width');
        assert.equal(((await scope.innerText()) ?? '').trim(), 'All sprints');
        // Named, and also whole: nothing pushed off the side or cut short.
        const m = await measureToolbar(h);
        assert.equal(m.sideways, false, 'the page scrolls sideways');
        assert.equal(m.clipped, false, 'the group is clipped');
        assert.equal(m.offscreen, false, 'the group runs off the screen');
        assert.equal(m.inRow, true, 'the group is not in the toolbar row');
      } finally {
        await h.close();
      }
    });
  }

  void test('LEFT says there is no end date, not "no days left"', async () => {
    const h = await open('/board?project=laika-core&sprint=all', STUB);
    try {
      await reads(h, `All sprints ${stripSummary(undefined)}`);
      const left = h.page.locator('.bstats-left');
      assert.equal(await left.getAttribute('title'), 'No sprint end date');
      assert.equal(await left.locator('.visually-hidden').textContent(), 'No sprint end date');
    } finally {
      await h.close();
    }
  });
});

/**
 * **In the row, at every width, in every tier** (LAI-727 review, round 2).
 *
 * Round 1 had no test that the group was ever in the row, and it could leave.
 * One page, resized from wide to narrow and back, so the tier changes are the
 * ones a reader makes by resizing — and the hysteresis is exercised both ways.
 */
void describe('the group is in the toolbar row in every tier (LAI-727 review)', () => {
  const WIDTHS = [1366, 1240, 1180, 1100, 1024, 960, 920, 901, 900, 820, 760, 600, 360];

  void test('full, compact and pill are all reached, and every one is in the row', async () => {
    const h = await open('/board?project=laika-core&sprint=s2&group=assignee', SIX_MEMBERS);
    try {
      await reads(h, `S2 ${stripSummary('s2')}`);
      await h.page.locator('.bt-member').first().waitFor({ timeout: 10_000 });
      const seen = new Set<string>();
      for (const width of [...WIDTHS, ...[...WIDTHS].reverse()]) {
        await h.page.setViewportSize({ width, height: 768 });
        await settled(h);
        const m = await measureToolbar(h);
        assertFits(m, `${String(width)}px`);
        seen.add(m.tier);
        if (width === 1366) assert.equal(m.tier, 'full', '1366px is not the full group');
      }
      assert.deepEqual([...seen].sort(), ['compact', 'full', 'pill'], 'a tier was never reached');
    } finally {
      await h.close();
    }
  });
});

/**
 * **The pill** (LAI-727 review, round 2): the group at its tightest, one
 * figure — `S2 · 3/10`, done of total — with BLK and LEFT a hover, a focus or
 * a click away, and all three in its accessible name.
 */
void describe('the pill (LAI-727 review)', () => {
  for (const theme of ['Light', 'Dark']) {
    void test(`${theme}: one figure in the row; BLK and LEFT on hover, focus and click`, async () => {
      const h = await open('/board?project=laika-core&sprint=s2&group=assignee', SIX_MEMBERS);
      try {
        await reads(h, `S2 ${stripSummary('s2')}`);
        await setTheme(h.page, theme);
        await h.page.setViewportSize({ width: 920, height: 768 });
        await h.page.locator('.bt-member').first().waitFor({ timeout: 10_000 });
        await settled(h);

        const pill = h.page.locator('.bstats');
        assert.match(
          (await pill.getAttribute('class')) ?? '',
          /bstats-pill/,
          'not the pill at 920px',
        );
        assert.equal(await pill.getAttribute('role'), 'button');
        assert.equal(await pill.getAttribute('tabindex'), '0');
        const name = (await pill.getAttribute('aria-label')) ?? '';
        for (const said of ['S2', 'Done 3 of 10', 'Blocked 4', '10 days left']) {
          assert.ok(name.includes(said), `the pill's name lacks "${said}": ${name}`);
        }
        // One figure drawn: the scope and done-of-total; BLK and LEFT are not.
        assert.equal(await h.page.locator('.bstats-scope').isVisible(), true);
        assert.match(
          (await h.page.locator('.bstats-done').innerText()).replace(/\s+/g, ''),
          /3\/10/,
        );
        assert.equal(await h.page.locator('.bstats-blocked').isVisible(), false);
        assert.equal(await h.page.locator('.bstats-left').isVisible(), false);

        const tip = h.page.locator('[role="tooltip"].bstats-pop');
        const tipShows = async (): Promise<boolean> =>
          (await tip.count()) === 1 && (await tip.isVisible());
        assert.equal(await tipShows(), false, 'the tooltip is open before anything asked');

        await pill.hover();
        await tip.waitFor({ state: 'visible', timeout: 3000 });
        const text = (await tip.innerText()).replace(/\s+/g, ' ');
        assert.match(text, /BLK 4/);
        assert.match(text, /LEFT 10/);
        assert.equal(await pill.getAttribute('aria-describedby'), await tip.getAttribute('id'));
        const opened = await measureToolbar(h);
        assert.equal(opened.sideways, false, 'the tooltip pushes the page sideways');
        const tipBox = await tip.boundingBox();
        assert.ok(
          tipBox !== null && tipBox.x >= 0 && tipBox.x + tipBox.width <= 920,
          'the tooltip runs off the screen',
        );

        await h.page.mouse.move(5, 760);
        await tip.waitFor({ state: 'hidden', timeout: 3000 });

        await pill.focus();
        await tip.waitFor({ state: 'visible', timeout: 3000 });
        await h.page.keyboard.press('Escape');
        await tip.waitFor({ state: 'hidden', timeout: 3000 });
        await h.page.locator('.bt-search input').focus();

        await pill.click();
        await tip.waitFor({ state: 'visible', timeout: 3000 });
        assert.equal(await pill.getAttribute('aria-expanded'), 'true');
        await h.page.mouse.move(5, 760);
        // Kept as a sleep (LAI-715 sweep): a quiet window: the assertion is that the tip did *not* close.
        await h.page.waitForTimeout(200);
        assert.equal(await tipShows(), true, 'a clicked pill closed when the pointer left');
        await pill.click();
        await h.page.mouse.move(5, 760);
        await tip.waitFor({ state: 'hidden', timeout: 3000 });
      } finally {
        await h.close();
      }
    });
  }
});

/**
 * **Wait for the layout to stop moving, not for a length of time** (LAI-715).
 *
 * These measurements used to follow a fixed 200–600ms sleep, which is a guess
 * about the machine: on GitHub's runner a resize, a theme switch or a late
 * answer could still be settling when the sleep ran out, and on a fast one the
 * sleep is waste. The group picks its tier from a `ResizeObserver` and nothing
 * here runs on a timer, so the layout is settled when the boxes that move —
 * the toolbar, its chips, the figures, the faces and the lanes — read the same
 * across three animation frames running.
 */
async function settled(h: Harness): Promise<void> {
  await h.page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const boxes = (): string =>
          JSON.stringify(
            [
              ...document.querySelectorAll('.bt, .bt-chips, .bstats, .bt-member, .kanban, .lane'),
            ].map((el) => {
              const r = el.getBoundingClientRect();
              return [r.top, r.left, r.width, r.height];
            }),
          );
        const before = boxes();
        const frames = (left: number): void => {
          requestAnimationFrame(() => {
            if (left > 1) frames(left - 1);
            else resolve(boxes() === before);
          });
        };
        frames(3);
      }),
    undefined,
    { timeout: 10_000 },
  );
}

/** `.kanban`'s top and the toolbar row's box, for "did anything move". */
const rowGeometry = (h: Harness) =>
  h.page.evaluate(() => {
    const bt = document.querySelector('.bt')?.getBoundingClientRect();
    const chips = document.querySelector('.bt-chips')?.getBoundingClientRect();
    return {
      kanban: document.querySelector('.kanban')?.getBoundingClientRect().top ?? NaN,
      rowTop: bt?.top ?? NaN,
      rowHeight: bt?.height ?? NaN,
      chips: chips?.height ?? 0,
    };
  });

/**
 * **Nothing moves after the first paint** (LAI-727 review, round 2).
 *
 * The LAI-297 class of defect: something arriving late pushes every lane
 * down. In round 1 the members landing crowded the row, the group left it for
 * a line above, and the board dropped ~46px under the reader. Members,
 * sprints and presence are held back here so the first card is drawn before
 * any of them, which is the order a slow server produces.
 *
 * **Held on a gate, not delayed by a clock** (LAI-715). A 1200ms delay is
 * only "after the first card" on a machine that draws the board in under
 * 1200ms; GitHub's runner is not always one, and under 20x CPU throttling the
 * board takes ~1.5s. The answers now wait until the first card has been
 * measured, so the order is the test's, not the machine's.
 */
void describe('the board does not move after it is drawn (LAI-727 review)', () => {
  const LATE = ['/members', '/sprints', '/presence'];
  const late = async (page: Page, held: Promise<void>): Promise<void> => {
    for (const glob of ['**/members*', '**/sprints*', '**/presence*']) {
      await page.route(glob, async (route) => {
        await held;
        await route.continue();
      });
    }
  };

  for (const width of [1024, 920]) {
    void test(`${String(width)}px, sidebar open: members, sprints and counts land without a shift`, async () => {
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const h = await open('/board?project=laika-core&sprint=s2', SIX_MEMBERS, {
        before: async (page) => {
          await page.setViewportSize({ width, height: 768 });
          await late(page, held);
        },
      });
      try {
        await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
        const first = await rowGeometry(h);
        assert.equal(
          await h.page.locator('.bt-member').count(),
          0,
          'positive control: the members had already landed — nothing late to measure',
        );
        // Every held answer, counted as it lands — not a guess at when it has.
        const landed = Promise.all(
          LATE.map((path) =>
            h.page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(path), {
              timeout: 20_000,
            }),
          ),
        );
        release();
        await landed;
        await h.page.locator('.bt-member').first().waitFor({ timeout: 10_000 });
        await reads(h, `S2 ${stripSummary('s2')}`);
        await settled(h);
        const after = await rowGeometry(h);
        assert.ok(
          Math.abs(after.kanban - first.kanban) <= 1,
          `the lanes moved ${String(after.kanban - first.kanban)}px after the first card`,
        );
        assert.ok(Math.abs(after.rowTop - first.rowTop) <= 1, 'the toolbar row moved');
        assert.ok(Math.abs(after.rowHeight - first.rowHeight) <= 1, 'the toolbar row grew');
      } finally {
        // Released before unrouting, so a failure above cannot leave a route waiting.
        release();
        await h.page.unrouteAll({ behavior: 'ignoreErrors' });
        await h.close();
      }
    });
  }

  /*
   * Adding a filter may add the chip row under the toolbar (LAI-717) — that is
   * designed, and it moves the lanes by exactly its own height. Nothing else
   * may: not the toolbar row, and not a line for the group. 1120px on All
   * sprints is where round 1's group sat in the row until the Filter badge
   * appeared and then jumped above it.
   */
  const CASES = [
    { width: 1024, scope: 's2' },
    { width: 920, scope: 's2' },
    { width: 1120, scope: 'all' },
  ];
  for (const { width, scope } of CASES) {
    void test(`${String(width)}px, ${scope}: a new filter moves nothing but the chip row`, async () => {
      const h = await open(`/board?project=laika-core&sprint=${scope}`, SIX_MEMBERS);
      try {
        await h.page.setViewportSize({ width, height: 768 });
        await h.page.locator('.bt-member').first().waitFor({ timeout: 20_000 });
        await h.page.locator('.card').first().waitFor({ timeout: 10_000 });
        await settled(h);
        const before = await rowGeometry(h);

        await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
        await pick(
          h.page
            .locator('.bt-field')
            .filter({ has: h.page.locator('.bt-label', { hasText: /^Priority$/ }) })
            .locator('[role="combobox"]'),
          'p2',
        );
        await h.page.keyboard.press('Escape');
        await h.page.waitForFunction(() => location.search.includes('priority=p2'), undefined, {
          timeout: 5000,
        });
        await h.page.locator('.bt-badge').waitFor({ timeout: 5000 });
        await settled(h);
        const after = await rowGeometry(h);

        assert.ok(
          Math.abs(after.rowTop - before.rowTop) <= 1,
          `the toolbar row moved ${String(after.rowTop - before.rowTop)}px`,
        );
        assert.ok(Math.abs(after.rowHeight - before.rowHeight) <= 1, 'the toolbar row grew');
        const lanes = after.kanban - before.kanban;
        const chips = after.chips - before.chips;
        assert.ok(
          Math.abs(lanes - chips) <= 1,
          `the lanes moved ${String(lanes)}px; the chip row accounts for ${String(chips)}px`,
        );
        assertFits(await measureToolbar(h), `${String(width)}px after the filter`);
      } finally {
        await h.close();
      }
    });
  }
});

void describe('a board too long to read says its figures are partial (LAI-727)', () => {
  void test('the cap is reached, and DONE carries the marker', async () => {
    let served = 0;
    const h = await open('/board?project=laika-core&sprint=s2', {
      ...STUB,
      // The project's one walk (LAI-724): every page points at another.
      '/api/v1/projects/laika-core/tasks?limit=200': () => {
        served += 1;
        return {
          data: [
            { ...task('todo', 's2'), id: `x${String(served)}`, key: `LC-${String(500 + served)}` },
          ],
          next_cursor: `N${String(served)}`,
        };
      },
    });
    try {
      await h.page.locator('.bstats-partial').waitFor({ timeout: 20_000 });
      assert.match((await h.page.locator('.bstats-partial').getAttribute('title')) ?? '', /first/i);
    } finally {
      await h.close();
    }
  });
});
