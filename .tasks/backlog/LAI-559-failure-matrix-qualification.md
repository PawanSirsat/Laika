---
id: LAI-559
title: 'End-to-end failure matrix + browser/accessibility qualification (both themes, narrow screens, keyboard)'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-551, LAI-553, LAI-555, LAI-557]
discovered-from:
status: backlog
---

Implements **proposal §1, §7** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Every failure case the programme promises to handle is shown passing
end to end, and every agent screen passes browser and accessibility checks in
both themes, at narrow width and by keyboard.

## Scope

- An e2e matrix covering every case below, against a real server.
- Browser and accessibility qualification of every agent screen.
- Server-side cases are cited from LAI-541 / LAI-545 / LAI-546 tests where they already exist; a gap is filed, not patched here.

## Out of scope

- New product behaviour.

## Acceptance criteria

- [ ] Every failure case below has a recorded pass or a filed task.
- [ ] The 9-step central demonstration passes on the release candidate.
- [ ] Every agent screen passes keyboard-only operation and an automated accessibility scan in light and dark at 390 px and desktop.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Playwright e2e; the central demonstration:

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

Required failure cases:

- same-owner hand-off, and approved cross-owner hand-off
- different vendor accounts
- Claude Code → Codex recovery
- wrong-project and insufficient-scope rejection
- token revoked during a session and during an open event stream
- two receivers racing for one offer
- old session reconnecting after transfer
- temporary network failure (lease renewed, no orphan)
- agent crash with a surviving helper (helper stops renewing)
- server restart (boot grace, then overdue leases expire)
- missing checkpoint ("Automatic recovery unavailable")
- push failure, then registration retry with the same idempotency key
- stale semantic note ("Note describes an earlier save")
- conflicting and deleted remote refs (`ref_deleted`)
- expired, declined and cancelled offers
- hand-off limit reached, and duplicate delivery
- malicious note (rendered as untrusted data, never executed)
- context-update replay
- legacy tokens and historical attribution ("agent (unregistered token)")
- existing Review and human acceptance unchanged

## Dependencies

`depends-on: [LAI-551, LAI-553, LAI-555, LAI-557]`.

## Role / machine

SHELL on Belka; the two-device cases run on Strelka via a `@strelka` hand-off. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

3–4 days, confidence M.

## Branch

`LAI-559-failure-matrix`

## Migration / rollout notes

None.
