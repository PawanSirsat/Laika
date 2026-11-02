---
id: LAI-1063
title: 'A resumed harness reports the old process''s model: a stale `<state>.self` overrides the new start'
area: shell
assignee: polly
priority: p2
depends-on: []
discovered-from: LAI-1059
status: in-progress
started: 2026-11-02T01:02:06Z
---

## Why

Found reviewing #214 (LAI-1059). `startLocked` in `cli/src/agent-session.ts`
sets `state.self` from the new start's report but leaves an existing
`<state>.self` alone. `selfReportOf` lets `.self` win over `state.self`, so on a
resumed harness session under the same state path (`claude --resume`: a new
process, the same harness session id) an old `.self` holding model A overrides
the fresh start's model B, and the first heartbeat reports A until the next
prompt's hook notes B again.

## Acceptance criteria

- [ ] When `startLocked` writes `state.self`, it also writes `<state>.self` to
      match, atomically and 0600 through `writePrivate`, with a one-line comment
      that `.self` takes precedence in `selfReportOf`.
- [ ] A test in `cli/test/agent-session.test.ts`: an old `.self` with model A,
      a new process's start reading model B, and the first heartbeat does not
      send A; `selfReportOf` is B and `.self` is 0600. It fails without the fix.
- [ ] `cli` typecheck, eslint and prettier on the touched files exit 0.
- [ ] PR into `master`, CI green.

## Notes

Files: `cli/src/agent-session.ts`, `cli/test/agent-session.test.ts`. No new
dependencies.
