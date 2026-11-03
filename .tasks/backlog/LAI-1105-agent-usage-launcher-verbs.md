---
id: LAI-1105
title: '`laika agent` usage names the launcher''s enable, disable and headers'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-1039]
discovered-from: LAI-1039
status: backlog
---

## Goal

`cli/src/agent.ts:236` still says `laika agent launcher check|run|status|stop`.
LAI-1039 added `enable`, `disable` and `headers <harness>` (its own
`laika agent launcher --help` lists them); the top-level usage line should
too. `cli/src/agent.ts` was outside LAI-1039's named files.

## Acceptance criteria

- [ ] The usage line names every launcher subcommand.
- [ ] Repo-root gate exits 0.
