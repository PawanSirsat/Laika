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

void describe('the figures come from the board’s own read (LAI-727)', () => {
  void test('a sprint-scoped board makes no whole-project task read', async () => {
    const urls: string[] = [];
    const h = await open('/board?project=laika-core', STUB, { before: recordTaskReads(urls) });
    try {
      await reads(h, `S2 ${stripSummary('s2')}`);
      await h.page.waitForTimeout(800);
      assert.ok(urls.length > 0, 'positive control: the board read its tasks');
      const unscoped = urls.filter((q) => !new URLSearchParams(q).has('sprint'));
      assert.deepEqual(unscoped, [], 'a task read without ?sprint= — the whole-project walk');
      assert.deepEqual(h.unmatched, []);
    } finally {
      await h.close();
    }
  });

  void test('narrowed by assignee, a sprint’s figures stay the sprint’s — one ?sprint= read', async () => {
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
      await h.page.waitForTimeout(800);
      const plain = urls.filter((q) => {
        const p = new URLSearchParams(q);
        return p.get('sprint') === 's2' && !p.has('assignee');
      });
      assert.equal(plain.length, 1, `expected one unnarrowed sprint read, saw ${plain.join(' ')}`);
      assert.deepEqual(
        urls.filter((q) => !new URLSearchParams(q).has('sprint')),
        [],
        'a whole-project read',
      );
    } finally {
      await h.close();
    }
  });

  void test('narrowed on All sprints, the figures are the shown tasks’ and say so', async () => {
    const urls: string[] = [];
    const h = await open('/board?project=laika-core&sprint=all&assignee=u2', STUB, {
      before: recordTaskReads(urls),
    });
    try {
      await h.page.locator('.card').first().waitFor({ timeout: 20_000 });
      await reads(h, 'All sprints · filtered DONE 1/3 BLK 1 LEFT —');
      assert.match(
        (await h.page.locator('.bstats').getAttribute('aria-label')) ?? '',
        /filtered/i,
        'the label does not say the figures are of the filtered tasks',
      );
      await h.page.waitForTimeout(800);
      assert.deepEqual(
        urls.filter((q) => !new URLSearchParams(q).has('assignee')),
        [],
        'the whole project was read to count every sprint',
      );
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
      .locator('select');

  void test('choosing a sprint moves the figures; Any and the chip’s × are All sprints', async () => {
    const h = await open('/board?project=laika-core', STUB);
    try {
      await reads(h, `S2 ${stripSummary('s2')}`);

      await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
      await sprintSelect(h).selectOption('s3');
      await h.page.waitForFunction(() => location.search.includes('sprint=s3'), undefined, {
        timeout: 5000,
      });
      await reads(h, `S3 ${stripSummary('s3')}`);

      await sprintSelect(h).selectOption({ label: 'Any' });
      await h.page.waitForFunction(() => location.search.includes('sprint=all'), undefined, {
        timeout: 5000,
      });
      await reads(h, `All sprints ${stripSummary(undefined)}`);

      await sprintSelect(h).selectOption('s1');
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

          const measure = () =>
            h.page.evaluate(() => {
              const r = (el: Element | null) => {
                if (el === null) return null;
                const b = el.getBoundingClientRect();
                return { l: b.left, t: b.top, r: b.right, b: b.bottom };
              };
              const others: Record<string, ReturnType<typeof r>> = {
                search: r(document.querySelector('.bt-search')),
                filter: r(
                  [...document.querySelectorAll('.bt-button')].find((b) =>
                    (b.textContent ?? '').includes('Filter'),
                  ) ?? null,
                ),
                chips: r(document.querySelector('.bt-chips')),
                popover: r(document.querySelector('.bt-pop')),
              };
              document.querySelectorAll('.bt-icon').forEach((el, i) => {
                others[`icon${String(i)}`] = r(el);
              });
              return {
                stats: r(document.querySelector('.bstats')),
                others,
                sideways:
                  document.documentElement.scrollWidth > document.documentElement.clientWidth,
              };
            });

          const check = (m: Awaited<ReturnType<typeof measure>>, when: string) => {
            assert.ok(m.stats !== null, `${when}: no stat group`);
            assert.ok(m.stats.r - m.stats.l > 40, `${when}: the group collapsed to nothing`);
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
          };

          check(await measure(), 'closed');
          await h.page.locator('.bt-button', { hasText: 'Filter' }).click();
          await h.page.locator('.bt-pop').waitFor({ timeout: 5000 });
          const opened = await measure();
          assert.ok(opened.others.popover !== null, 'positive control: the popover is open');
          check(opened, 'popover open');
        } finally {
          await h.close();
        }
      });
    }
  }
});

void describe('a board too long to read says its figures are partial (LAI-727)', () => {
  void test('the cap is reached, and DONE carries the marker', async () => {
    let served = 0;
    const h = await open('/board?project=laika-core&sprint=s2', {
      ...STUB,
      '/api/v1/projects/laika-core/tasks?limit=200&sprint=s2': () => {
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
