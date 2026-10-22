---
id: LAI-180
title: 'SPEC §9.2 writes the branch prefix as letters only'
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-976
status: backlog
---

## Goal

SPEC §9.2 says the heartbeat matches a branch against `[a-z]+-(\d+)`. That
pattern cannot read a prefix with a digit, and §4.3 and `PATCH /projects`
accept such prefixes (`WEB2`, `P0X`). LAI-177 changed `parseBranchRef` in
`server/src/services/heartbeats.ts` to read §4.3's shape:
`(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,7})-(\d+)`, case-insensitively. The
prefix may not continue a word, so `p0x-12-fix` reads `P0X` and never `X`.
The SPEC sentence should say the same.

## Acceptance criteria

- [ ] §9.2 describes the prefix as §4.3's shape: a letter, then one to seven
      letters or digits. It also says the prefix may not continue a word.
