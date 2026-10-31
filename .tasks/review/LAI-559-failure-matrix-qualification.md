---
id: LAI-559
title: 'End-to-end failure matrix + browser/accessibility qualification (both themes, narrow screens, keyboard)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-551, LAI-553, LAI-555, LAI-557]
discovered-from:
status: review
started: 2026-10-31T22:04:00+02:00
finished: 2026-10-31T22:14:00+02:00
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

## Submission notes (Belka, 2026-10-31)

Submitted as a **partial**, server-side pass. No criterion above is ticked,
because none is fully met yet.

- **Done.** `docs/acceptance/LAI-559-failure-matrix.md` has 26 rows:
  - 21 are proven by a cited automated test;
  - 3 are proven in part, with the remainder UNVERIFIED;
  - 2 are UNVERIFIED;
  - 0 product bugs were found.
- **New test.** `server/test/http/handoff-failure-matrix.test.ts` adds the
  central demonstration's server half over REST, MCP and signed pushes on a
  faked clock. It covers Claude Code → Codex recovery and the server half of
  the stale-note case; nothing else proved those.
- **Criterion 1 (a pass or a filed task for every case).** Not met: the
  UNVERIFIED rows have neither yet. Each row names the device or GitHub step
  it needs.
- **Criterion 2 (the 9-step demonstration).** Only its server half is proven.
  The two-device run (Belka + Strelka) is not done.
- **Criterion 3 (browser and accessibility checks).** Not attempted in this
  pass; it is matrix row 26.
- **Criterion 4 (repo-root gate).** CI runs it on the PR. Locally I ran only
  the single test file, plus `pnpm lint` (exit 0) and `pnpm format` (exit 0),
  per Belka's no-full-suite rule.
- **Scope note.** This task is `area: web`, but the polly dispatch asked for a
  `server/test/` suite and a `docs/acceptance/` file; both are outside SHELL's
  area under §1. The reviewer should see that crossing.

