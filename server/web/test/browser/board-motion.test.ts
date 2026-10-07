/**
 * Cards glide to where they now belong, and someone else's change glows
 * (LAI-708, D-071).
 *
 * ## The instrument
 *
 * `motionProbe` wraps `document.startViewTransition` before the app loads and
 * records, per transition, which cards were named before the update and after
 * it, what `data-board-motion` said once it was running, and the durations of
 * the `::view-transition-group` animations. **The first test proves the probe
 * sees a transition at all** — every other test asserts against it, and a probe
 * that recorded nothing would make "no transition ran" pass for free.
 *
 * ## What it does not prove
 *
 * How the glide looks. It proves the browser was asked to animate the right
 * cards for 200ms and cleaned up after; the picture is the browser's.
 */

import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Page } from 'playwright';
import { closeBrowser, fakeStream, open, refuse, type ApiStub, type Harness } from './harness.ts';

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
  status: string;
  position: string;
  title: string;
  [field: string]: unknown;
}

const key = (n: number): string => n.toFixed(10);

const task = (n: number, status: string, position: number): StubTask => ({
  id: `t${String(n)}`,
  key: `LAI-${String(n)}`,
  project_id: 'p1',
  number: n,
  title: `Task ${String(n)}`,
  description_md: null,
  acceptance_md: null,
  status,
  priority: 'p2',
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

interface World {
  readonly stub: ApiStub;
  readonly tasks: StubTask[];
}

/** A stateful server: `/status` and `/reorder` change what the next read returns. */
function world(fail: { readonly status?: boolean } = {}): World {
  const tasks = [
    task(1, 'todo', 1),
    task(2, 'todo', 2),
    task(3, 'todo', 3),
    task(4, 'in_progress', 1),
    task(5, 'in_progress', 2),
  ];
  const find = (id: string): StubTask => {
    const found = tasks.find((t) => t.id === id);
    if (found === undefined) throw new Error(`no task ${id}`);
    return found;
  };
  const routes: Record<string, unknown> = {};
  for (const t of tasks) {
    routes[`/api/v1/tasks/${t.id}/status`] = (call: { body: unknown }) => {
      if (fail.status === true) {
        return refuse(422, 'invalid_transition', 'That move is not allowed.');
      }
      const target = find(t.id);
      target.status = (call.body as { status: string }).status;
      return { ...target };
    };
    routes[`/api/v1/tasks/${t.id}/reorder`] = (call: { body: unknown }) => {
      const body = call.body as { after_task_id?: string; before_task_id?: string };
      const moved = find(t.id);
      const lo = body.after_task_id === undefined ? 0 : Number(find(body.after_task_id).position);
      const hi =
        body.before_task_id === undefined ? lo + 2 : Number(find(body.before_task_id).position);
      moved.position = key((lo + hi) / 2);
      return { ...moved };
    };
  }
  return {
    tasks,
    stub: {
      '/api/v1/me': {
        id: 'u1',
        email: 'a@example.com',
        name: 'Ada Lovelace',
        org_role: 'owner',
        is_active: true,
        memberships: [{ project_id: 'p1', role: 'lead' }],
      },
      '/api/v1/projects': { data: [PROJECT], next_cursor: null },
      '/api/v1/projects/laika-core': PROJECT,
      '/api/v1/projects/laika-core/board-columns': { columns: COLUMNS },
      '/api/v1/projects/laika-core/tasks': () => ({
        data: tasks.map((t) => ({ ...t })),
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

interface Recorded {
  readonly before: string[];
  readonly after: string[] | null;
  readonly running: string | null;
  readonly durations: number[];
  readonly done: boolean;
  readonly readyAt: number | null;
  readonly doneAt: number | null;
  readonly skipped: boolean;
}

type ProbeWindow = Window & { __vt?: Recorded[] };

/** Wrap `startViewTransition` before the app loads; see the file comment. */
async function motionProbe(page: Page): Promise<void> {
  await page.addInitScript({
    content: `
      (() => {
        window.__vt = [];
        const real = Document.prototype.startViewTransition;
        if (typeof real !== 'function') return;
        const names = () =>
          [...document.querySelectorAll('.lane-item[data-task-id]')]
            .filter((el) => el.style.getPropertyValue('view-transition-name') !== '')
            .map((el) => el.dataset.taskId);
        Document.prototype.startViewTransition = function (update) {
          const rec = { before: names(), after: null, running: null, durations: [], done: false, readyAt: null, doneAt: null, skipped: false };
          window.__vt.push(rec);
          const t = real.call(this, () => {
            update();
            rec.after = names();
          });
          // A task later: the app's own \`ready\` handler — registered after this
          // one — is what says "running", and it has to have run first.
          t.ready.then(() => new Promise((done) => setTimeout(done, 0))).then(
            () => {
              rec.readyAt = performance.now();
              rec.running = document.documentElement.dataset.boardMotion ?? null;
              rec.durations = document
                .getAnimations()
                .filter((a) => String(a.effect && a.effect.pseudoElement).startsWith('::view-transition-group'))
                .map((a) => Number(a.effect.getComputedTiming().duration));
            },
            () => {
              rec.skipped = true;
            },
          );
          t.finished.then(
            () => {
              rec.done = true;
              rec.doneAt = performance.now();
            },
            () => {
              rec.done = true;
              rec.doneAt = performance.now();
            },
          );
          return t;
        };
      })();
    `,
  });
}

async function withProbe(page: Page): Promise<void> {
  await motionProbe(page);
  await fakeStream(page);
}

const transitions = (h: Harness): Promise<Recorded[]> =>
  h.page.evaluate(() => (window as ProbeWindow).__vt ?? []);

async function ready(h: Harness): Promise<void> {
  await h.page.locator('article.card[data-task-id]').first().waitFor({ timeout: 15_000 });
  // Let the first load's renders finish before anything is counted.
  await h.page.waitForTimeout(300);
}

async function laneOf(h: Harness, id: string): Promise<string | null> {
  return h.page
    .locator(`article.card[data-task-id="${id}"]`)
    .evaluate((card) => card.closest('.lane')?.getAttribute('data-status') ?? null);
}

/** Wait for the `n`th transition to finish and its cleanup to run. */
async function finished(h: Harness, n: number): Promise<Recorded> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const all = await transitions(h);
    const rec = all[n - 1];
    if (rec?.done === true) {
      await h.page.waitForTimeout(50);
      return rec;
    }
    if (Date.now() > deadline) {
      assert.fail(`transition ${String(n)} never finished; saw ${JSON.stringify(all)}`);
    }
    await h.page.waitForTimeout(25);
  }
}

/** Wait until every recorded transition is over and no new one has begun. */
async function quiet(h: Harness): Promise<void> {
  let seen = -1;
  const deadline = Date.now() + 5000;
  for (;;) {
    const all = await transitions(h);
    if (all.length === seen && all.every((r) => r.done)) break;
    if (Date.now() > deadline) assert.fail(`transitions never settled: ${JSON.stringify(all)}`);
    seen = all.length;
    await h.page.waitForTimeout(300);
  }
  await h.page.waitForTimeout(50);
}

/** Anything the transition left behind once it was over. */
async function leftovers(h: Harness) {
  return h.page.evaluate(() => ({
    named: [...document.querySelectorAll<HTMLElement>('[data-task-id]')]
      .filter((el) => el.style.getPropertyValue('view-transition-name') !== '')
      .map((el) => el.dataset.taskId),
    rootClass: document.documentElement.classList.contains('board-motion'),
    rootState: document.documentElement.dataset.boardMotion ?? null,
  }));
}

/** A live frame from the stream, as the server sends one. */
async function frame(
  h: Harness,
  taskId: string,
  seq: number,
  actor: { id: string; kind: string },
): Promise<void> {
  await h.page.evaluate(
    ([id, n, actorId, actorKind]) => {
      (
        window as unknown as {
          __laikaStream: { emit: (type: string, data: unknown, id: string) => void };
        }
      ).__laikaStream.emit(
        'task.status_changed',
        {
          id: `e${String(n)}`,
          seq: n,
          type: 'task.status_changed',
          project_id: 'p1',
          task_id: id,
          actor_id: actorId,
          actor_kind: actorKind,
          actor_token_id: null,
          payload: {},
          created_at: Date.now(),
        },
        String(n),
      );
    },
    [taskId, seq, actor.id, actor.kind] as const,
  );
}

/** Wait until the board draws `id` in lane `status`. */
async function landsIn(h: Harness, id: string, status: string): Promise<void> {
  await h.page
    .locator(`.lane[data-status="${status}"] article.card[data-task-id="${id}"]`)
    .waitFor({ timeout: 5000 });
}

void after(async () => {
  await closeBrowser();
});

void describe('cards glide between lanes (LAI-708)', () => {
  void test('the instrument sees a transition in this browser', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: withProbe });
    try {
      await ready(h);
      const supported = await h.page.evaluate(
        () => typeof document.startViewTransition === 'function',
      );
      assert.equal(supported, true, 'this Chromium has no View Transitions — every test is blind');
      const before = (await transitions(h)).length;
      await h.page.evaluate(async () => {
        await document.startViewTransition(() => undefined).finished;
      });
      assert.equal((await transitions(h)).length, before + 1, 'the probe recorded nothing');
    } finally {
      await h.close();
    }
  });

  void test('a keyboard move into the next lane glides the card itself, for 200ms, and cleans up', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: withProbe });
    try {
      await ready(h);
      assert.equal(await laneOf(h, 't1'), 'todo', 'positive control');
      const start = (await transitions(h)).length;

      await h.page.locator('article.card[data-task-id="t1"] .card-open').focus();
      await h.page.keyboard.press('Alt+ArrowRight');
      const rec = await finished(h, start + 1);
      await landsIn(h, 't1', 'in_progress');
      await quiet(h);
      // The server answers within milliseconds; the glide must still run its course.
      assert.ok(
        rec.readyAt !== null && rec.doneAt !== null && rec.doneAt - rec.readyAt >= 150,
        `the glide was cut short: ${JSON.stringify(rec)}`,
      );
      const later = (await transitions(h)).slice(start + 1);
      assert.ok(
        later.every((r) => r.skipped),
        `the server's agreement drew a second glide: ${JSON.stringify(later)}`,
      );

      assert.ok(rec.before.includes('t1'), `the moving card was not named: ${JSON.stringify(rec)}`);
      assert.ok(rec.after?.includes('t1') === true, 'the card was not named in its new lane');
      assert.equal(rec.running, 'running', 'the root never said the transition was running');
      assert.ok(rec.durations.length > 0, 'no card animated');
      assert.ok(
        rec.durations.every((d) => d === 200),
        `durations ${JSON.stringify(rec.durations)}`,
      );
      assert.deepEqual(await leftovers(h), { named: [], rootClass: false, rootState: null });

      // The keyboard stays on the card that moved, so the next press moves it again.
      const focused = await h.page.evaluate(
        () =>
          document.activeElement?.closest('[data-task-id]')?.getAttribute('data-task-id') ?? null,
      );
      assert.equal(focused, 't1', 'the move took the keyboard off the card');
    } finally {
      await h.close();
    }
  });

  void test('a move the server refuses glides out, then glides back', async () => {
    const w = world({ status: true });
    const h = await open('/board?project=laika-core', w.stub, { before: withProbe });
    try {
      await ready(h);
      const start = (await transitions(h)).length;
      await h.page.locator('article.card[data-task-id="t1"] .card-open').focus();
      await h.page.keyboard.press('Alt+ArrowRight');
      await finished(h, start + 2);
      await quiet(h);
      assert.equal(await laneOf(h, 't1'), 'todo', 'the refused card did not come back');
      const [out, back] = (await transitions(h)).slice(start);
      assert.ok(
        out?.after?.includes('t1') === true,
        `it did not glide out: ${JSON.stringify(out)}`,
      );
      assert.ok(
        back !== undefined && back.after?.includes('t1') === true && !back.skipped,
        `it did not glide back: ${JSON.stringify(back)}`,
      );
    } finally {
      await h.close();
    }
  });

  void test('a change from somewhere else glides in, and glows', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: withProbe });
    try {
      await ready(h);
      const start = (await transitions(h)).length;

      // An agent moves LAI-2 over MCP: the server changes, then the stream says so.
      w.tasks.find((t) => t.id === 't2')!.status = 'in_progress';
      await frame(h, 't2', 1, { id: 'u2', kind: 'agent' });
      const rec = await finished(h, start + 1);
      await landsIn(h, 't2', 'in_progress');

      assert.ok(
        rec.before.includes('t2') && rec.after?.includes('t2') === true,
        JSON.stringify(rec),
      );
      const flash = await h.page.locator('article.card[data-task-id="t2"]').evaluate((el) => ({
        on: el.hasAttribute('data-flash'),
        animation: getComputedStyle(el).animationName,
      }));
      assert.deepEqual(flash, { on: true, animation: 'card-flash' }, 'the change did not glow');
      const others = await h.page.locator('article.card[data-flash]').count();
      assert.equal(others, 1, 'a card nobody changed glowed');
    } finally {
      await h.close();
    }
  });

  void test('my own change, echoed by the stream, does not glow', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: withProbe });
    try {
      await ready(h);
      w.tasks.find((t) => t.id === 't2')!.status = 'in_progress';
      // Positive control in the same page: the frame is mine, as myself.
      await frame(h, 't2', 1, { id: 'u1', kind: 'user' });
      await landsIn(h, 't2', 'in_progress');
      await h.page.waitForTimeout(300);
      assert.equal(await h.page.locator('[data-flash]').count(), 0, 'my own echo glowed');
    } finally {
      await h.close();
    }
  });

  void test('with reduced motion nothing animates, the change lands, and the glow is a still ring', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, {
      before: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await withProbe(page);
      },
    });
    try {
      await ready(h);
      const start = (await transitions(h)).length;
      w.tasks.find((t) => t.id === 't2')!.status = 'in_progress';
      await frame(h, 't2', 1, { id: 'u2', kind: 'agent' });
      await landsIn(h, 't2', 'in_progress');
      await h.page.waitForTimeout(300);

      assert.equal((await transitions(h)).length, start, 'a transition ran under reduced motion');
      const flash = await h.page.locator('article.card[data-task-id="t2"]').evaluate((el) => ({
        on: el.hasAttribute('data-flash'),
        timing: getComputedStyle(el).animationTimingFunction,
      }));
      assert.equal(flash.on, true, 'reduced motion dropped the information, not just the motion');
      assert.match(flash.timing, /^steps\(1(, end)?\)$/, `the ring fades: ${flash.timing}`);
    } finally {
      await h.close();
    }
  });

  void test('with the task drawer open a change lands without motion', async () => {
    const w = world();
    const h = await open('/board?project=laika-core&task=t5', w.stub, { before: withProbe });
    try {
      await ready(h);
      await h.page.locator('[role="dialog"]').first().waitFor({ timeout: 5000 });
      const start = (await transitions(h)).length;
      w.tasks.find((t) => t.id === 't2')!.status = 'in_progress';
      await frame(h, 't2', 1, { id: 'u2', kind: 'agent' });
      await landsIn(h, 't2', 'in_progress');
      await h.page.waitForTimeout(300);
      assert.equal((await transitions(h)).length, start, 'cards flew across the open drawer');
    } finally {
      await h.close();
    }
  });

  void test('a click during the glide lands on the board, not on the picture of it', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: withProbe });
    try {
      await ready(h);
      // Slow the glide so the click is certainly inside it.
      await h.page.addStyleTag({
        content:
          ':root.board-motion::view-transition-group(*),:root.board-motion::view-transition-old(*),:root.board-motion::view-transition-new(*){animation-duration:3s!important}',
      });
      const start = (await transitions(h)).length;
      w.tasks.find((t) => t.id === 't2')!.status = 'in_progress';
      await frame(h, 't2', 1, { id: 'u2', kind: 'agent' });
      await h.page.waitForFunction(
        (n) => ((window as ProbeWindow).__vt ?? [])[n]?.running === 'running',
        start,
        { timeout: 5000 },
      );
      // LAI-1 does not move — LAI-2 leaves from below it — so it is the live card.
      const rec = (await transitions(h))[start];
      assert.ok(rec?.after?.includes('t2') === true, `LAI-2 did not glide: ${JSON.stringify(rec)}`);
      assert.ok(rec.after.includes('t1') === false, 'a card that did not move was named');
      await h.page.locator('article.card[data-task-id="t1"] .card-open').click({ timeout: 2000 });
      await h.page.waitForURL(/task=t1/, { timeout: 2000 });
    } finally {
      await h.close();
    }
  });

  void test('a card dropped by hand does not fly back; its neighbours make room', async () => {
    const w = world();
    const h = await open('/board?project=laika-core', w.stub, { before: withProbe });
    try {
      await ready(h);
      const start = (await transitions(h)).length;
      const card = (id: string) => h.page.locator(`article.card[data-task-id="${id}"]`);
      const source = await card('t3').boundingBox();
      const target = await card('t2').boundingBox();
      assert.ok(source !== null && target !== null, 'no boxes');
      await h.page.mouse.move(source.x + source.width / 2, source.y + 12);
      await h.page.mouse.down();
      await h.page.mouse.move(source.x + source.width / 2 + 4, source.y + 18, { steps: 4 });
      await h.page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.25, {
        steps: 12,
      });
      await h.page.mouse.up();
      const rec = await finished(h, start + 1);

      assert.ok(rec.before.includes('t3') === false, 'the dropped card was named — it would fly');
      assert.ok(
        rec.after?.includes('t2') === true,
        `LAI-2 did not make room: ${JSON.stringify(rec)}`,
      );
      await quiet(h);
    } finally {
      await h.close();
    }
  });

  void test('the List never transitions, and someone else’s change glows on its row', async () => {
    const w = world();
    const h = await open('/list?project=laika-core', w.stub, { before: withProbe });
    try {
      await h.page.locator('tr.list-row[data-task-id]').first().waitFor({ timeout: 15_000 });
      await h.page.waitForTimeout(300);
      const start = (await transitions(h)).length;
      w.tasks.find((t) => t.id === 't2')!.title = 'Task 2, renamed by an agent';
      await frame(h, 't2', 1, { id: 'u2', kind: 'agent' });
      await h.page.locator('tr.list-row[data-task-id="t2"][data-flash]').waitFor({ timeout: 5000 });
      assert.equal((await transitions(h)).length, start, 'the List ran a view transition');
    } finally {
      await h.close();
    }
  });
});
