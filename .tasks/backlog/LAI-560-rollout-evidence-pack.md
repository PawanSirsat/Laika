---
id: LAI-560
title: 'Migration/rollback rehearsal, operator docs, rollout plan, acceptance evidence pack'
area: docs
assignee: unclaimed
priority: p1
depends-on: [LAI-559]
discovered-from:
status: backlog
---

Implements **proposal §7** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

The programme can be released and rolled back safely: migrations are
rehearsed forward and back on a copy of production data, operators have docs,
and the owner gets one evidence pack to accept.

## Scope

- Rehearse every Phase 1 – 4 migration forward and back on a copy of production data.
- Operator docs: registering agents, policy, recovery, timing defaults.
- Rollout plan (feature switch order) and the evidence pack for LAI-532.
- Operator guide: protect `laika-ckpt/*` with a repository ruleset that blocks deletion and update; using `laika agent checkpoints prune --dry-run`.

## Out of scope

- Running the production deploy itself (a push to `master` deploys, D-073).

## Acceptance criteria

- [ ] Rollback rehearsal leaves legacy tokens and historical activity working (recorded).
- [ ] Operator docs exist under `docs/` and name every configurable default.
- [ ] The evidence pack links every child's PR, gate exit codes and the demonstration evidence.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Rehearsal transcript; repo-root gate.

## Dependencies

`depends-on: [LAI-559]`.

## Role / machine

CHIEF (polly) on Belka. Owner area: `docs` (CHIEF).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1–2 days, confidence M.

## Branch

`LAI-560-rollout-evidence`

## Migration / rollout notes

This is the migration task. Never run against the production database; use a copy over SSM per the deploy runbook.
