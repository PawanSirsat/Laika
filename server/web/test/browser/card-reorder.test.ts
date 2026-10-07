/**
 * Dragging a card to a place in its lane, or another lane's (LAI-473).
 *
 * ## What this proves
 *
 * **The rendered order, not a function call.** Every assertion about where a
 * card is reads `article.card[data-task-id]` out of a lane in DOM order, as
 * LAI-260 did for the sidebar. A stubbed `place()` that was called with the
 * right arguments and drew nothing would fail here.
 *
 * **The stub is stateful.** It keeps the project's tasks in memory, a
 * `/status` changes the status, and a `/reorder` gives the card a key between
 * its neighbours — **and refuses `409` when the neighbours it was sent are not
 * adjacent in the lane**, which is what the real endpoint does with a stale
 * drag. So "it is still there after a reload" is a reload that asks the stub
 * again, and a client that sent the wrong neighbours goes red rather than
 * being echoed back whatever it asked for.
 *
 * **Real pointer drags.** Playwright drives HTML5 drag-and-drop from the
 * mouse in Chromium, so `dragstart`, `dragover` with a real `clientY`, `drop`
 * and `dragend` all come from the browser. `column-reorder.test.ts` dispatches
 * synthetic events because it predates that; this file does not need to.
 *
 * **The keyboard path is keyboard alone** — focus and `Alt+Arrow`, no drag
 * events at all (D-060.6).
 *
 * ## What it does not prove
 *
 * The real server's key arithmetic — LAI-472 has its own tests — and the SSE
 * path a second viewer sees, which needs a stream this harness does not serve.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { closeBrowser, open, refuse, setTheme, type ApiStub, type Harness } from './harness.ts';

const PROJECT = {
  id: 'p1',
  slug: 'laika-core',
  name: 'Laika Core',
  prefix: 'LAI',
  description: null,
  repo: null,
  visibility: 'private',
  context_md: '',
  board_hide_done_days: null,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
  task_counts: { backlog: 0, todo: 3, in_progress: 2, review: 0, done: 0, cancelled: 0 },
  blocked_count: 0,
  member_count: 1,
  members: [{ user_id: 'u1', name: 'Ada Lovelace' }],
  last_activity_at: 2,
};

function column(id: string, name: string, position: number, statuses: string[]) {
  return {
    id,
    project_id: 'p1',
    name,
    position,
    hidden: false,
    statuses,
    primary_status: statuses[0] ?? null,
  };
}

const COLUMNS = [
  column('c1', 'To do', 0, ['todo']),
  column('c2', 'In progress', 1, ['in_progress']),
  column('c3', 'Review', 2, ['review']),
  column('c4', 'Done', 3, ['done']),
];

interface StubTask {
  id: string;
  key: string;
  number: number;
  status: string;
  priority: string;
  position: string;
  [field: string]: unknown;
}

/**
 * A fixed-width decimal: byte-wise order is numeric order, which is the only
 * property the client relies on. Opaque to the code under test, as the real
 * keys are.
 */
const key = (n: number): string => n.toFixed(10);

const task = (n: number, status: string, position: number, priority: string): StubTask => ({
  id: `t${String(n)}`,
  key: `LAI-${String(n)}`,
  project_id: 'p1',
  number: n,
  title: `Task ${String(n)}`,
  description_md: null,
  acceptance_md: null,
  status,
  priority,
  position: key(position),
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
  updated_at: 1,
});

/**
 * **Position order disagrees with priority order on purpose** (D-070): LAI-3
 * is `p0`, so a lane still sorted by priority would draw it first, and the
 * opening order assertion in every test is the positive control for that.
 */
function seed(): StubTask[] {
  return [
    task(1, 'todo', 1, 'p2'),
    task(2, 'todo', 2, 'p3'),
    task(3, 'todo', 3, 'p0'),
    task(4, 'in_progress', 1, 'p2'),
    task(5, 'in_progress', 2, 'p2'),
  ];
}

interface World {
  readonly stub: ApiStub;
  readonly tasks: StubTask[];
}

