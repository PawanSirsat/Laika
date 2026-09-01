import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeShutdown,
  createShutdownHandler,
  type ClosableServer,
  REAP_INTERVAL_MS,
} from '../src/shutdown.ts';
import { ActivityFeed } from '../src/services/activity-feed.ts';
import { freshDb } from './helpers/db.ts';
import { captureLog } from './helpers/app.ts';

interface FakeServer extends ClosableServer {
  closed: boolean;
  finishClose(err?: Error): void;
}

/** A stand-in for `http.Server` whose `close` completes when the test says so. */
function fakeServer(): FakeServer {
  let onClosed: ((err?: Error) => void) | undefined;

  return {
    closed: false,
    close(callback) {
      this.closed = true;
      onClosed = callback;
    },
    finishClose(err) {
      onClosed?.(err);
    },
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  };
}

function harness(graceMs = 10_000, onStopping?: () => void) {
  const server = fakeServer();
  const log = captureLog();
  const exit = vi.fn();
  let timerFn: (() => void) | undefined;
  const unref = vi.fn();

  const shutdown = createShutdownHandler({
    server,
    log: log.logger,
    graceMs,
    exit,
    ...(onStopping === undefined ? {} : { onStopping }),
    setTimer: (fn) => {
      timerFn = fn;
      return { unref };
    },
  });

  return { server, log, exit, shutdown, unref, fireTimer: () => timerFn?.() };
}

