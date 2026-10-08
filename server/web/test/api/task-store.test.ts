/**
 * The project's task set, one copy for every screen (LAI-724, D-075).
 *
 * Measured before this: the List walked the whole task list twice (the board
 * and the sprint strip), every tab switch re-walked it, and one live frame
 * re-walked both of the board's lists (~1.5 MB). The store walks once per
 * project, keeps the answer across tab switches, and turns a burst of frames
 * into one re-walk. It also carries LAI-707's merge, so a refresh keeps the
 * objects of unchanged tasks and reports what changed for LAI-708's glow.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createTaskStore,
  type TaskSetChange,
  type TaskSetSnapshot,
  type TaskStore,
} from '../../src/api/task-store.ts';
import { ApiError } from '../../src/api/errors.ts';
import type { Page, Task } from '../../src/api/tasks.ts';

function task(over: Partial<Task> & { id: string }): Task {
  return {
    key: `LC-${over.id}`,
    project_id: 'p',
    number: 1,
    title: 'A task',
    description_md: null,
    acceptance_md: null,
    status: 'todo',
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
    branch: null,
    external_ref: null,
    ready: true,
    stale_flagged_at: null,
    position: null,
    comment_count: 0,
    tags: [],
    blocked_by: [],
    blocks: [],
    started_at: null,
    completed_at: null,
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

function fakeTime() {
  let now = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number): unknown => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    advance(ms: number): void {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

interface PageCall {
  readonly slug: string;
  readonly cursor: string | undefined;
  readonly signal: AbortSignal;
  resolve(page: Page<Task>): void;
  reject(cause: unknown): void;
}

/** A server the test answers by hand, page by page. */
function server() {
  const calls: PageCall[] = [];
  const fetchPage = (slug: string, cursor: string | undefined, signal: AbortSignal) =>
    new Promise<Page<Task>>((resolve, reject) => {
      calls.push({ slug, cursor, signal, resolve, reject });
      signal.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  return { calls, fetchPage };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setImmediate(done));
};

function setup(cap = 25) {
  const time = fakeTime();
  const api = server();
  const store = createTaskStore({
    fetchPage: api.fetchPage,
    ...time,
    pageCap: cap,
    liveDebounceMs: 300,
    maxAgeMs: 30_000,
    abortGraceMs: 1_000,
  });
  return { store, time, api };
}

/** Subscribe and record every snapshot and change the listener is handed. */
function watch(store: TaskStore, slug: string) {
  const seen: { snap: TaskSetSnapshot; change: TaskSetChange }[] = [];
  const stop = store.subscribe(slug, (snap, change) => {
    seen.push({ snap, change });
  });
  return { seen, stop, last: () => seen[seen.length - 1] };
}

/** Answer the newest outstanding page call. */
async function answer(api: ReturnType<typeof server>, data: Task[], next: string | null = null) {
  const call = api.calls[api.calls.length - 1]!;
  call.resolve({ data, next_cursor: next });
  await flush();
}

const A = task({ id: 'a' });
const B = task({ id: 'b' });

void describe('one walk per project', () => {
  void test('two screens subscribing is one walk, and both see the same set', async () => {
    const { store, api } = setup();
    const board = watch(store, 'core');
    const strip = watch(store, 'core');
    assert.equal(api.calls.length, 1, 'a second subscriber started its own walk');
    await answer(api, [A, B]);
    assert.equal(board.last()?.snap.tasks.length, 2);
    assert.equal(strip.last()?.snap.tasks, board.last()?.snap.tasks, 'two copies of the set');
    board.stop();
    strip.stop();
  });

  void test('follows the cursor to the end, and says so when it hits the cap', async () => {
    const { store, api } = setup(2);
    const w = watch(store, 'core');
    await answer(api, [A], 'P2');
    assert.equal(api.calls[1]?.cursor, 'P2');
    await answer(api, [B], 'P3');
    assert.equal(api.calls.length, 2, 'read past the cap');
    assert.equal(w.last()?.snap.truncated, true, 'a truncated set must say so');
    assert.equal(w.last()?.snap.tasks.length, 2);
    w.stop();
  });

  void test('every child is kept in byId, not just top-level tasks', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    const child = task({ id: 'c', parent_task_id: 'a' });
    await answer(api, [A, child]);
    assert.equal(w.last()?.snap.byId.get('c'), child);
    w.stop();
  });

  void test('switching project evicts the other set (bounded memory)', async () => {
    const { store, api } = setup();
    const core = watch(store, 'core');
    await answer(api, [A]);
    core.stop();
    const web = watch(store, 'web');
    assert.equal(store.peek('core'), undefined, 'the previous project is still held');
    await answer(api, [B]);
    assert.equal(store.peek('web')?.tasks.length, 1);
    web.stop();
  });
});