interface Failures {
  readonly status?: unknown;
  readonly reorder?: unknown;
  readonly me?: unknown;
}

const EDITOR = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Ada Lovelace',
  org_role: 'owner',
  is_active: true,
  memberships: [{ project_id: 'p1', role: 'lead' }],
};

const VIEWER = {
  id: 'u2',
  email: 'v@example.com',
  name: 'Vic Viewer',
  org_role: 'viewer',
  is_active: true,
  memberships: [],
};

function lane(tasks: readonly StubTask[], status: string): StubTask[] {
  return tasks
    .filter((t) => t.status === status)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/** Answers what the real server would, from state it keeps. */
function world(fail: Failures = {}): World {
  const tasks = seed();
  const find = (id: string): StubTask => {
    const found = tasks.find((t) => t.id === id);
    if (found === undefined) throw new Error(`no task ${id}`);
    return found;
  };

  const routes: Record<string, unknown> = {};
  for (const t of tasks) {
    routes[`/api/v1/tasks/${t.id}/status`] = (call: { body: unknown }) => {
      if (fail.status !== undefined && (call.body as { status: string }).status !== 'todo') {
        return fail.status;
      }
      const target = find(t.id);
      target.status = (call.body as { status: string }).status;
      return { ...target };
    };
    routes[`/api/v1/tasks/${t.id}/reorder`] = (call: { body: unknown }) => {
      if (fail.reorder !== undefined) return fail.reorder;
      const body = call.body as { after_task_id?: string; before_task_id?: string };
      const moved = find(t.id);
      const others = lane(tasks, moved.status).filter((o) => o.id !== moved.id);
      // -1 is "the top" for `above` and "not in this lane" for a named card,
      // so a named card that is missing is told apart explicitly.
      const indexOf = (id: string | undefined, none: number) =>
        id === undefined ? none : others.findIndex((o) => o.id === id);
      const above = indexOf(body.after_task_id, -1);
      const below = indexOf(body.before_task_id, others.length);
      const missing =
        (body.after_task_id !== undefined && above === -1) ||
        (body.before_task_id !== undefined && below === -1);
      // The real endpoint's stale-neighbour answer: the two named cards must
      // be next to each other in the lane the card now sits in.
      if (missing || below !== above + 1) {
        return refuse(409, 'conflict', 'The order changed — reload and try again');
      }
      const lo = above === -1 ? 0 : Number(others[above]!.position);
      const hi = below === others.length ? lo + 2 : Number(others[below]!.position);
      moved.position = key((lo + hi) / 2);
      return { ...moved };
    };
  }

  return {
    tasks,
    stub: {
      '/api/v1/me': fail.me ?? EDITOR,
      '/api/v1/projects': { data: [PROJECT], next_cursor: null },
      '/api/v1/projects/laika-core': PROJECT,
      '/api/v1/projects/laika-core/board-columns': { columns: COLUMNS },
      // Number order, not position order, so the client's sort is what draws
      // the lane and not the order the rows happened to arrive in.
      '/api/v1/projects/laika-core/tasks': () => ({
        data: [...tasks].sort((a, b) => a.number - b.number).map((t) => ({ ...t })),
        next_cursor: null,
      }),
      '/api/v1/projects/laika-core/members': {
        members: [{ user_id: 'u1', name: 'Ada Lovelace', role: 'lead' }],
      },
      '/api/v1/projects/laika-core/sprints': { data: [], next_cursor: null },
      '/api/v1/projects/laika-core/activity': { data: [], next_cursor: null },
      '/api/v1/projects/laika-core/tags': { tags: [] },
      '/api/v1/presence': { data: [], next_cursor: null },
      ...routes,
    },
  };
}

const LANE = { todo: 'todo', doing: 'in_progress' } as const;

/** A lane's cards, top to bottom, as drawn. */
async function order(h: Harness, status: string): Promise<string[]> {
  return h.page
    .locator(`.lane[data-status="${status}"] article.card[data-task-id]`)
    .evaluateAll((cards) => cards.map((c) => c.getAttribute('data-task-id') ?? '?'));
}

async function ready(h: Harness): Promise<void> {
  await h.page.locator('article.card[data-task-id]').first().waitFor({ timeout: 15_000 });
}

/** The writes the page sent, in order — reads are noise here. */
const writes = (h: Harness) =>
  h.calls
    .filter((c) => c.method === 'POST' && c.path.startsWith('/api/v1/tasks/'))
    .map((c) => ({ path: c.path, body: c.body }));

/** Wait until `n` task writes have been answered and nothing is in flight. */
async function settled(h: Harness, n: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (writes(h).length < n) {
    if (Date.now() > deadline) {
      assert.fail(`expected ${String(n)} writes, saw ${JSON.stringify(writes(h))}`);
    }
    await h.page.waitForTimeout(25);
  }
  await h.page.locator('article.card-moving').waitFor({ state: 'detached', timeout: 5000 });
  await h.page.waitForTimeout(100);
}

const cardAt = (h: Harness, id: string) => h.page.locator(`article.card[data-task-id="${id}"]`);

/**
 * Press on `from`, move the pointer over `to`'s upper or lower half, and keep
 * the button down. Real mouse input; Chromium turns it into a native drag.
 */
async function pickUp(h: Harness, from: string, to: string, half: 'upper' | 'lower') {
  const source = await cardAt(h, from).boundingBox();
  assert.ok(source !== null, `${from} has no box`);
  await h.page.mouse.move(source.x + source.width / 2, source.y + 12);
  await h.page.mouse.down();
  // A few pixels first, so the drag has started before the long move.
  await h.page.mouse.move(source.x + source.width / 2 + 4, source.y + 18, { steps: 4 });
  const target = await cardAt(h, to).boundingBox();
  assert.ok(target !== null, `${to} has no box`);
  const y = target.y + target.height * (half === 'upper' ? 0.25 : 0.75);
  await h.page.mouse.move(target.x + target.width / 2, y, { steps: 12 });
}

async function drop(h: Harness): Promise<void> {
  await h.page.mouse.up();
}

void after(async () => {
  await closeBrowser();
});

void describe('dropping a card between two others (LAI-473)', () => {
  void test('puts it there, sends exactly those neighbours, and it survives a reload', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await ready(h);
      // Positive control, and D-070: position order, not priority (LAI-3 is p0).
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't2', 't3']);

      await pickUp(h, 't3', 't2', 'upper');
      await drop(h);
      await settled(h, 1);

      assert.deepEqual(
        await order(h, LANE.todo),
        ['t1', 't3', 't2'],
        'the card is not where it was dropped',
      );
      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t3/reorder', body: { after_task_id: 't1', before_task_id: 't2' } },
      ]);

      await h.page.reload();
      await ready(h);
      assert.deepEqual(
        await order(h, LANE.todo),
        ['t1', 't3', 't2'],
        'the order did not survive a reload',
      );
    } finally {
      await h.close();
    }
  });

  void test('moves on drop, before the server has answered (optimistic)', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await ready(h);
      // Hold the reorder in the browser, so "moved" can only mean "moved
      // before the answer".
      await h.page.route('**/api/v1/tasks/*/reorder', async (route) => {
        await held;
        await route.continue();
      });

      await pickUp(h, 't3', 't2', 'upper');
      await drop(h);
      await h.page.waitForTimeout(200);
      assert.equal(writes(h).length, 0, 'the request was not held — this proves nothing');
      assert.deepEqual(
        await order(h, LANE.todo),
        ['t1', 't3', 't2'],
        'the card waited for the server',
      );

      release();
      await settled(h, 1);
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't3', 't2'], 'the answer moved it again');
    } finally {
      release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('draws a drop line between the cards while dragging, and none after', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await ready(h);
      assert.equal(
        await h.page.locator('.lane-drop').count(),
        0,
        'a line is drawn before any drag',
      );

      await pickUp(h, 't3', 't2', 'upper');
      const line = h.page.locator('.lane[data-status="todo"] .lane-drop');
      await line.waitFor({ state: 'visible', timeout: 2000 });
      assert.equal(await h.page.locator('.lane-drop').count(), 1, 'exactly one line');

      // **Between** t1 and t2, not on a card: its box sits in the gap.
      const [above, below, box] = await Promise.all([
        cardAt(h, 't1').boundingBox(),
        cardAt(h, 't2').boundingBox(),
        line.boundingBox(),
      ]);
      assert.ok(above !== null && below !== null && box !== null);
      assert.ok(box.height > 0 && box.width > 0, 'the line has no size');
      assert.ok(box.y >= above.y + above.height - 1, 'the line overlaps the card above');
      assert.ok(box.y + box.height <= below.y + 1, 'the line overlaps the card below');

      await drop(h);
      await settled(h, 1);
      assert.equal(await h.page.locator('.lane-drop').count(), 0, 'the line outlived the drop');
    } finally {
      await h.close();
    }
  });
});

