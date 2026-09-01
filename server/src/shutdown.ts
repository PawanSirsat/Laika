import { type Logger } from './log.ts';

/**
 * The subset of `http.Server` shutdown needs. Narrower than the real type so a
 * test can supply a double without constructing a server.
 */
export interface ClosableServer {
  close(callback?: (err?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownOptions {
  server: ClosableServer;
  log: Logger;
  /** How long in-flight requests get before connections are cut. */
  graceMs?: number;
  exit?: (code: number) => void;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  /**
   * Run before the listener is closed. Where anything holding a connection open
   * on purpose gets told to let go — the SSE streams of §11.5, which are
   * in-flight requests that never finish by themselves.
   */
  onStopping?: () => void;
  /** Released after the last request drains — the database handle, typically. */
  onClosed?: () => void;
}

/**
 * The pieces a running Laika has to let go of, and the order it lets go of them.
 *
 * `close()` only, so a test can pass a double for either without building a real
 * server or a real database.
 */
export interface RuntimeTeardown {
  server: ClosableServer;
  log: Logger;
  /** §11.5's streams. They never end by themselves, which is the whole problem. */
  activityFeed: { closeAll: () => void };
  /**
   * §11.6's cron. An interval outlives the server that started it and holds the
   * process open — the same shape as an unclosed stream, and the reason LAI-142
   * exists (LAI-431).
   */
  scheduler?: { stop: () => void };
  /** Checkpoints the WAL and releases the file lock. */
  sqlite: { close: () => void };
  graceMs?: number;
  exit?: (code: number) => void;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
}

/**
 * The shutdown handler **wired to Laika's runtime** (LAI-057).
 *
 * This exists so those two callbacks are reachable from a test. They used to
 * live inside `index.ts`'s `main()`, which binds a port and reads the
 * environment and so cannot be called from anywhere — and during the LAI-048
 * review `onStopping` was replaced with a comment and **all 560 tests passed**.
 *
 * Both halves were covered in isolation: `shutdown.test.ts` proved `onStopping`
 * is invoked, `activity-feed.test.ts` proved `closeAll()` reaches every
 * subscriber. The line joining them was the one nothing touched — and losing it
 * costs a ten-second stall on every deploy that looks, from a browser, exactly
 * like a network fault.
 *
 * Keeping the composition here rather than in `index.ts` leaves that file as
 * process bootstrap only (CONVENTIONS §2.1) and puts the wiring next to the
 * handler it configures.
 */
export function createRuntimeShutdown(parts: RuntimeTeardown): (signal: string) => void {
  return createShutdownHandler({
    server: parts.server,
    log: parts.log,
    // Before the listener closes: an open stream is an in-flight request, so
    // the server would otherwise wait out the whole grace period and then cut
    // it mid-frame.
    onStopping: () => {
      parts.activityFeed.closeAll();
      // Before the listener closes, with the streams: both are things that keep
      // the loop alive on purpose and neither ends by itself.
      parts.scheduler?.stop();
    },
    // After the last request drains, so nothing is mid-query when the handle
    // goes. A WAL that never checkpoints makes the next boot recover a journal.
    onClosed: () => {
      parts.sqlite.close();
    },
    ...(parts.graceMs === undefined ? {} : { graceMs: parts.graceMs }),
    ...(parts.exit === undefined ? {} : { exit: parts.exit }),
    ...(parts.setTimer === undefined ? {} : { setTimer: parts.setTimer }),
  });
}

export const DEFAULT_GRACE_MS = 10_000;

/**
 * Stop accepting, let in-flight requests finish, exit 0 (LAI-002).
 *
 * Two details that matter:
 *  - `closeIdleConnections()` is called immediately. Without it a keep-alive
 *    connection sitting idle holds the server open for the full grace period,
 *    so a healthy deploy takes 10s instead of milliseconds.
 *  - The forced exit is a backstop, not the path. A request that hangs past the
 *    grace period loses its connection rather than blocking the shutdown
 *    forever — which is what makes `docker stop` return instead of escalating
 *    to SIGKILL.
 */
export function createShutdownHandler(options: ShutdownOptions): (signal: string) => void {
  const { server, log } = options;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const exit = options.exit ?? ((code) => process.exit(code));
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));

  let started = false;

  return (signal: string): void => {
    // A second SIGINT (an impatient Ctrl-C) must not restart the sequence.
    if (started) {
      log.warn('shutdown.already_in_progress', { signal });
      return;
    }
    started = true;

    log.info('shutdown.start', { signal, grace_ms: graceMs });

    // Before `close()`, not after: a stream that is still open is an in-flight
    // request, so the server would wait out the whole grace period and then cut
    // it mid-frame. Ending them first turns those connections idle, and
    // `closeIdleConnections()` below reaps them immediately.
    try {
      options.onStopping?.();
    } catch (err) {
      log.error('shutdown.stopping_failed', {
        signal,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const release = (): void => {
      try {
        options.onClosed?.();
      } catch (err) {
        // Never let cleanup turn a clean shutdown into a non-zero exit.
        log.error('shutdown.release_failed', {
          signal,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    server.close((err) => {
      if (err) {
        log.error('shutdown.close_failed', { signal, message: err.message });
      } else {
        log.info('shutdown.complete', { signal });
      }
      release();
      exit(0);
    });

    server.closeIdleConnections?.();

    const timer = setTimer(() => {
      log.warn('shutdown.forced', { signal, grace_ms: graceMs });
      server.closeAllConnections?.();
      release();
      exit(0);
    }, graceMs);

    // Do not keep the event loop alive just to wait for the backstop.
    timer.unref?.();
  };
}
