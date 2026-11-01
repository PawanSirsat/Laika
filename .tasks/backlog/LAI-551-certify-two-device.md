---
id: LAI-551
title: 'Certify Claude Code and Codex: two-device abrupt-failure experiment on Belka + Strelka'
area: docs
assignee: unclaimed
priority: p1
depends-on: [LAI-547, LAI-548, LAI-549, LAI-550]
discovered-from:
status: backlog
---

Implements **proposal §1, §5, §7** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

The central demonstration runs for real on two laptops with Claude
Code on one and Codex on the other, and each harness's capability cells in
proposal §5 move from *Documented-not-tested* to *Certified* or a filed defect.

## Scope

- Run the 9-step central demonstration (below) on Belka and Strelka.
- Record harness versions, timings, screenshots and the `409 stale_claim` responses.
- Write `docs/agents/certification-claude-codex.md` with the results.

## Out of scope

- Other harnesses (LAI-557)
- The full failure matrix (LAI-559)

## Acceptance criteria

- [ ] All nine steps pass, or each failing step has a filed task with `discovered-from: LAI-551`.
- [ ] Claude Code → Codex recovery is shown continuing from the exact checkpoint SHA.
- [ ] The restarted A is shown refused on REST and MCP.
- [ ] Proposal §5's Claude Code and Codex rows are updated with the certified version.

## Tests and UI evidence required

Manual, two devices. The demonstration:

1. Register agent **A** on device **A** (Belka) and agent **B** on device
   **B** (Strelka), under different vendor accounts and different harnesses.
2. A accepts a real task (work request → claim) and saves remote checkpoints
   that Laika marks `verified` from signed push deliveries.
3. Kill A abruptly, with no hand-off.
4. Observe on the board: Connection lost, then claim expiry, then a recovery
   offer.
5. B fetches the checkpoint and verifies its SHA locally.
6. B accepts the recovery offer.
7. B continues from that exact commit.
8. Restart A and prove its old claim cannot change the task (`409 stale_claim`
   on REST and MCP).
9. Finish with `finish_task` and submit the evidence; a human accepts it in
   Review.

## Dependencies

`depends-on: [LAI-547, LAI-548, LAI-549, LAI-550]`.

## Role / machine

Strelka runs the receiving side and the heavy runs; Belka runs device A and writes the report. Hand-off comment `@strelka` per D-097. Owner area: `docs` (CHIEF).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1–2 days, confidence L.

## Branch

`LAI-551-two-device-certification`

## Migration / rollout notes

Runs against a staging instance on its own port and database, never production.
