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
 * adjacent in the lane**. That is stricter than the real endpoint, which
 * refuses only reversed bounds (`services/tasks.ts`; D-070 allows non-adjacent
 * neighbours) — the stub's check is there so a client that sent the wrong
 * neighbours goes red rather than being echoed back whatever it asked for. So
 * "it is still there after a reload" is a reload that asks the stub again.
 *
 * **Real pointer drags.** Playwright drives HTML5 drag-and-drop from the
 * mouse in Chromium, so `dragstart`, `dragover` with a real `clientY`, `drop`
 * and `dragend` all come from the browser. `column-reorder.test.ts` dispatches
 * synthetic events because it predates that; this file does not need to.
 *
 * **The keyboard path is keyboard alone** — focus and `Alt+Arrow`, no drag
 * events at all (D-060.6).
 *
 * **The stream is the harness's fake, driven by hand** (LAI-707's
 * `fakeStream`). The frames below are emitted by the test, shaped as
 * `eventView` ships them — the event named by its §4.8 type, the activity row
 * as data, no task body — so what they prove is what the **client** does with
 * a `task.updated` frame about a reorder: a second viewer redraws without a
 * reload, and a viewer mid-drop is not fought by one.
 *
 * ## What it does not prove
 *
 * The real server's key arithmetic — LAI-472 has its own tests — and that the
 * server **sends** that frame: `server/test/services/tasks.test.ts` proves the
 * `task.updated` row a reorder writes, and `events.test.ts` the wire shape of a
 * row and who it reaches. Nothing here opens a real `EventSource`.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Request, Response } from 'playwright';
import {
  applyStatusWrite,
  closeBrowser,
  fakeStream,
  open,
  refuse,
  setTheme,
  until,
  type ApiStub,
  type Harness,
} from './harness.ts';

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

/**
 * The four columns this file was written against, as project statuses
 * (LAI-739). Backlog and Cancelled exist, as every kind keeps one, and are
 * hidden so the lanes are the ones the drops below are aimed at.
 */
const STATUSES = [
  ['todo', 'To do', false],
  ['in_progress', 'In progress', false],
  ['review', 'Review', false],
  ['done', 'Done', false],
  ['backlog', 'Backlog', true],
  ['cancelled', 'Cancelled', true],
].map(([category, name, hidden], position) => ({
  id: `st-${String(category)}`,
  project_id: 'p1',
  name: String(name),
  category: String(category),
  position,
  hidden: hidden === true,
  created_at: 1,
  task_count: 0,
}));

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
  // Every task carries its status's id and name, as the server sends them.
  for (const t of tasks) applyStatusWrite(t, { status: t.status }, STATUSES);
  const find = (id: string): StubTask => {
    const found = tasks.find((t) => t.id === id);
    if (found === undefined) throw new Error(`no task ${id}`);
    return found;
  };

  const routes: Record<string, unknown> = {};
  for (const t of tasks) {
    routes[`/api/v1/tasks/${t.id}/status`] = (call: { body: unknown }) => {
      const to = STATUSES.find((s) => s.id === (call.body as { status_id?: string }).status_id);
      if (fail.status !== undefined && to?.category !== 'todo') return fail.status;
      const target = find(t.id);
      applyStatusWrite(target, call.body, STATUSES);
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
      '/api/v1/projects/laika-core/statuses': { data: STATUSES },
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

/** How many times the page has read `path` — the board's list, or `/me`. */
const reads = (h: Harness, path: string): number =>
  h.calls.filter((c) => c.method === 'GET' && c.path === path).length;

const TASK_LIST = '/api/v1/projects/laika-core/tasks';

interface Held {
  /** Let every held request through, now and from here on. */
  readonly release: () => void;
  /** The requests held so far, live — read it after acting. */
  readonly requests: readonly Request[];
}

/**
 * Hold every request matching `glob` in the browser until `release` is
 * called. A held request never reaches the stub, so `writes()` stays at zero
 * while the hold is on — but zero writes is also what a drop that sent
 * nothing looks like, so a test reads `requests` and asserts the POST it
 * expects is **in** the hold before building anything on it (CLAUDE.md §5: a
 * setup step with no assertion cannot fail).
 */
async function hold(h: Harness, glob: string): Promise<Held> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: Request[] = [];
  await h.page.route(glob, async (route) => {
    requests.push(route.request());
    await gate;
    await route.continue();
  });
  return { release, requests };
}

/** `METHOD /path` for each request a hold has caught. */
const heldWrites = (held: Held): string[] =>
  held.requests.map((r) => `${r.method()} ${new URL(r.url()).pathname}`);

/**
 * Assert that exactly `path`'s POST is held — the drop sent it and the
 * browser has it — and that nothing has reached the stub.
 */
async function holding(h: Harness, held: Held, path: string): Promise<void> {
  await until(() => held.requests.length > 0);
  assert.deepEqual(
    heldWrites(held),
    [`POST ${path}`],
    'the write is not held — this proves nothing',
  );
  assert.equal(writes(h).length, 0, 'a write reached the stub past the hold');
}

/** A page marked by a test, to tell a redraw from a reload. */
type Marked = Window & { __t3?: Element | null; __viewer?: boolean };

/**
 * A live frame as `/api/v1/events` sends one: the event is named by its §4.8
 * type and the data is the activity row — `eventView`, with the payload the
 * service wrote and **no task body**. A reorder's is `task.updated` with
 * `{ field: 'position', from, to }` (D-060.4); the client reads nothing from
 * the payload and re-walks the list instead.
 */
async function frame(
  h: Harness,
  type: string,
  taskId: string,
  payload: Record<string, unknown>,
  seq: number,
): Promise<void> {
  await h.page.evaluate(
    (f) => {
      (
        window as unknown as {
          __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
        }
      ).__laikaStream.emit(
        f.type,
        {
          id: `e${String(f.seq)}`,
          seq: f.seq,
          type: f.type,
          project_id: 'p1',
          task_id: f.taskId,
          actor_id: 'u2',
          actor_kind: 'user',
          actor_token_id: null,
          payload: f.payload,
          created_at: Date.now(),
        },
        String(f.seq),
      );
    },
    { type, taskId, payload, seq },
  );
}

/**
 * Arm **before** emitting a frame: resolves once the re-read the frame causes
 * — past the store's 300 ms debounce — has been **answered**. The response,
 * not the request reaching the stub: a request on the wire says nothing about
 * what is on screen. Nor does the response, quite — the store still has to
 * apply it — so every caller then waits for something **visible** that only
 * the applied read can produce, and asserts on that.
 */
function nextListRead(h: Harness): Promise<Response> {
  return h.page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === TASK_LIST,
    { timeout: 5_000 },
  );
}

