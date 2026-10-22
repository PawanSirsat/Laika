---
id: LAI-991
title: 'The branch parser cannot read a key prefix that contains a digit'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-976
status: backlog
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
