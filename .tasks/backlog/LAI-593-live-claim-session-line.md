---
id: LAI-593
title: "The live claim on task reads carries the holding session's harness, harness_version and model"
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-586, LAI-568]
discovered-from: LAI-586
status: backlog
---

## Goal

The drawer's session line (D-118, LAI-587) — `Polly · Belka · Codex · gpt-5.5`
— can be drawn from a task read, without a second request.

## Why it is separate

LAI-586 gives agent sessions self-reported `harness`, `harness_version` and
`model`. LAI-568 (in review, branch `LAI-568-task-view-live-claim`) serves the
task's live claim on every task read as `TaskLiveClaimView`. Each branch
touches `services/claims.ts`, neither has the other, and LAI-586 deliberately
did not add a second claim field to `TaskView` beside LAI-568's.

## Acceptance criteria

- [ ] `TaskLiveClaimView` gains the holding session's `harness`, `harness_version` and `model`, read in LAI-568's one query per page
- [ ] Null where the session reported nothing; never guessed
- [ ] Tested on a list read and a single read; a heartbeat that changes the model shows on the next read
- [ ] SPEC §6.4's task shape names the fields
- [ ] The client mirror is SHELL's (LAI-587); a web drift red it leaves is quoted and named, per §4.4
