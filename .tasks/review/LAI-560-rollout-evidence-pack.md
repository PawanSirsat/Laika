---
id: LAI-560
title: 'Migration/rollback rehearsal, operator docs, rollout plan, acceptance evidence pack'
area: docs
assignee: chief
priority: p1
depends-on: [LAI-559]
discovered-from:
status: review
started: 2026-10-31T16:33:21Z
finished: 2026-10-31T16:48:52Z
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

- [x] Rollback rehearsal leaves legacy tokens and historical activity working (recorded).
- [x] Operator docs exist under `docs/` and name every configurable default.
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

## Claim note (deviation, 2026-10-31)

Claimed while `LAI-559` is still in `.tasks/backlog/` on `origin/master`, on
direct dispatch by CHIEF (polly) — not inferred from §2. Consequence: the
evidence pack cannot cite the failure matrix as done; it lists every LAI-559
row as **UNVERIFIED**. Branch is `LAI-560-rollout-evidence-pack` (the task
named `LAI-560-rollout-evidence`; the worktree was cut with the longer name).

## Submission (2026-10-31, CHIEF / polly on Belka)

**Delivered**
- `docs/AGENTS-ROLLOUT.md`: the operator guide. It covers what 0061 – 0069 add, the backup to take before deploying, the enable order, **every configurable default** with where it is set, the `laika-ckpt/**/*` ruleset, redelivery and re-tag recovery, rollback, retention and prune `--dry-run`, consent, the known limitations, and a release checklist.
- `docs/acceptance/LAI-560-migration-rehearsal.md`: forward 0060 → 0069, restore, and the pre-programme code (`71dd4217`) on the restored file. The legacy token works over REST and MCP, and the historical activity fingerprint is identical at every stage. The image-only rollback is covered too.
- `docs/acceptance/LAI-532-evidence-pack.md`: decisions, each child's task state and PRs, every PR from #96 and #98 – #171 with its last PR gate and the master CI run on its merge commit, the acceptance documents, the capability matrices, and **§ 6, what is not verified**.
- Filed LAI-1015 (LAIKA-869) and LAI-1016 (LAIKA-870).

**Criteria, honestly**
- *Rollback rehearsal*: ticked, **on a synthetic 0060 database, not a copy of production data.** The scope asked for a production copy; this run was told not to touch production. The production-copy rehearsal is item 13 of the pack's § 6.
- *Operator docs name every default*: ticked. Four of the defaults are not actually configurable at deploy time, and the guide marks them so (LAI-1015, LAI-1016).
- *Evidence pack links the demonstration evidence*: **unticked.** The pack links every child's PR and gate result, but the demonstration (LAI-559's 9 steps, LAI-551's two-device run) does not exist yet. It can be ticked when those land.
- *Repo-root gate*: **unticked here.** On Belka the gate runs in CI, not locally (the machine rule). The PR's CI result is recorded below once it finishes.

**Verification run locally** (docs only; no code touched): `pnpm lint` exit 0 and `pnpm format` exit 0, each to its own file.
