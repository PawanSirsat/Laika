---
id: LAI-593
title: "The live claim on task reads carries the holding session's harness, harness_version and model"
area: server
assignee: polly (Belka)
priority: p1
depends-on: [LAI-586, LAI-568]
discovered-from: LAI-586
status: in-progress
started: 2026-10-29T09:33:31Z
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

## Claim note (Belka, 2026-10-29)

Claimed on the polly orchestrator's direction, recorded as deviations rather
than read loosely:

- `depends-on: [LAI-586, LAI-568]` are both merged on `master` and sit in
  `.tasks/review/`, not `done/`.
- `area: server` is CORE's. The dispatch gives this one builder the server
  half, the SPEC §6.4 sentence the fourth criterion names (that sentence
  only), and the drawer's session line — the client half the fifth criterion
  calls LAI-587's — so the web drift check is closed in the same PR rather
  than left red (§4.4).
- **Stacked on LAI-597** (PR #134, branch `LAI-597-cards-working-connection-lost`):
  the drawer's session line lands in the files LAI-597 changed.