/**
 * The one place a fixed window is the right instrument: a **second** re-read
 * must not happen, and an absence cannot be awaited. What this asserts is
 * exactly that: no additional read was observed during 400 ms — longer than
 * the debounce, which is where a second one would come from.
 */
async function noFurtherRead(h: Harness, listsBefore: number): Promise<void> {
  await h.page.waitForTimeout(400);
  assert.equal(reads(h, TASK_LIST), listsBefore + 1, 'the frame did not cause exactly one re-read');
}

/** The title a card shows. */
const titleOf = (h: Harness, id: string): Promise<string> =>
  cardAt(h, id).locator('.card-title').innerText();

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
      // The request is still held, so this cannot wait past the answer (LAI-715).
      await until(async () => (await order(h, LANE.todo)).join() === 't1,t3,t2');
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
        { path: '/api/v1/tasks/t1/status', body: { status_id: 'st-in_progress' } },
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
        { path: '/api/v1/tasks/t1/status', body: { status_id: 'st-in_progress' } },
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
        { path: '/api/v1/tasks/t1/status', body: { status_id: 'st-in_progress' } },
        { path: '/api/v1/tasks/t1/reorder', body: { after_task_id: 't4', before_task_id: 't5' } },
        // The compensating move: the status had landed, so it is undone.
        { path: '/api/v1/tasks/t1/status', body: { status_id: 'st-todo' } },
      ]);
      assert.equal(w.tasks.find((t) => t.id === 't1')?.status, 'todo', 'the server kept the move');
      await until(
        async () =>
          (await order(h, LANE.todo)).join() === 't1,t2,t3' &&
          (await order(h, LANE.doing)).join() === 't4,t5',
      );
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
        { path: '/api/v1/tasks/t1/status', body: { status_id: 'st-in_progress' } },
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

