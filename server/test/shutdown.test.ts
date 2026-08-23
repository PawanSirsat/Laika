import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler, type ClosableServer } from '../src/shutdown.ts';
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

function harness(graceMs = 10_000) {
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

    expect(log.find('shutdown.close_failed')?.['message']).toBe('server was not running');
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
