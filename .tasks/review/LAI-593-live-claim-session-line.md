---
id: LAI-593
title: "The live claim on task reads carries the holding session's harness, harness_version and model"
area: server
assignee: polly (Belka)
priority: p1
depends-on: [LAI-586, LAI-568]
discovered-from: LAI-586
status: review
finished: 2026-10-29T10:00:18Z
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

- [x] `TaskLiveClaimView` gains the holding session's `harness`, `harness_version` and `model`, read in LAI-568's one query per page
- [x] Null where the session reported nothing; never guessed
- [x] Tested on a list read and a single read; a heartbeat that changes the model shows on the next read
- [x] SPEC §6.4's task shape names the fields
- [x] The client mirror is SHELL's (LAI-587); a web drift red it leaves is quoted and named, per §4.4

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

## Submission (Belka, 2026-10-29)

PR #138, branch `LAI-593-live-claim-session-line`, stacked on #134. CI *Gate
— test, lint, format* passed on `e5ef2530` (run 40851956240, 15m35s).

- Server: `liveClaimViews` selects the session's `harness`,
  `harness_version`, `model` in its one query (the existing one-statement
  test still holds). Tests in `test/services/claims.test.ts` and
  `test/http/routes/agent-sessions.test.ts` cover the single read, the full and
  slim lists, a heartbeat that changes the model, null where nothing was
  reported, and no leak to a token pinned to another project.
- SPEC §6.4: one sentence in *Agent sessions and claims* — before it, §6.4
  did not name the live claim on task reads at all.
- Client mirror (criterion 5): no drift red was left. The task pairs could
  not see inside `claim`, so a `TaskLiveClaimView` ↔ `TaskLiveClaim` pair was
  added (dropping `model` from the mirror turns it red), and the coverage
  census' expired entry for it removed.
- Drawer: the working session's line under its chip, version and model under
  Details. Uses `agentLabel`, so harness `omnigent` reads `Omnigent · Belka ·
  …` (LAI-587's note; naming is LAI-583's). Screenshots in
  `.polly/evidence/LAI-593/` on Belka.