void describe('the move reconciles with the stream (LAI-473)', () => {
  void test('an echo arriving before the answer does not snap the card back', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    let held: Held | undefined;
    try {
      await ready(h);
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't2', 't3']);
      await h.page.evaluate(() => {
        (window as Marked).__t3 = document.querySelector('article.card[data-task-id="t3"]');
      });
      held = await hold(h, '**/api/v1/tasks/*/reorder');

      await pickUp(h, 't3', 't2', 'upper');
      await drop(h);
      await holding(h, held, '/api/v1/tasks/t3/reorder');
      await until(async () => (await order(h, LANE.todo)).join() === 't1,t3,t2');
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't3', 't2'], 'the drop was not drawn');

      // The server's echo of this very move, as another tab would hear it —
      // arriving while the answer is still on its way. The stub has not been
      // asked yet, so the re-read it causes returns t3 **where it was**. The
      // rename of LAI-1 is a tracer, nothing more: the thing under test is
      // that t3 does *not* move, and an unchanged lane cannot show that the
      // read landed — the new title can.
      w.tasks.find((t) => t.id === 't1')!.title = 'Task one';
      const listsBefore = reads(h, TASK_LIST);
      const answered = nextListRead(h);
      await frame(h, 'task.updated', 't3', { field: 'position', from: key(3), to: key(1.5) }, 1);
      await answered;
      await until(async () => (await titleOf(h, 't1')) === 'Task one');
      assert.equal(await titleOf(h, 't1'), 'Task one', 'the re-read was not applied');
      assert.deepEqual(heldWrites(held), ['POST /api/v1/tasks/t3/reorder'], 'the hold let go');
      assert.equal(writes(h).length, 0, 'the answer arrived before the re-read — proves nothing');
      assert.deepEqual(
        await order(h, LANE.todo),
        ['t1', 't3', 't2'],
        'a re-read older than the drop snapped the card back',
      );
      await noFurtherRead(h, listsBefore);

      held.release();
      await settled(h, 1);
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't3', 't2'], 'the answer moved it again');
      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t3/reorder', body: { after_task_id: 't1', before_task_id: 't2' } },
      ]);
      const same = await h.page.evaluate(() => {
        const marked = window as Marked;
        return (
          marked.__t3?.isConnected === true &&
          marked.__t3 === document.querySelector('article.card[data-task-id="t3"]')
        );
      });
      assert.equal(same, true, 'the card was rebuilt rather than moved');
    } finally {
      held?.release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test('a frame about another card, mid cross-lane drop, does not pull the card back', async () => {
    /*
     * The same-lane case above does not optimistically change the dragged
     * card's body before the answer — the drop is drawn from `placing` — so a
     * re-read that ignored the write in flight would still read right. A
     * cross-lane drop **does** change it: the card
     * is in its new lane locally and its old one on the server until the
     * status lands, and that is the state a re-read has to leave alone.
     */
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    let held: Held | undefined;
    try {
      await ready(h);
      held = await hold(h, '**/api/v1/tasks/*/status');

      await pickUp(h, 't1', 't5', 'upper');
      await drop(h);
      await holding(h, held, '/api/v1/tasks/t1/status');
      await until(async () => (await order(h, LANE.doing)).join() === 't4,t1,t5');
      assert.deepEqual(await order(h, LANE.doing), ['t4', 't1', 't5'], 'the drop was not drawn');

      // Another viewer renames LAI-2; the server tells everyone.
      w.tasks.find((t) => t.id === 't2')!.title = 'Task two';
      const listsBefore = reads(h, TASK_LIST);
      const answered = nextListRead(h);
      await frame(h, 'task.updated', 't2', { field: 'title', from: 'Task 2', to: 'Task two' }, 2);
      await answered;
      // The re-read was applied — the rename shows — and the drop survived it.
      await until(async () => (await titleOf(h, 't2')) === 'Task two');
      assert.equal(await titleOf(h, 't2'), 'Task two', 'the re-read was not applied');
      assert.deepEqual(heldWrites(held), ['POST /api/v1/tasks/t1/status'], 'the hold let go');
      assert.equal(writes(h).length, 0, 'the answer arrived before the re-read — proves nothing');
      assert.deepEqual(
        await order(h, LANE.doing),
        ['t4', 't1', 't5'],
        'the re-read pulled the card back to its old lane',
      );
      assert.deepEqual(await order(h, LANE.todo), ['t2', 't3']);
      await noFurtherRead(h, listsBefore);

      held.release();
      await settled(h, 2);
      assert.deepEqual(await order(h, LANE.doing), ['t4', 't1', 't5'], 'the answer moved it again');
      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t1/status', body: { status_id: 'st-in_progress' } },
        { path: '/api/v1/tasks/t1/reorder', body: { after_task_id: 't4', before_task_id: 't5' } },
      ]);
    } finally {
      held?.release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });

  void test("another viewer's change during the drop lands beside the dropped card", async () => {
    /*
     * The other viewer moves LAI-5 into To do, at the end — not LAI-1 or
     * LAI-2, which are the drop's neighbours. That sidesteps the **stub's**
     * check, which refuses `409` when the named neighbours are no longer
     * adjacent in the lane; the real endpoint is looser (it refuses only
     * reversed bounds, and D-070 allows non-adjacent neighbours), so this is a
     * choice about the fixture, not a claim about production.
     */
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    let held: Held | undefined;
    try {
      await ready(h);
      held = await hold(h, '**/api/v1/tasks/*/reorder');

      await pickUp(h, 't3', 't2', 'upper');
      await drop(h);
      await holding(h, held, '/api/v1/tasks/t3/reorder');
      await until(async () => (await order(h, LANE.todo)).join() === 't1,t3,t2');
      assert.deepEqual(await order(h, LANE.todo), ['t1', 't3', 't2'], 'the drop was not drawn');

      const t5 = w.tasks.find((t) => t.id === 't5')!;
      applyStatusWrite(t5, { status_id: 'st-todo' }, STATUSES);
      t5.position = key(4);
      const listsBefore = reads(h, TASK_LIST);
      const answered = nextListRead(h);
      // The payload `changeStatus` writes: categories, and the two statuses by
      // id and name beside them (`statusPayload`, LAI-738).
      await frame(
        h,
        'task.status_changed',
        't5',
        {
          from: 'in_progress',
          to: 'todo',
          from_status_id: 'st-in_progress',
          from_status_name: 'In progress',
          to_status_id: 'st-todo',
          to_status_name: 'To do',
        },
        3,
      );
      await answered;
      await until(async () => (await order(h, LANE.todo)).join() === 't1,t3,t2,t5');
      assert.deepEqual(heldWrites(held), ['POST /api/v1/tasks/t3/reorder'], 'the hold let go');
      assert.equal(writes(h).length, 0, 'the answer arrived before the re-read — proves nothing');
      assert.deepEqual(
        await order(h, LANE.todo),
        ['t1', 't3', 't2', 't5'],
        "the other viewer's card is not beside the dropped one",
      );
      assert.deepEqual(await order(h, LANE.doing), ['t4']);
      await noFurtherRead(h, listsBefore);

      held.release();
      await settled(h, 1);
      assert.deepEqual(
        await order(h, LANE.todo),
        ['t1', 't3', 't2', 't5'],
        'the answer moved it again',
      );
      assert.deepEqual(writes(h), [
        { path: '/api/v1/tasks/t3/reorder', body: { after_task_id: 't1', before_task_id: 't2' } },
      ]);
    } finally {
      held?.release();
      await h.page.unrouteAll({ behavior: 'ignoreErrors' });
      await h.close();
    }
  });
});