void describe('stale-while-revalidate across tab switches', () => {
  void test('a revisit inside 30s shows the set at once and fetches nothing', async () => {
    const { store, api, time } = setup();
    const first = watch(store, 'core');
    await answer(api, [A, B]);
    first.stop();

    time.advance(10_000);
    const again = watch(store, 'core');
    assert.equal(store.peek('core')?.status, 'ready', 'a revisit is not a first load');
    assert.equal(store.peek('core')?.tasks.length, 2);
    assert.equal(api.calls.length, 1, 'a fresh set was walked again');
    again.stop();
  });

  void test('a revisit after 30s shows the set at once and revalidates once, in the background', async () => {
    const { store, api, time } = setup();
    const first = watch(store, 'core');
    await answer(api, [A, B]);
    first.stop();

    time.advance(31_000);
    const again = watch(store, 'core');
    assert.equal(store.peek('core')?.status, 'ready');
    assert.equal(store.peek('core')?.refreshing, true);
    assert.equal(api.calls.length, 2, 'not revalidated');
    watch(store, 'core').stop(); // a second screen mounting does not walk again
    assert.equal(api.calls.length, 2);
    await answer(api, [A, B]);
    assert.equal(store.peek('core')?.refreshing, false);
    again.stop();
  });

  void test('a live frame while nobody is looking marks the set stale; the next visit revalidates', async () => {
    const { store, api, time } = setup();
    const first = watch(store, 'core');
    await answer(api, [A]);
    first.stop();

    store.frame('core', 'activity');
    time.advance(1_000);
    assert.equal(api.calls.length, 1, 'walked for a screen nobody has open');

    const again = watch(store, 'core');
    assert.equal(api.calls.length, 2, 'a set known to be stale was served as current');
    again.stop();
  });

  void test('the stream closing marks the set stale (frames may be missed)', async () => {
    const { store, api } = setup();
    const first = watch(store, 'core');
    await answer(api, [A]);
    first.stop();
    store.frame('core', 'closed');
    const again = watch(store, 'core');
    assert.equal(api.calls.length, 2);
    again.stop();
  });
});

void describe('live frames: one re-walk per burst', () => {
  void test('a burst of frames is one walk, after the debounce', async () => {
    const { store, api, time } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);

    for (let i = 0; i < 5; i += 1) {
      store.frame('core', 'activity');
      time.advance(100);
    }
    assert.equal(api.calls.length, 1, 'walked inside the burst');
    time.advance(300);
    assert.equal(api.calls.length, 2, 'exactly one walk for the burst');
    await answer(api, [A]);
    time.advance(5_000);
    assert.equal(api.calls.length, 2);
    w.stop();
  });

  void test('a frame during a walk queues one more walk, and never aborts the one running', async () => {
    const { store, api, time } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);
    store.frame('core', 'activity');
    time.advance(300);
    assert.equal(api.calls.length, 2);
    const running = api.calls[1]!;

    store.frame('core', 'activity');
    store.frame('core', 'activity');
    time.advance(300);
    assert.equal(
      running.signal.aborted,
      false,
      'a live frame aborted the walk (LAI-723’s stuck-stale)',
    );
    assert.equal(api.calls.length, 2, 'two walks at once');

    await answer(api, [A, B]);
    assert.equal(w.last()?.snap.tasks.length, 2, 'the running walk’s answer was not applied');
    assert.equal(api.calls.length, 3, 'the frame during the walk was lost');
    await answer(api, [A, B]);
    time.advance(5_000);
    assert.equal(api.calls.length, 3, 'more than one extra walk');
    w.stop();
  });

  void test('a gap reloads at once, without waiting for the debounce', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);
    store.frame('core', 'gap');
    assert.equal(api.calls.length, 2);
    w.stop();
  });
});

