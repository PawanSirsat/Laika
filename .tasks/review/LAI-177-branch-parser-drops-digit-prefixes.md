---
id: LAI-177
title: 'The branch parser cannot read a key prefix that contains a digit'
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-976
status: review
started: 2026-10-22T21:24:36Z
finished: 2026-10-22T21:25:25Z
---

## Goal

§4.3 and `routes/projects.ts`'s `Prefix` allow a prefix of 2–8 letters **and
digits** starting with a letter (`P0X`, `WEB2`). `parseBranchRef` in
`server/src/services/heartbeats.ts` matches `([A-Za-z]+)-(\d+)`, so the branch
`p0x-12-fix` parses as prefix `x`, number 12: a heartbeat on a repo two
projects share is not narrowed, and `resolveBranchTask` returns nothing for a
project whose prefix has a digit. Found while making former prefixes resolve
(LAI-976); not changed there.

## Acceptance criteria

- [x] `parseBranchRef` reads a prefix of the §4.3 shape, digits included, and
      a test proves `p0x-12-fix` resolves to task 12 of the `P0X` project.
- [x] The existing branch-parsing tests stay green (`add-2fa-support` still
      narrows nothing unless a project holds that prefix).

## Renumbered

Filed as **LAI-991**, which `master` had already given to another session's
task. LAI-998 (release-2 integration, 2026-10-23) renumbered it to **LAI-177**,
the lowest id free on every ref (CHIEF's LAI-950–999 block is full). Per §3,
the commits are not rewritten: `c77fc41d` (*docs(tasks): file LAI-991, digit prefixes in the branch parser [LAI-976]*) names this task as LAI-991 in its file path.
LAI-991 in `.tasks/done/` is master's *Capacity cards compact list*, which is not this task.

## Builder notes (CORE, 2026-10-23)

Absorbed by the release-2 review of LAI-976 (PR #89). Fixed in the same
commit as that review's other blocking item.

- `parseBranchRef` matches
  `(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,7})-(\d+)`.
- Tests are in `server/test/services/space-settings.test.ts`, under *branch
  names carrying a prefix with a digit*:
  - `web2-1-fix` and `p0x-12-fix` parse whole.
  - `p0x-12-fix` resolves to task 12 of the `P0X` project.
  - Former digit and letters-only prefixes resolve too.
  - A digit prefix narrows a shared repo.
- `add-2fa-support` still reads `add`.
- `test/services/heartbeats.test.ts` is green, unchanged.
- Putting the old regex back turns 4 tests red.
- SPEC §9.2's `[a-z]+` is filed as LAI-180.