void describe('a cross-lane drop (LAI-473, D-060.3)', () => {
  void test('lands where it was dropped, not at the end: status, then reorder', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await ready(h);
      assert.deepEqual(await order(h, LANE.doing), ['t4', 't5']);

      await pickUp(h, 't1', 't5', 'upper');
      await drop(h);
      await settled(h, 2);

      assert.deepEqual(await order(h, LANE.doing), ['t4', 't1', 't5'], 'not where it was dropped');
      assert.deepEqual(await order(h, LANE.todo), ['t2', 't3']);
      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t1/status', body: { status: 'in_progress' } },
        { path: '/api/v1/tasks/t1/reorder', body: { after_task_id: 't4', before_task_id: 't5' } },
      ]);

      await h.page.reload();
      await ready(h);
      assert.deepEqual(await order(h, LANE.doing), ['t4', 't1', 't5'], 'lost on reload');
    } finally {
      await h.close();
    }
  });

  void test('a refused status puts the card back, and the reorder is never sent', async () => {
    const w = world({
      status: refuse(422, 'invalid_transition', 'Only the assignee may start this task'),
    });
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await ready(h);
      await pickUp(h, 't1', 't5', 'upper');
      await drop(h);
      await settled(h, 1);

      assert.deepEqual(await order(h, LANE.todo), ['t1', 't2', 't3'], 'the card did not come back');
      assert.deepEqual(await order(h, LANE.doing), ['t4', 't5']);
      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t1/status', body: { status: 'in_progress' } },
      ]);
      await h.page.getByText('Only the assignee may start this task').waitFor({ timeout: 2000 });
    } finally {
      await h.close();
    }
  });

  void test('a refused reorder puts the card back and sends the status back too', async () => {
    const w = world({
      reorder: refuse(409, 'conflict', 'The order changed — reload and try again'),
    });
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await ready(h);
      await pickUp(h, 't1', 't5', 'upper');
      await drop(h);
      await settled(h, 3);

      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t1/status', body: { status: 'in_progress' } },
        { path: '/api/v1/tasks/t1/reorder', body: { after_task_id: 't4', before_task_id: 't5' } },
        // The compensating move: the status had landed, so it is undone.
        { path: '/api/v1/tasks/t1/status', body: { status: 'todo' } },
      ]);
      assert.equal(w.tasks.find((t) => t.id === 't1')?.status, 'todo', 'the server kept the move');
      await h.page.waitForTimeout(300);
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't2', 't3'], 'the card did not come back');
      assert.deepEqual(await order(h, LANE.doing), ['t4', 't5']);
    } finally {
      await h.close();
    }
  });
});

