import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  applyKeepAlive,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
} from '../../src/http/keep-alive.ts';

/**
 * Keep-alive (LAI-722). Node closes an idle connection after **5 s** by
 * default. A board read across a 215 ms round trip pays a new TCP handshake
 * for every request that arrives after a pause longer than that — which is
 * every click after somebody has read a card.
 *
 * The end-to-end half, against the built server, is in `tooling/build.test.ts`.
 */
describe('applyKeepAlive', () => {
  it('holds an idle connection for 65 s', () => {
    const server = createServer();
    applyKeepAlive(server);

    expect(KEEP_ALIVE_TIMEOUT_MS).toBe(65_000);
    expect(server.keepAliveTimeout).toBe(65_000);
  });

  it('waits longer for headers than for an idle connection', () => {
    // Defensive ordering, not a fix for a current Node bug — see keep-alive.ts.
    const server = createServer();
    applyKeepAlive(server);

    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});
