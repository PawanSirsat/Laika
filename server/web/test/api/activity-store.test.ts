/**
 * The Dashboard's activity window (LAI-723, inside LAI-724).
 *
 * Since LAI-722 fixed the cursor, `useDashboard` walked the whole range — up to
 * 20 pages of 200 on "All time" — **on every live frame**, and each frame
 * cancelled the walk before, so under frequent frames the numbers could stay
 * stale for ever. Activity is append-only, so a window that is complete from
 * some point on stays complete if only the newer events are added: a live frame
 * now costs one small request, and nothing cancels a walk.
 *
 * The fake server below answers with the real endpoint's rules — newest first,
 * `since` inclusive, a cursor strictly before the last row, at most `limit` — so
 * the counts can be compared against what a full walk would have read.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createActivityStore,
  type ActivityWindow,
  type ActivityStore,
} from '../../src/api/activity-store.ts';
import type { ActivityEvent } from '../../src/api/activity.ts';
import type { Page } from '../../src/api/tasks.ts';

const LIMIT = 200;

function event(seq: number, createdAt: number, actor: 'user' | 'agent' = 'user'): ActivityEvent {
  return {
    id: `e${String(seq)}`,
    seq,
    type: 'task.updated',
    project_id: 'p',
    task_id: 't',
    actor_id: 'u',
    actor_kind: actor,
    actor_token_id: null,
    payload: {},
    created_at: createdAt,
  };
}

/** The project feed, with its paging rules, over an array the test appends to. */
function feed() {
  const events: ActivityEvent[] = [];
  const asked: { since: number | undefined; cursor: string | undefined }[] = [];
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;

  const ordered = (): ActivityEvent[] =>
    [...events].sort((a, b) => b.created_at - a.created_at || b.seq - a.seq);

  const fetchPage = async (
    _slug: string,
    query: { since?: number | undefined; cursor?: string | undefined },
    signal: AbortSignal,
  ): Promise<Page<ActivityEvent>> => {
    asked.push({ since: query.since, cursor: query.cursor });
    if (gate !== undefined) await gate;
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    let rows = ordered().filter((e) => query.since === undefined || e.created_at >= query.since);
    if (query.cursor !== undefined) {
      const [at, seq] = query.cursor.split(':').map(Number) as [number, number];
      rows = rows.filter((e) => e.created_at < at || (e.created_at === at && e.seq < seq));
    }
    const page = rows.slice(0, LIMIT);
    const last = page[page.length - 1];
    return {
      data: page,
      next_cursor:
        rows.length > LIMIT && last !== undefined
          ? `${String(last.created_at)}:${String(last.seq)}`
          : null,
    };
  };

  return {
    events,
    asked,
    fetchPage,
    add(n: number, from: number): void {
      for (let i = 0; i < n; i += 1) events.push(event(events.length + 1, from + i));
    },
    /** Hold every answer until `release`. */
    pause(): void {
      gate = new Promise((done) => {
        open = done;
      });
    },
    release(): void {
      gate = undefined;
      open?.();
    },
  };
}

function fakeTime() {
  let now = 10_000_000;
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

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done));
};

function setup(cap = 20) {
  const time = fakeTime();
  const server = feed();
  const store = createActivityStore({
    fetchPage: server.fetchPage,
    ...time,
    pageCap: cap,
    liveDebounceMs: 500,
    maxAgeMs: 30_000,
    abortGraceMs: 1_000,
  });
  return { store, time, server };
}

function watch(store: ActivityStore, slug: string, since: number | undefined) {
  const seen: ActivityWindow[] = [];
  const stop = store.subscribe(slug, since, (w) => {
    seen.push(w);
  });
  return { seen, stop, last: () => seen[seen.length - 1] };
}

/** What a full walk of the window reads — the count the screen must match. */
function truth(server: ReturnType<typeof feed>, since: number | undefined): string[] {
  return [...server.events]
    .filter((e) => since === undefined || e.created_at >= since)
    .sort((a, b) => b.created_at - a.created_at || b.seq - a.seq)
    .map((e) => e.id);
}