describe('graceful shutdown', () => {
  it('stops accepting, drains, and exits 0', () => {
    const { server, exit, shutdown } = harness();

    shutdown('SIGTERM');

    expect(server.closed).toBe(true);
    // Still draining — exiting here would cut in-flight requests.
    expect(exit).not.toHaveBeenCalled();

    server.finishClose();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('closes idle keep-alive connections immediately', () => {
    const { server, shutdown } = harness();

    shutdown('SIGTERM');

    // Without this an idle keep-alive holds the server open for the whole grace
    // period, turning a fast deploy into a ten-second one.
    expect(server.closeIdleConnections).toHaveBeenCalled();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it('forces the connections shut if draining outlives the grace period', () => {
    const { server, exit, shutdown, fireTimer } = harness(5_000);

    shutdown('SIGTERM');
    fireTimer();

    expect(server.closeAllConnections).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('does not hold the event loop open for the backstop timer', () => {
    const { shutdown, unref } = harness();

    shutdown('SIGTERM');

    expect(unref).toHaveBeenCalled();
  });

  it('ignores a second signal instead of restarting the sequence', () => {
    const { server, log, shutdown } = harness();
    const closeSpy = vi.spyOn(server, 'close');

    shutdown('SIGINT');
    shutdown('SIGINT');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(log.find('shutdown.already_in_progress')).toBeDefined();
  });

  it('still exits 0 when close reports an error, and logs it', () => {
    const { server, log, exit, shutdown } = harness();

    shutdown('SIGTERM');
    server.finishClose(new Error('server was not running'));

    expect(log.find('shutdown.close_failed')?.message).toBe('server was not running');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('handles a server that lacks the optional connection helpers', () => {
    const log = captureLog();
    const exit = vi.fn();
    let closeCallback: ((err?: Error) => void) | undefined;

    const bare: ClosableServer = {
      close(callback) {
        closeCallback = callback;
      },
    };

    const shutdown = createShutdownHandler({ server: bare, log: log.logger, exit });

    expect(() => {
      shutdown('SIGTERM');
    }).not.toThrow();

    closeCallback?.();
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('onStopping — releasing what holds the server open (LAI-048)', () => {
  it('runs before the listener closes', () => {
    const order: string[] = [];
    const server = fakeServer();
    const log = captureLog();

    const shutdown = createShutdownHandler({
      server,
      log: log.logger,
      exit: vi.fn(),
      setTimer: () => ({ unref: vi.fn() }),
      onStopping: () => order.push('stopping'),
    });

    const realClose = server.close.bind(server);
    server.close = (callback) => {
      order.push('close');
      return realClose(callback);
    };

    shutdown('SIGTERM');

    // Order is the whole point: an SSE stream is an in-flight request, so
    // closing the listener first means waiting out the full grace period and
    // then cutting the connection mid-frame.
    expect(order).toEqual(['stopping', 'close']);
  });

  it('a throwing hook does not turn a clean shutdown into a failure', () => {
    const { server, exit, log, shutdown } = harness(10_000, () => {
      throw new Error('stream registry exploded');
    });

    shutdown('SIGTERM');
    server.finishClose();

    expect(exit).toHaveBeenCalledWith(0);
    expect(log.find('shutdown.stopping_failed')).toMatchObject({
      message: 'stream registry exploded',
    });
  });

  it('is optional', () => {
    const { server, exit, shutdown } = harness();

    shutdown('SIGTERM');
    server.finishClose();

    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('the runtime wiring (LAI-057)', () => {
  /**
   * The gap this closes: `onStopping` was four lines inside `index.ts`'s
   * `main()`, which binds a port and reads the environment and so cannot be
   * called. During the LAI-048 review that call was replaced with a comment and
   * **all 560 tests passed** — both halves were covered in isolation and the
   * line joining them was not.
   */

  interface Recorder {
    server: { close: (cb?: () => void) => void; closeIdleConnections: () => void };
    closed: string[];
  }

  function recorder(): Recorder {
    const closed: string[] = [];
    return {
      closed,
      server: {
        close: (cb?: () => void) => {
          closed.push('server');
          cb?.();
        },
        closeIdleConnections: () => undefined,
      },
    };
  }

  it('closes the activity feed before the listener', () => {
    // **Order matters and is the reason the wiring exists.** A stream still open
    // is an in-flight request: close the listener first and the server waits out
    // the whole grace period, then cuts the stream mid-frame. §11.5.
    const r = recorder();
    const feed = {
      closeAll: () => {
        r.closed.push('feed');
      },
    };

    const shutdown = createRuntimeShutdown({
      server: r.server,
      log: captureLog().logger,
      activityFeed: feed,
      sqlite: {
        close: () => {
          r.closed.push('sqlite');
        },
      },
      exit: () => undefined,
      setTimer: () => ({ unref: () => undefined }),
    });

    shutdown('SIGTERM');

    expect(r.closed).toEqual(['feed', 'server', 'sqlite']);
  });

  it('fails if the feed is no longer wired to onStopping', () => {
    // The assertion the task asks for, stated as its own case: severing the
    // connection while both halves remain individually correct.
    const r = recorder();
    let feedClosed = false;

    const shutdown = createRuntimeShutdown({
      server: r.server,
      log: captureLog().logger,
      activityFeed: {
        closeAll: () => {
          feedClosed = true;
        },
      },
      sqlite: { close: () => undefined },
      exit: () => undefined,
      setTimer: () => ({ unref: () => undefined }),
    });

    shutdown('SIGTERM');

    expect(feedClosed, 'onStopping no longer closes the activity feed').toBe(true);
  });

  it('closes the database after the last request drains, not before', () => {
    // `sqlite.close()` on `onClosed` is the neighbour the task asked me to check
    // while here. A handle closed too early is a query cut off mid-flight; one
    // never closed leaves a WAL the next boot has to recover.
    const r = recorder();

    const shutdown = createRuntimeShutdown({
      server: r.server,
      log: captureLog().logger,
      activityFeed: { closeAll: () => undefined },
      sqlite: {
        close: () => {
          r.closed.push('sqlite');
        },
      },
      exit: () => undefined,
      setTimer: () => ({ unref: () => undefined }),
    });

    shutdown('SIGTERM');

    expect(r.closed.indexOf('sqlite')).toBeGreaterThan(r.closed.indexOf('server'));
  });

  it('reaches a real ActivityFeed’s subscribers', () => {
    // The doubles above prove the wiring; this proves the thing it is wired to
    // does what the wiring assumes. Without it, `closeAll` could be renamed to
    // something that no longer notifies and every test above would still pass.
    const t = freshDb();
    try {
      const feed = new ActivityFeed({ db: t.db, setTimer: () => ({ unref: () => undefined }) });
      let ended = false;

      feed.subscribe({
        from: 0,
        onEvents: () => undefined,
        onClose: () => {
          ended = true;
        },
      });

      const shutdown = createRuntimeShutdown({
        server: recorder().server,
        log: captureLog().logger,
        activityFeed: feed,
        sqlite: { close: () => undefined },
        exit: () => undefined,
        setTimer: () => ({ unref: () => undefined }),
      });

      shutdown('SIGTERM');

      expect(ended, 'a live subscriber was not told the server is going away').toBe(true);
    } finally {
      t.close();
    }
  });
});

/**
 * Reaping idle connections **repeatedly** (LAI-142).
 *
 * One call is not enough, and that was measured rather than reasoned: with a
 * single SSE stream open, shutdown took **4022ms**, and a probe on
 * `getConnections()` every 250ms showed `open: 1` for the whole of it. The
 * stream's response had ended, but the connection was not *idle* at the instant
 * the one call happened — and nothing looked again. On an interval, the same
 * shutdown takes **57ms**.
 */
describe('idle connections are reaped until close completes', () => {
  it('keeps looking, rather than looking once', () => {
    vi.useFakeTimers();
    try {
      const { server, shutdown } = harness();
      shutdown('SIGTERM');

      // The immediate call: a keep-alive connection already idle is reaped now.
      expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);

      // And again, for the one that becomes idle a moment later. Without this
      // the connection waits for whatever other timeout eventually takes it.
      vi.advanceTimersByTime(REAP_INTERVAL_MS * 3);
      expect(server.closeIdleConnections).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops once the server reports closed', () => {
    vi.useFakeTimers();
    try {
      const { server, shutdown } = harness();
      shutdown('SIGTERM');
      vi.advanceTimersByTime(REAP_INTERVAL_MS);
      const during = (server.closeIdleConnections as unknown as { mock: { calls: unknown[] } }).mock
        .calls.length;

      server.finishClose();
      vi.advanceTimersByTime(REAP_INTERVAL_MS * 10);

      // A timer that outlives the shutdown it belongs to is the same class of
      // bug as the stream that started this task.
      expect(server.closeIdleConnections).toHaveBeenCalledTimes(during);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops when the grace period forces the exit', () => {
    vi.useFakeTimers();
    try {
      const { server, shutdown, fireTimer } = harness();
      shutdown('SIGTERM');
      fireTimer();
      const atForce = (server.closeIdleConnections as unknown as { mock: { calls: unknown[] } })
        .mock.calls.length;

      vi.advanceTimersByTime(REAP_INTERVAL_MS * 10);

      expect(server.closeIdleConnections).toHaveBeenCalledTimes(atForce);
    } finally {
      vi.useRealTimers();
    }
  });
});
