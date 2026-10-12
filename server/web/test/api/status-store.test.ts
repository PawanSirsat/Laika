import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStatusStore } from '../../src/api/status-store.ts';
import type { ProjectStatus } from '../../src/api/statuses.ts';

/**
 * The project's statuses, held once for every screen (LAI-739).
 *
 * Framework-free and clock-injected, like `task-store.ts`, so the three things
 * that would go wrong silently are asserted here rather than in a browser: a
 * load nobody asked for, a burst of frames becoming a burst of requests, and a
 * slow answer overwriting a change the reader has already made.
 */

function status(over: Partial<ProjectStatus> & { id: string; position: number }): ProjectStatus {
  return {
    project_id: 'p',
    name: over.id,
    category: 'todo',
    hidden: false,
    created_at: 1,
    task_count: 0,
    ...over,
  };
}

function fakeTime() {
  let seq = 0;
  const timers = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void): unknown => {
      seq += 1;
      timers.set(seq, fn);
      return seq;
    },
    clearTimer: (handle: unknown): void => {
      timers.delete(handle as number);
    },
    flush: (): void => {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
    },
    pending: (): number => timers.size,
  };
}

/** A fetch the test answers by hand, in any order. */
function manualFetch() {
  const calls: {
    slug: string;
    resolve: (s: readonly ProjectStatus[]) => void;
    reject: (e: unknown) => void;
  }[] = [];
  return {
    calls,
    fetch: (slug: string): Promise<readonly ProjectStatus[]> =>
      new Promise((resolve, reject) => {
        calls.push({ slug, resolve, reject });
      }),
  };
}

const tick = () => new Promise((done) => setImmediate(done));

void describe('loading', () => {
  void test('nothing is fetched until a screen subscribes, and then once', async () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });

    assert.equal(store.peek('lc'), undefined);
    assert.equal(io.calls.length, 0);

    const stopA = store.subscribe('lc', () => undefined);
    const stopB = store.subscribe('lc', () => undefined);
    assert.equal(io.calls.length, 1, 'two screens asking at once is one request');
    assert.equal(store.peek('lc')?.status, 'loading');

    io.calls[0]?.resolve([status({ id: 'b', position: 1 }), status({ id: 'a', position: 0 })]);
    await tick();

    const snap = store.peek('lc');
    assert.equal(snap?.status, 'ready');
    assert.deepEqual(
      snap?.statuses.map((s) => s.id),
      ['a', 'b'],
      'held in position order, whatever order they arrived in',
    );
    stopA();
    stopB();
  });

  void test('a failed first load is an error the screen can show', async () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.subscribe('lc', () => undefined);
    io.calls[0]?.reject(new Error('boom'));
    await tick();
    assert.equal(store.peek('lc')?.status, 'error');
    assert.equal((store.peek('lc')?.error as Error).message, 'boom');
  });

  void test('a failed refresh keeps the statuses already held', async () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.subscribe('lc', () => undefined);
    io.calls[0]?.resolve([status({ id: 'a', position: 0 })]);
    await tick();

    store.reload('lc');
    io.calls[1]?.reject(new Error('offline'));
    await tick();

    assert.equal(store.peek('lc')?.status, 'ready');
    assert.deepEqual(
      store.peek('lc')?.statuses.map((s) => s.id),
      ['a'],
    );
  });
});

void describe('live frames', () => {
  void test('a burst of frames is one debounced re-read', async () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.subscribe('lc', () => undefined);
    io.calls[0]?.resolve([status({ id: 'a', position: 0 })]);
    await tick();

    store.frame('lc');
    store.frame('lc');
    store.frame('lc');
    assert.equal(io.calls.length, 1, 'nothing until the debounce fires');
    time.flush();
    assert.equal(io.calls.length, 2, 'three frames, one request');

    io.calls[1]?.resolve([status({ id: 'a', position: 0, name: 'Renamed elsewhere' })]);
    await tick();
    assert.equal(store.peek('lc')?.statuses[0]?.name, 'Renamed elsewhere');
  });

  void test('coming back to a project re-reads what changed while nobody was looking (B1)', async () => {
    // The stream closes when the reader leaves: the frame for that is the
    // only news, and nothing reads then. The next visit must.
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    const stop = store.subscribe('lc', () => undefined);
    io.calls[0]?.resolve([status({ id: 'a', position: 0, name: 'Before' })]);
    await tick();
    stop();

    store.frame('lc');
    time.flush();
    assert.equal(io.calls.length, 1, 'read for a project nobody is looking at');

    store.subscribe('lc', () => undefined);
    assert.equal(io.calls.length, 2, 'returning showed the old columns without a re-read');
    io.calls[1]?.resolve([status({ id: 'a', position: 0, name: 'After' })]);
    await tick();
    assert.equal(store.peek('lc')?.statuses[0]?.name, 'After');

    // And a return with no news in between reads nothing more.
    const again = store.subscribe('lc', () => undefined);
    again();
    assert.equal(io.calls.length, 2);
  });

  void test('a frame about a project nobody is looking at fetches nothing', () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.frame('other');
    time.flush();
    assert.equal(io.calls.length, 0);
    assert.equal(time.pending(), 0);
  });
});

