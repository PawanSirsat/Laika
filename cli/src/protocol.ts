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
 * Protocol 2 adds `laika device pair`, `laika tool add` and the client report
 * `tool add` sends (LAI-1060, LAI-1064) — the board's `device_pairing`,
 * `tool_setup_exchange` and `client_reports`. Each of those commands still asks
 * the board's manifest whether its feature is on before it acts.
 */
export const PROTOCOL = 2;
