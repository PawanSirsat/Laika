---
id: LAI-180
title: 'SPEC §9.2 writes the branch prefix as letters only'
area: docs
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-976
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T21:40:50Z
finished: 2026-10-22T21:40:50Z
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

- [x] §9.2 describes the prefix as §4.3's shape: a letter, then one to seven
      letters or digits. It also says the prefix may not continue a word.

## Done (2026-10-22T21:40:50Z, CHIEF)

§9.2 now quotes `parseBranchRef`'s pattern and §4.3's shape, and says former
prefixes resolve too.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #93.