void describe('local writes', () => {
  void test('a write is seen at once, and a read begun before it cannot undo it', async () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    let heard = 0;
    store.subscribe('lc', () => {
      heard += 1;
    });
    io.calls[0]?.resolve([status({ id: 'a', position: 0 }), status({ id: 'b', position: 1 })]);
    await tick();

    store.reload('lc');
    const before = heard;
    store.write('lc', (list) =>
      list.map((s) => (s.id === 'a' ? { ...s, position: 1 } : { ...s, position: 0 })),
    );
    assert.ok(heard > before, 'subscribers hear a local write');
    assert.deepEqual(
      store.peek('lc')?.statuses.map((s) => s.id),
      ['b', 'a'],
    );

    // The read that was in flight answers with the old order — it must not win.
    io.calls[1]?.resolve([status({ id: 'a', position: 0 }), status({ id: 'b', position: 1 })]);
    await tick();
    assert.deepEqual(
      store.peek('lc')?.statuses.map((s) => s.id),
      ['b', 'a'],
      'a stale answer overwrote a local write',
    );
  });

  void test('a read that starts while a write is in flight cannot undo it either', async () => {
    // A live frame lands mid-request: its read begins *after* the optimistic
    // write and answers with the list from before the server applied it.
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.subscribe('lc', () => undefined);
    io.calls[0]?.resolve([status({ id: 'a', position: 0 }), status({ id: 'b', position: 1 })]);
    await tick();

    const end = store.begin('lc');
    store.write('lc', (list) =>
      list.map((s) => (s.id === 'a' ? { ...s, position: 1 } : { ...s, position: 0 })),
    );
    store.reload('lc');
    io.calls[1]?.resolve([status({ id: 'a', position: 0 }), status({ id: 'b', position: 1 })]);
    await tick();
    assert.deepEqual(
      store.peek('lc')?.statuses.map((s) => s.id),
      ['b', 'a'],
      'a read begun mid-write overwrote it',
    );

    // The write lands; the read that was held back is asked again, now.
    end();
    assert.equal(io.calls.length, 3, 'the held-back read was never repeated');
    io.calls[2]?.resolve([status({ id: 'b', position: 0 }), status({ id: 'a', position: 1 })]);
    await tick();
    assert.deepEqual(
      store.peek('lc')?.statuses.map((s) => s.id),
      ['b', 'a'],
    );
  });

  void test('a read begun before a write that is still in flight is owed, not lost', async () => {
    // Review round 1, M6: the read may carry someone else's change (a frame),
    // so dropping it must leave a re-read owed for when the write ends.
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.subscribe('lc', () => undefined);
    io.calls[0]?.resolve([status({ id: 'a', position: 0 })]);
    await tick();

    store.reload('lc');
    const end = store.begin('lc');
    store.write('lc', (list) => list.map((s) => ({ ...s, name: 'Mine' })));
    io.calls[1]?.resolve([status({ id: 'a', position: 0, name: 'Old' })]);
    await tick();
    assert.equal(store.peek('lc')?.statuses[0]?.name, 'Mine');

    end();
    assert.equal(io.calls.length, 3, 'the dropped read was not owed');
    io.calls[2]?.resolve([status({ id: 'a', position: 0, name: 'Mine' })]);
    await tick();
    assert.equal(store.peek('lc')?.statuses[0]?.name, 'Mine');
  });

  void test('a failed write still releases the hold (review round 1, M6)', async () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.subscribe('lc', () => undefined);
    io.calls[0]?.resolve([status({ id: 'a', position: 0 })]);
    await tick();

    await assert.rejects(
      store.transaction(
        'lc',
        (list) => list.map((s) => ({ ...s, name: 'Guess' })),
        () => Promise.reject(new Error('refused')),
      ),
      /refused/,
    );
    // Nothing is held now: a read is applied, not owed.
    store.reload('lc');
    const last = io.calls.length - 1;
    io.calls[last]?.resolve([status({ id: 'a', position: 0, name: 'Server' })]);
    await tick();
    assert.equal(store.peek('lc')?.statuses[0]?.name, 'Server', 'the hold outlived the write');
  });

  void test('reset forgets everything', async () => {
    const time = fakeTime();
    const io = manualFetch();
    const store = createStatusStore({ fetch: io.fetch, ...time });
    store.subscribe('lc', () => undefined);
    io.calls[0]?.resolve([status({ id: 'a', position: 0 })]);
    await tick();
    store.reset();
    assert.equal(store.peek('lc'), undefined);
  });
});