void describe('the keyboard path (LAI-473, D-060.6)', () => {
  const focused = (h: Harness) =>
    h.page.evaluate(
      () => document.activeElement?.closest('[data-task-id]')?.getAttribute('data-task-id') ?? null,
    );
  const announced = (h: Harness) =>
    h.page.locator('.kanban [aria-live="polite"]').first().innerText();

  void test('Alt+Arrow moves the focused card, says so, and keeps focus on it', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await ready(h);
      await cardAt(h, 't1').locator('.card-open').focus();
      assert.equal(await focused(h), 't1');

      await h.page.keyboard.press('Alt+ArrowDown');
      await settled(h, 1);
      assert.deepEqual(await order(h, LANE.todo), ['t2', 't1', 't3']);
      assert.equal(await focused(h), 't1', 'focus left the moved card');
      assert.match(await announced(h), /Moved LAI-1 to position 2 of 3 in To do/);

      await h.page.keyboard.press('Alt+ArrowUp');
      await settled(h, 2);
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't2', 't3']);
      assert.equal(await focused(h), 't1', 'focus left the moved card');

      await h.page.keyboard.press('Alt+ArrowRight');
      await settled(h, 4);
      assert.deepEqual(await order(h, LANE.doing), ['t1', 't4', 't5']);
      assert.deepEqual(await order(h, LANE.todo), ['t2', 't3']);
      assert.equal(await focused(h), 't1', 'focus left the card that changed lanes');
      assert.match(await announced(h), /Moved LAI-1 to In progress, position 1 of 3/);

      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t1/reorder', body: { after_task_id: 't2', before_task_id: 't3' } },
        { path: '/api/v1/tasks/t1/reorder', body: { before_task_id: 't2' } },
        { path: '/api/v1/tasks/t1/status', body: { status: 'in_progress' } },
        { path: '/api/v1/tasks/t1/reorder', body: { before_task_id: 't4' } },
      ]);
    } finally {
      await h.close();
    }
  });
});

