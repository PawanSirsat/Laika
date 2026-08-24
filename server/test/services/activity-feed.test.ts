import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendActivity, type ActivityEvent, latestActivitySeq } from '../../src/db/activity.ts';
import { ActivityFeed, type RepeatingTimer } from '../../src/services/activity-feed.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

let t: TestDb;
let s: Seed;

const noop = (): void => undefined;

/** Timers the test drives by hand, and can prove were cleared. */
function fakeTimers() {
  const state = { armed: 0, cleared: 0, fire: noop };

  return {
    state,
    setTimer: (fn: () => void): RepeatingTimer => {
      state.armed += 1;
      state.fire = fn;
      return {};
    },
    clearTimer: (): void => {
      state.cleared += 1;
    },
  };
}

function feedWith(timers: ReturnType<typeof fakeTimers>, batchSize = 200): ActivityFeed {
  return new ActivityFeed({
    db: t.db,
    batchSize,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
}

/** One more row in the log. Returns nothing — the feed is what reads it back. */
function write(type: 'task.created' | 'token.created' = 'task.created'): void {
  appendActivity(t.db, {
    orgId: s.orgId,
    projectId: type === 'token.created' ? null : s.projectId,
    actorId: s.userId,
    actorKind: 'user',
    type,
  });
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

describe('reading the tail', () => {
  it('delivers rows written after the subscription point', () => {
    const timers = fakeTimers();
    const feed = feedWith(timers);
    const received: ActivityEvent[] = [];

    feed.subscribe({
      from: feed.latestSeq(),
      onEvents: (events) => received.push(...events),
    });

    expect(received).toHaveLength(0);

    write();
    write();
    feed.poll();

    expect(received.map((r) => r.type)).toEqual(['task.created', 'task.created']);
    expect(received[1]?.seq).toBe(received[0]!.seq + 1);
  });

  it('delivers the backlog synchronously, before subscribe returns', () => {
    write();
    write();
    write();

    const feed = feedWith(fakeTimers());
    const received: ActivityEvent[] = [];

    // No poll: the backlog has to arrive during subscribe, or a caller that
    // reads-then-subscribes loses whatever landed between the two.
    feed.subscribe({ from: 0, onEvents: (events) => received.push(...events) });

    expect(received).toHaveLength(3);
    expect(received.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('never delivers the same row twice', () => {
    const feed = feedWith(fakeTimers());
    const seqs: number[] = [];

    feed.subscribe({ from: 0, onEvents: (events) => seqs.push(...events.map((e) => e.seq)) });

    write();
    feed.poll();
    feed.poll();
    feed.poll();
    write();
    feed.poll();

    expect(seqs).toEqual([1, 2]);
  });

  it('drains a burst larger than one batch in a single poll', () => {
    const feed = feedWith(fakeTimers(), 2);
    const seqs: number[] = [];

    feed.subscribe({
      from: feed.latestSeq(),
      onEvents: (events) => seqs.push(...events.map((e) => e.seq)),
    });

    for (let i = 0; i < 7; i++) write();
    feed.poll();

    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('several subscribers share one read', () => {
  it('gives a late joiner only what it missed', () => {
    const feed = feedWith(fakeTimers());

    write();
    write();

    const ahead: number[] = [];
    const behind: number[] = [];

    feed.subscribe({
      from: feed.latestSeq(),
      onEvents: (events) => ahead.push(...events.map((e) => e.seq)),
    });
    feed.subscribe({ from: 0, onEvents: (events) => behind.push(...events.map((e) => e.seq)) });

    expect(ahead).toEqual([]);
    expect(behind).toEqual([1, 2]);

    write();
    feed.poll();

    expect(ahead).toEqual([3]);
    expect(behind).toEqual([1, 2, 3]);
  });

  /**
   * The shared read starts at the *lowest* cursor, so its last row can sit below
   * a subscriber that is further ahead. Without the `max` guard that subscriber's
   * cursor is dragged backwards and the next lap of the same poll re-delivers
   * rows it has already had.
   *
   * Reproducing it needs the batch to be smaller than the divergence, which is
   * why `batchSize` is 1 here — at the default 200 the whole window arrives in
   * one lap and the bug hides.
   */
  it('never rewinds a subscriber that is ahead of the shared window', () => {
    const feed = feedWith(fakeTimers(), 1);
    const early: number[] = [];
    const late: number[] = [];

    feed.subscribe({
      from: feed.latestSeq(),
      onEvents: (events) => early.push(...events.map((e) => e.seq)),
    });

    write();
    write();

    // Joins *after* those two rows and drains them itself, so it is now two
    // ahead of the subscriber that has not been polled yet.
    feed.subscribe({ from: 0, onEvents: (events) => late.push(...events.map((e) => e.seq)) });

    expect(early).toEqual([]);
    expect(late).toEqual([1, 2]);

    feed.poll();

    expect(early).toEqual([1, 2]);
    expect(late).toEqual([1, 2]);
  });

  it('drops a subscriber that throws, and still serves the rest', () => {
    const feed = feedWith(fakeTimers());
    const good: number[] = [];

    feed.subscribe({
      from: feed.latestSeq(),
      onEvents: () => {
        throw new Error('consumer exploded');
      },
    });
    feed.subscribe({
      from: feed.latestSeq(),
      onEvents: (events) => good.push(...events.map((e) => e.seq)),
    });

    write();
    expect(() => {
      feed.poll();
    }).not.toThrow();

    expect(feed.subscriberCount()).toBe(1);
    expect(good).toEqual([1]);
  });
});

describe('the timer is not a leak (AC6)', () => {
  it('arms on the first subscriber and clears on the last unsubscribe', () => {
    const timers = fakeTimers();
    const feed = feedWith(timers);

    expect(feed.isPolling()).toBe(false);

    const first = feed.subscribe({ from: 0, onEvents: noop });
    const second = feed.subscribe({ from: 0, onEvents: noop });

    // One timer for the pair, not one each.
    expect(timers.state.armed).toBe(1);
    expect(feed.isPolling()).toBe(true);

    first.close();
    expect(timers.state.cleared).toBe(0);
    expect(feed.isPolling()).toBe(true);

    second.close();
    expect(timers.state.cleared).toBe(1);
    expect(feed.isPolling()).toBe(false);
    expect(feed.subscriberCount()).toBe(0);
  });

  it('a fired tick with no subscribers does nothing', () => {
    const timers = fakeTimers();
    const feed = feedWith(timers);
    feed.subscribe({ from: 0, onEvents: noop }).close();

    write();
    expect(() => {
      timers.state.fire();
    }).not.toThrow();
  });

  it('re-arms after going idle', () => {
    const timers = fakeTimers();
    const feed = feedWith(timers);

    feed.subscribe({ from: 0, onEvents: noop }).close();
    feed.subscribe({ from: 0, onEvents: noop });

    expect(timers.state.armed).toBe(2);
    expect(feed.isPolling()).toBe(true);
  });
});

describe('closeAll (AC7)', () => {
  it('tells every subscriber and forgets them', () => {
    const timers = fakeTimers();
    const feed = feedWith(timers);
    const closed: string[] = [];

    feed.subscribe({ from: 0, onEvents: noop, onClose: () => closed.push('a') });
    feed.subscribe({ from: 0, onEvents: noop, onClose: () => closed.push('b') });

    feed.closeAll();

    expect(closed).toEqual(['a', 'b']);
    expect(feed.subscriberCount()).toBe(0);
    expect(feed.isPolling()).toBe(false);
    expect(timers.state.cleared).toBe(1);
  });

  it('is safe with nothing open', () => {
    const feed = feedWith(fakeTimers());
    expect(() => {
      feed.closeAll();
    }).not.toThrow();
  });
});

describe('the cursor', () => {
  it('is the rowid, and starts at the head of the table', () => {
    write();
    write();

    const feed = feedWith(fakeTimers());

    expect(feed.latestSeq()).toBe(2);
    expect(latestActivitySeq(t.db)).toBe(2);
  });

  it('is 0 for an empty log', () => {
    expect(feedWith(fakeTimers()).latestSeq()).toBe(0);
  });
});