void describe('a second viewer sees the reorder over SSE (LAI-473)', () => {
  void test('redraws the lane on the frame, without a reload', async () => {
    // One world, two browsers: each `open` runs its own stub server over the
    // same task list, so what A writes is what B's next read returns.
    const w = world();
    const a = await open('/board?project=laika-core', w.stub, { before: fakeStream });
    let closeB: () => Promise<void> = () => Promise.resolve();
    try {
      const b = await open('/board?project=laika-core', w.stub, { before: fakeStream });
      closeB = b.close;
      await ready(a);
      await ready(b);
      assert.deepEqual(await order(b, LANE.todo), ['t1', 't2', 't3']);
      await b.page.evaluate(() => {
        (window as Marked).__viewer = true;
      });
      const meBefore = reads(b, '/api/v1/me');

      await pickUp(a, 't3', 't2', 'upper');
      await drop(a);
      await settled(a, 1);
      assert.deepEqual(await order(a, LANE.todo), ['t1', 't3', 't2']);
      // Nothing has told B yet — the stub is not a stream — so the frame below
      // is the only thing that can move its lane.
      assert.deepEqual(
        await order(b, LANE.todo),
        ['t1', 't2', 't3'],
        'the second viewer moved before any frame — this proves nothing',
      );

      const moved = w.tasks.find((t) => t.id === 't3')!;
      await frame(
        b,
        'task.updated',
        't3',
        { field: 'position', from: key(3), to: moved.position },
        4,
      );
      await until(async () => (await order(b, LANE.todo)).join() === 't1,t3,t2');
      assert.deepEqual(
        await order(b, LANE.todo),
        ['t1', 't3', 't2'],
        'the second viewer did not see the reorder',
      );
      assert.equal(reads(b, '/api/v1/me'), meBefore, 'the second viewer reloaded');
      assert.equal(
        await b.page.evaluate(() => (window as Marked).__viewer === true),
        true,
        'the page was reloaded',
      );
    } finally {
      await closeB();
      await a.close();
    }
  });
});
