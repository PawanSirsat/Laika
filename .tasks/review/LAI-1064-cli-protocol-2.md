---
id: LAI-1064
title: 'The CLI still speaks protocol 1 while it carries device pair and tool add; the board now says protocol 2'
area: cli
assignee: shell
priority: p1
depends-on: [LAI-1062]
discovered-from: LAI-1062
started: 2026-11-02T01:10:23Z
status: review
finished: 2026-11-02T01:20:35Z
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

- [x] `cli/src/protocol.ts` exports `PROTOCOL = 2`, its comment naming what
      protocol 2 adds (device pair, tool add, client reports).
- [x] `laika doctor` against a protocol-2 board with those features on reports
      no "Update required" for them; a test fails if `PROTOCOL` is 1.
- [x] `laika device pair` and `laika tool add` gate on
      `features.device_pairing` / `features.tool_setup_exchange` when the
      manifest answers, and keep the answer-based fallback for an old board
      (`404`, no Laika JSON). The `device.ts` header says so.
- [x] cli typecheck, eslint and prettier exit 0; PR into `master`, CI green.

## Notes (SHELL, at review)

- **Claimed while LAI-1062 is in `review/`, not `done/`** (§2 step 1): the
  dispatcher stacked this on #216 so both merge together and `master` never
  sees a protocol-2 board with a protocol-1 CLI. The PR's base is
  `LAI-1062-compat-features-on`, not `master`; the fourth criterion's "PR
  into `master`" is met when #216 merges.
- **Added on the dispatcher's request mid-task:** a refused `laika tool add`
  (Antigravity, Copilot cloud, an unknown tool) now points to a personal token
  under Developer access → Advanced in the tool's own MCP settings, as the web
  wizard (#215) does, not a "Set up by hand" V3 does not have.
- `#216`'s later fixes (owner-side routes in `FEATURE_ROUTES`) were merged in;
  the CLI reads only the flags, so nothing here changed for them.

