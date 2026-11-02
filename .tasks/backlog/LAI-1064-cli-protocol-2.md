---
id: LAI-1064
title: 'The CLI still speaks protocol 1 while it carries device pair and tool add; the board now says protocol 2'
area: cli
assignee: unclaimed
priority: p1
depends-on: [LAI-1062]
discovered-from: LAI-1062
status: backlog
---

The SHELL half of LAI-1062 (CLAUDE.md §4.4; board card LAIKA-918).

LAI-1062 makes `GET /api/v1/developer/compatibility` answer
`protocol { current: 2, min_client: 1 }`, with `device_pairing`,
`tool_setup_exchange` and `client_reports` `true` and each
`cli.min_protocol_for` `2`. `cli/src/protocol.ts` still exports
`PROTOCOL = 1`, so `updateStatus()` in `cli/src/doctor.ts` reports
*"Update required for device_pairing, tool_setup_exchange, client_reports"*
(`status: 'action'`, a non-zero exit) on a checkout that has those commands
(LAI-1060). An old CLI is still accepted (`min_client` is 1).

LAI-1062's second criterion lands here too: `cli/src/device.ts`'s header says
it does not ask the manifest because every flag was `false`.

## Acceptance

- [ ] `cli/src/protocol.ts` exports `PROTOCOL = 2`, its comment naming what
      protocol 2 adds (device pair, tool add, client reports).
- [ ] `laika doctor` against a protocol-2 board with those features on reports
      no "Update required" for them; a test fails if `PROTOCOL` is 1.
- [ ] `laika device pair` and `laika tool add` gate on
      `features.device_pairing` / `features.tool_setup_exchange` when the
      manifest answers, and keep the answer-based fallback for an old board
      (`404`, no Laika JSON). The `device.ts` header says so.
- [ ] cli typecheck, eslint and prettier exit 0; PR into `master`, CI green.