void describe('abort only when no subscriber remains', () => {
  void test('one screen leaving does not abort the walk another still shows', async () => {
    const { store, api, time } = setup();
    const a = watch(store, 'core');
    const b = watch(store, 'core');
    a.stop();
    time.advance(5_000);
    assert.equal(api.calls[0]!.signal.aborted, false);
    await answer(api, [A]);
    assert.equal(b.last()?.snap.status, 'ready');
    b.stop();
  });

  void test('the walk is aborted once every screen has left, after the grace', () => {
    const { store, api, time } = setup();
    const a = watch(store, 'core');
    a.stop();
    assert.equal(api.calls[0]!.signal.aborted, false, 'aborted inside the grace');
    time.advance(1_000);
    assert.equal(api.calls[0]!.signal.aborted, true);
  });

  void test('a tab switch inside the grace keeps the walk (no second request)', async () => {
    const { store, api, time } = setup();
    const list = watch(store, 'core');
    list.stop();
    const timeline = watch(store, 'core');
    time.advance(5_000);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0]!.signal.aborted, false);
    await answer(api, [A]);
    assert.equal(timeline.last()?.snap.status, 'ready');
    timeline.stop();
  });
});

void describe('LAI-707 in-place refresh, now in the store', () => {
  void test('a refresh keeps unchanged objects and reports exactly what changed', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    await answer(api, [A, B]);
    store.reload('core');
    const moved = { ...B, status: 'done' as const, updated_at: 2 };
    await answer(api, [A, moved]);
    const { snap, change } = w.last()!;
    assert.equal(change.origin, 'refresh');
    assert.deepEqual([...(change.changed ?? [])], ['b']);
    assert.equal(snap.byId.get('a'), A, 'an unchanged task lost its object');
    assert.equal(snap.byId.get('b'), moved);
    w.stop();
  });

  void test('a task with a write in flight keeps its local version', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);
    store.beginWrite('core', 'a');
    const local = { ...A, status: 'review' as const };
    store.writeLocal('core', (tasks) => tasks.map((t) => (t.id === 'a' ? local : t)), {
      changed: new Set(['a']),
    });
    store.reload('core');
    await answer(api, [A]);
    assert.equal(w.last()?.snap.byId.get('a'), local, 'the refresh pulled back a pending write');
    store.endWrite('core', 'a');
    w.stop();
  });

  void test('a write landing after the read began keeps the local version', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);
    store.reload('core');
    const written = { ...A, title: 'Renamed', updated_at: 5 };
    store.writeLocal('core', (tasks) => tasks.map((t) => (t.id === 'a' ? written : t)), {
      changed: new Set(['a']),
      record: 'a',
    });
    await answer(api, [A]); // the read began before the write
    assert.equal(w.last()?.snap.byId.get('a'), written);
    w.stop();
  });

  void test('a hold defers the refresh answer until it is released', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);
    const release = store.hold('core');
    store.reload('core');
    await answer(api, [A, B]);
    assert.equal(w.last()?.snap.tasks.length, 1, 'applied during a drag');
    release();
    assert.equal(w.last()?.snap.tasks.length, 2);
    w.stop();
  });

  void test('a failed refresh keeps the set and says so; lost access replaces it', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);
    store.reload('core');
    api.calls[1]!.reject(new Error('offline'));
    await flush();
    assert.equal(w.last()?.snap.status, 'ready');
    assert.ok(w.last()?.snap.refreshError instanceof Error);
    assert.equal(w.last()?.snap.tasks.length, 1);

    store.reload('core');
    api.calls[2]!.reject(new ApiError('forbidden', 'no', 403));
    await flush();
    assert.equal(w.last()?.snap.status, 'error');
    assert.equal(w.last()?.snap.tasks.length, 0, 'a board the reader lost access to stayed up');
    w.stop();
  });
});

void describe('a change of user clears the set (no cross-user data)', () => {
  void test('reset drops every set, aborts the walk, and never applies its late answer', async () => {
    const { store, api } = setup();
    const w = watch(store, 'core');
    await answer(api, [A]);
    store.reload('core');
    const old = api.calls[1]!;
    store.reset();
    assert.equal(old.signal.aborted, true, 'the old user’s walk kept running');
    assert.equal(store.peek('core'), undefined, 'the old user’s tasks survived');
    old.resolve({ data: [A, B], next_cursor: null });
    await flush();
    assert.equal(store.peek('core'), undefined, 'a late answer for the old user was stored');
    w.stop();
  });
});
