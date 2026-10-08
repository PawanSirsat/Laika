/**
 * How long an idle HTTP connection stays open (LAI-722).
 *
 * Node's default is **5 s**. Across a ~215 ms round trip, a connection that
 * has closed costs a new TCP handshake before the next request can start, and
 * a person reading a card for more than five seconds closes every one of them.
 * 65 s outlasts the pauses of somebody using the board.
 *
 * `headersTimeout` is set above it **defensively**. Older Node releases could
 * cut a request arriving on a reused connection when the two were ordered the
 * other way; the Node 22 this runs on is not known to, but keeping headers the
 * longer of the two costs nothing and rules that class of interaction out.
 */

export const KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const HEADERS_TIMEOUT_MS = 66_000;

/** The subset of `http.Server` this sets, so a test can pass a real one cheaply. */
export interface KeepAliveTarget {
  keepAliveTimeout: number;
  headersTimeout: number;
}

export function applyKeepAlive(server: KeepAliveTarget): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}
