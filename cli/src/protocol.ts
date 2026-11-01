/**
 * The helper protocol this CLI speaks (LAI-1043), mirroring
 * `server/src/services/developer-compat.ts`'s `PROTOCOL.current`.
 *
 * A number, not a semver: it moves only when a board and this CLI must agree on
 * something new. `laika doctor` compares it with the board's
 * `GET /developer/compatibility` answer to say whether this checkout is up to
 * date, needs an update, or is missing what a feature needs.
 *
 * Protocol 1 is `agent login`, session hooks, `connect` and checkpoints.
 */
export const PROTOCOL = 1;
