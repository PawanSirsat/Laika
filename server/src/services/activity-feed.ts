import { type ActivityEvent, latestActivitySeq, readActivityAfter } from '../db/activity.ts';
import { type Db } from '../db/client.ts';

/**
 * The fan-out behind `GET /api/v1/events` (SPEC §11.5, D-003).
 *
 * ## The table is the source, not a message bus
 *
 * Nothing publishes to this feed. It reads `activity` and hands rows to whoever
 * is listening, which is what keeps the stream and a page reload telling the same
 * story — an in-memory bus would drift the moment a write succeeded and its
 * publish did not.
 *
 * ## Why it polls
 *
 * SQLite has no `LISTEN/NOTIFY`, which D-003 already assumed, and better-sqlite3
 * exposes no update hook. The alternative to polling is threading a notifier
 * through every service that appends activity — a dozen call sites, each of which
 * is a place to forget one. A `WHERE rowid > ?` against an integer key on an
 * empty result is a few microseconds, and the timer only runs while somebody is
 * connected, so the idle cost of this design is zero and the busy cost is four
 * trivial queries a second no matter how many clients are watching.
 *
 * ## One query serves every subscriber
 *
 * Each subscription carries its own cursor. A tick reads from the *lowest* cursor
 * once and gives each subscriber the tail it has not seen, so a hundred streams
 * cost one query, not a hundred.
 */

export const DEFAULT_INTERVAL_MS = 250;

/** Rows per query. Also the replay page size. */
export const DEFAULT_BATCH_SIZE = 200;

/** Injectable so a test can drive ticks by hand rather than by waiting. */
export interface RepeatingTimer {
  unref?: () => void;
}

export interface ActivityFeedOptions {
  db: Db;
  intervalMs?: number;
  batchSize?: number;
  setTimer?: (fn: () => void, ms: number) => RepeatingTimer;
  clearTimer?: (timer: RepeatingTimer) => void;
}

export interface SubscribeOptions {
  /** Deliver rows after this sequence. `latestSeq()` means "live only". */
  from: number;
  onEvents: (events: readonly ActivityEvent[]) => void;
  /** Called when the server ends the subscription — shutdown, typically. */
  onClose?: () => void;
}

export interface Subscription {
  /** The last sequence delivered to this subscriber. */
  readonly seq: number;
  close(): void;
}

interface Subscriber {
  seq: number;
  onEvents: (events: readonly ActivityEvent[]) => void;
  onClose: (() => void) | undefined;
}

export class ActivityFeed {
  private readonly db: Db;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly setTimer: (fn: () => void, ms: number) => RepeatingTimer;
  private readonly clearTimer: (timer: RepeatingTimer) => void;

  private readonly subscribers = new Set<Subscriber>();
  private timer: RepeatingTimer | null = null;

  constructor(options: ActivityFeedOptions) {
    this.db = options.db;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
  }

  /** The sequence a client with no history should start from. */
  latestSeq(): number {
    return latestActivitySeq(this.db);
  }

  /**
   * Start receiving rows.
   *
   * Any backlog after `from` is delivered synchronously, before this returns.
   * That closes the window a "read the backlog, then subscribe" caller would
   * otherwise have: an append landing between the two steps reaches neither.
   */
  subscribe(options: SubscribeOptions): Subscription {
    const subscriber: Subscriber = {
      seq: options.from,
      onEvents: options.onEvents,
      onClose: options.onClose,
    };

    this.subscribers.add(subscriber);
    this.start();
    this.drain(subscriber);

    return {
      get seq() {
        return subscriber.seq;
      },
      close: () => {
        this.remove(subscriber);
      },
    };
  }

  /** Read once and deliver. Exposed so tests do not have to wait for a tick. */
  poll(): void {
    if (this.subscribers.size === 0) return;

    let cursor = this.lowestSeq();

    // Loop rather than wait for the next tick: a burst larger than one batch
    // would otherwise trickle out at `batchSize` per interval.
    for (;;) {
      const rows = readActivityAfter(this.db, cursor, this.batchSize);
      if (rows.length === 0) return;

      this.dispatch(rows);
      cursor = rows[rows.length - 1]?.seq ?? cursor;

      if (rows.length < this.batchSize) return;
    }
  }

  /**
   * End every open subscription (LAI-002).
   *
   * Called from the shutdown handler: an SSE response is an in-flight request
   * that never finishes on its own, so without this `server.close()` waits out
   * the full grace period and then cuts the connections mid-frame.
   */
  closeAll(): void {
    for (const subscriber of [...this.subscribers]) {
      this.remove(subscriber);
      subscriber.onClose?.();
    }
  }

  /** For the leak assertion in the tests — and for a health endpoint later. */
  subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Whether the poll timer is currently armed. */
  isPolling(): boolean {
    return this.timer !== null;
  }

  private dispatch(rows: readonly ActivityEvent[]): void {
    const highest = rows[rows.length - 1]?.seq;
    if (highest === undefined) return;

    for (const subscriber of this.subscribers) {
      const fresh = rows.filter((row) => row.seq > subscriber.seq);

      // `max`, not assignment: the window starts at the *lowest* cursor, so a
      // subscriber that is further ahead would otherwise be dragged backwards and
      // re-delivered rows it has already seen.
      subscriber.seq = Math.max(subscriber.seq, highest);

      if (fresh.length === 0) continue;

      try {
        subscriber.onEvents(fresh);
      } catch {
        // One broken consumer must not stop the others, and must not leave the
        // shared cursor stuck where a retry would replay for everybody.
        this.remove(subscriber);
      }
    }
  }

  /** Flush a single subscriber's backlog without disturbing the others. */
  private drain(subscriber: Subscriber): void {
    for (;;) {
      const rows = readActivityAfter(this.db, subscriber.seq, this.batchSize);
      if (rows.length === 0) return;

      subscriber.seq = rows[rows.length - 1]?.seq ?? subscriber.seq;

      try {
        subscriber.onEvents(rows);
      } catch {
        this.remove(subscriber);
        return;
      }

      if (rows.length < this.batchSize) return;
    }
  }

  private lowestSeq(): number {
    let lowest = Number.POSITIVE_INFINITY;
    for (const subscriber of this.subscribers) lowest = Math.min(lowest, subscriber.seq);
    return Number.isFinite(lowest) ? lowest : 0;
  }

  private start(): void {
    if (this.timer !== null) return;

    this.timer = this.setTimer(() => {
      this.poll();
    }, this.intervalMs);

    // A poll timer must never be the reason the process stays alive.
    this.timer.unref?.();
  }

  private remove(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
    this.stopIfIdle();
  }

  private stopIfIdle(): void {
    if (this.subscribers.size > 0 || this.timer === null) return;

    this.clearTimer(this.timer);
    this.timer = null;
  }
}
