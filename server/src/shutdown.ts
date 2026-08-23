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

    server.close((err) => {
      if (err) {
        log.error('shutdown.close_failed', { signal, message: err.message });
      } else {
        log.info('shutdown.complete', { signal });
      }
      exit(0);
    });

    server.closeIdleConnections?.();

    const timer = setTimer(() => {
      log.warn('shutdown.forced', { signal, grace_ms: graceMs });
      server.closeAllConnections?.();
      exit(0);
    }, graceMs);

    // Do not keep the event loop alive just to wait for the backstop.
    timer.unref?.();
  };
}
