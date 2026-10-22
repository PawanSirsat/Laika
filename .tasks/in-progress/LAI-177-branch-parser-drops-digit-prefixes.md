---
id: LAI-177
title: 'The branch parser cannot read a key prefix that contains a digit'
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-976
status: in-progress
started: 2026-10-22T21:24:36Z
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

- [ ] `parseBranchRef` reads a prefix of the §4.3 shape, digits included, and
      a test proves `p0x-12-fix` resolves to task 12 of the `P0X` project.
- [ ] The existing branch-parsing tests stay green (`add-2fa-support` still
      narrows nothing unless a project holds that prefix).

## Renumbered

Filed as **LAI-991**, which `master` had already given to another session's
task. LAI-998 (release-2 integration, 2026-10-23) renumbered it to **LAI-177**,
the lowest id free on every ref (CHIEF's LAI-950–999 block is full). Per §3,
the commits are not rewritten: `c77fc41d` (*docs(tasks): file LAI-991, digit prefixes in the branch parser [LAI-976]*) names this task as LAI-991 in its file path.
LAI-991 in `.tasks/done/` is master's *Capacity cards compact list*, which is not this task.