void describe('a viewer who may not write tasks (LAI-473, LAI-082)', () => {
  void test('gets no draggable card and no move shortcut — absent, not refused', async () => {
    // Positive control: the same board for an editor carries both.
    const editor = await open('/board?project=laika-core', world().stub);
    try {
      await ready(editor);
      assert.equal(await editor.page.locator('article.card[draggable="true"]').count(), 5);
      assert.equal(await editor.page.locator('.card-open[aria-keyshortcuts]').count(), 5);
    } finally {
      await editor.close();
    }

    const viewer = await open('/board?project=laika-core', world({ me: VIEWER }).stub);
    try {
      await ready(viewer);
      assert.equal(await viewer.page.locator('article.card').count(), 5, 'the cards must render');
      assert.equal(
        await viewer.page
          .locator('[draggable="true"] article.card, article.card[draggable="true"]')
          .count(),
        0,
      );
      assert.equal(await viewer.page.locator('[aria-keyshortcuts]').count(), 0);
    } finally {
      await viewer.close();
    }
  });
});

void describe('the drop line in both themes (CLAUDE.md §5.1)', () => {
  void test('is painted, and differs from the lane behind it, in Dark and in Light', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub);
    try {
      await ready(h);
      for (const theme of ['Dark', 'Light']) {
        await setTheme(h.page, theme);
        await h.page.waitForTimeout(200);

        await pickUp(h, 't3', 't2', 'upper');
        const line = h.page.locator('.lane-drop');
        await line.waitFor({ state: 'visible', timeout: 2000 });
        const [paint, behind] = await Promise.all([
          line.evaluate((el) => getComputedStyle(el).backgroundColor),
          h.page.locator('.lane[data-status="todo"]').evaluate((el) => {
            // The first ancestor-or-self that actually paints.
            for (let n: Element | null = el; n !== null; n = n.parentElement) {
              const bg = getComputedStyle(n).backgroundColor;
              if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
            }
            return getComputedStyle(document.body).backgroundColor;
          }),
        ]);
        assert.notEqual(paint, 'rgba(0, 0, 0, 0)', `${theme}: the drop line is transparent`);
        assert.notEqual(paint, 'transparent', `${theme}: the drop line is transparent`);
        assert.notEqual(paint, behind, `${theme}: the drop line is the colour of its lane`);

        // Back over where it started: a drop that changes nothing sends nothing.
        const home = await cardAt(h, 't3').boundingBox();
        assert.ok(home !== null);
        await h.page.mouse.move(home.x + home.width / 2, home.y + home.height * 0.75, { steps: 8 });
        await drop(h);
        await h.page.waitForTimeout(150);
      }
      assert.deepEqual(writes(h), [], 'a no-op drop sent a write');
    } finally {
      await h.close();
    }
  });
});