void describe('the first read is the whole window', () => {
  void test('more than 200 events in the window are all read, newest first', async () => {
    const { store, server } = setup();
    server.add(450, 1_000);
    const w = watch(store, 'core', undefined);
    await flush();
    assert.equal(w.last()?.status, 'ready');
    assert.deepEqual(
      w.last()?.events.map((e) => e.id),
      truth(server, undefined),
      'the window is not every event in it, in order (the LAI-722 case)',
    );
    assert.equal(server.asked.length, 3, '450 events are three pages of 200');
    w.stop();
  });
});

void describe('a live frame costs one small request (LAI-723)', () => {
  void test('only events newer than the newest held are asked for, and the counts stay exact', async () => {
    const { store, server, time } = setup();
    server.add(450, 1_000);
    const w = watch(store, 'core', 1_100);
    await flush();
    const before = server.asked.length;

    server.add(3, 2_000);
    store.frame('core', 'activity');
    time.advance(500);
    await flush();

    const after = server.asked.slice(before);
    assert.equal(after.length, 1, `a frame cost ${String(after.length)} requests, not one`);
    assert.equal(after[0]?.since, 1_449, 'asked for more than what is new');
    assert.deepEqual(
      w.last()?.events.map((e) => e.id),
      truth(server, 1_100),
      'the window after the catch-up is not what a full re-walk reads',
    );
    w.stop();
  });

  void test('a burst of frames is one catch-up', async () => {
    const { store, server, time } = setup();
    server.add(10, 1_000);
    const w = watch(store, 'core', undefined);
    await flush();
    const before = server.asked.length;
    for (let i = 0; i < 6; i += 1) {
      server.add(1, 3_000 + i);
      store.frame('core', 'activity');
      time.advance(100);
    }
    time.advance(500);
    await flush();
    assert.equal(server.asked.length - before, 1);
    assert.deepEqual(
      w.last()?.events.map((e) => e.id),
      truth(server, undefined),
    );
    w.stop();
  });

  void test('frames during a long "All time" walk never cancel it, and are caught up after', async () => {
    const { store, server, time } = setup();
    server.add(900, 1_000);
    server.pause();
    const w = watch(store, 'core', undefined);
    for (let i = 0; i < 10; i += 1) {
      server.add(1, 5_000 + i);
      store.frame('core', 'activity');
      time.advance(600); // every frame settles — the case that used to cancel the walk
    }
    server.release();
    await flush();
    time.advance(600);
    await flush();
    assert.equal(w.last()?.status, 'ready', 'frequent frames kept "All time" from ever finishing');
    assert.deepEqual(
      w.last()?.events.map((e) => e.id),
      truth(server, undefined),
    );
    w.stop();
  });
});

void describe('kept across tab switches', () => {
  void test('a revisit for the same or a narrower window reads nothing but what is new', async () => {
    const { store, server, time } = setup();
    server.add(300, 1_000);
    const first = watch(store, 'core', 1_000);
    await flush();
    first.stop();
    const before = server.asked.length;

    time.advance(10_000);
    const again = watch(store, 'core', 1_050); // the range re-anchored a moment later
    assert.equal(again.last()?.status, 'ready', 'a revisit is not a first load');
    assert.deepEqual(
      again.last()?.events.map((e) => e.id),
      truth(server, 1_050),
    );
    await flush();
    assert.equal(server.asked.length, before, 'a fresh window was read again');
    again.stop();
  });

  void test('a wider window walks again', async () => {
    const { store, server } = setup();
    server.add(300, 1_000);
    const narrow = watch(store, 'core', 1_200);
    await flush();
    narrow.stop();
    const wide = watch(store, 'core', undefined);
    await flush();
    assert.deepEqual(
      wide.last()?.events.map((e) => e.id),
      truth(server, undefined),
    );
    wide.stop();
  });

  void test('a window past the page cap says it is a floor', async () => {
    const { store, server } = setup(2);
    server.add(500, 1_000);
    const w = watch(store, 'core', undefined);
    await flush();
    assert.equal(w.last()?.truncated, true);
    assert.equal(w.last()?.events.length, 400);
    w.stop();
  });
});

void describe('a change of user clears it', () => {
  void test('reset drops the window and never applies a late answer', async () => {
    const { store, server } = setup();
    server.add(10, 1_000);
    server.pause();
    const w = watch(store, 'core', undefined);
    store.reset();
    server.release();
    await flush();
    assert.equal(store.peek('core', undefined), undefined, 'the old user’s events were stored');
    w.stop();
  });
});
