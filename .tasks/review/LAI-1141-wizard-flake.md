---
id: LAI-1141
title: 'Developer access wizard test fails CI with AbortError when an animation is cancelled'
area: web
assignee: shell
priority: p1
depends-on: []
status: review
started: 2026-11-05T11:24:46Z
finished: 2026-11-05T11:33:35Z
---

Board: LAIKA-1004, a subtask of LAIKA-997. Filed from CHIEF's block by polly
and claimed in the same commit.

## Goal

`server/web/test/browser/developer-access-v3.test.ts`, *"light: a wizard's
step on show is the accent's soft fill with no border; Connect's keeps its own
(LAI-1096)"*, waited for every animation with
`Promise.all(document.getAnimations().map((a) => a.finished))`. A cancelled
animation's `finished` rejects with `AbortError: The user aborted a request.`,
so a transition cancelled by the theme switch failed the test. It turned
`master` red three times on 2026-11-05 and skipped each deploy.

## Scope

Web test files only. The same wait, anywhere under `server/web/test/`, by an
untruncated grep.

## Acceptance criteria

- [x] The test waits only for animations that end, and a cancelled one counts
      as ended.
- [x] Every other site of the same wait under `server/web/test/` is fixed too,
      and the census is listed in the log.
- [x] The style assertions are unchanged; a mutation of the expected fill and
      of the expected border each turns the test red.
- [x] The file runs green 20 times in a row locally.
- [x] `pnpm lint` and `pnpm format` exit 0.
