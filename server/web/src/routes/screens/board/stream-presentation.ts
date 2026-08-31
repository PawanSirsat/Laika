import type { StreamStatus } from '../../../api/use-events.ts';

/**
 * What the board says about the stream, for each state it can be in.
 *
 * Pure and separate from the components because the LAI-224 defect was a
 * *presentation* decision, not a transport one: the stream reported its state
 * correctly and the board described it wrongly. A decision made in three places
 * inside JSX is a decision no test can reach, and all three were wrong together
 * — the pill said `RECONNECTING`, the banner said the host was unreachable, and
 * the rail said it was waiting, about a connection the browser had already
 * abandoned.
 *
 * Every function here switches exhaustively on {@link StreamStatus}, so adding
 * a state is a type error at each place that has to describe it rather than a
 * silent fallthrough into whichever branch happened to be last.
 */

/**
 * Should the reader be told the instance cannot be reached?
 *
 * **Only while that might still be true.** `dropped` means the browser is
 * retrying and the banner's promise — *"live updates resume when the stream
 * reconnects"* — will be kept. `refused` means the server answered and said no;
 * the connection is closed for good, nothing is being attempted, and the banner
 * would be a standing lie about an instance that is plainly reachable. That is
 * the whole of LAI-224: a `403` rendered as *"Can't reach localhost:3370"*
 * directly above the board's own, correct explanation that it was a permission
 * problem.
 */
export function showsUnreachableBanner(status: StreamStatus): boolean {
  switch (status) {
    case 'dropped':
      return true;
    case 'live':
    case 'connecting':
    case 'refused':
      return false;
  }
}

/** The header pill beside the project slug. */
export function streamPillLabel(status: StreamStatus): string {
  switch (status) {
    case 'live':
      return 'LIVE · SSE';
    case 'refused':
      // Not "RECONNECTING": there is no reconnection to wait for.
      return 'NOT LIVE';
    case 'connecting':
    case 'dropped':
      return 'RECONNECTING';
  }
}

/** The activity rail's line when the feed is empty. */
export function streamEmptyNote(status: StreamStatus): string {
  switch (status) {
    case 'live':
      return 'Connected. Nothing has happened yet.';
    case 'refused':
      // Not "waiting": nothing is coming, and saying otherwise leaves the
      // reader watching an empty rail indefinitely.
      return 'Live updates are off for this board.';
    case 'connecting':
    case 'dropped':
      return 'Waiting for the stream…';
  }
}
