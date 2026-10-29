---
id: LAI-549
title: 'Hand-off dialog + drawer recovery panel (checkpoint age, note staleness, approval)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-546, LAI-543]
discovered-from:
started: 2026-10-30T00:55:00Z
status: in-progress
---

Implements **proposal §6 (hand-off dialog, drawer)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human starts or approves a hand-off from the task drawer and sees
the last verified checkpoint, its age, whether the note is stale, and whether
recovery is available — and the sender never sees "accepted" on the
receiver's behalf.

## Scope

- Hand-off dialog with `useDialogFocus`: from → to, reason, checkpoint summary and age, note, approval needed, "The receiver must accept".
- Drawer recovery panel: last verified checkpoint, "Note describes an earlier save", "No continuation note", "Automatic recovery unavailable — no saved checkpoint" with reassign / release actions.
- Client mirror of `checkpoint_saved` and the seven hand-off verbs with wording.

## Out of scope

- Inbox (LAI-550)

## Acceptance criteria

- [ ] The dialog traps focus, closes on Escape and returns focus (asserted).
- [ ] The sender's view shows "Waiting for … to accept" until the server reports acceptance (e2e).
- [ ] All three checkpoint messages render from API fields (fixtures per case).
- [ ] All eight verbs are mirrored; drift check green against LAI-545 and LAI-546.
- [ ] Both themes, keyboard, 390 px.
- [ ] Repo-root gate exits 0.
- [ ] The drawer shows "Verification pending" for a pending checkpoint and, after 10 minutes, "Verification pending — no push notice from GitHub yet" with the webhook / Redeliver hint for owners and admins; a newer pending checkpoint is shown beside the latest verified one as unverified.

## Tests and UI evidence required

Vitest; Playwright e2e offer → approve; screenshots light/dark/narrow.

## Dependencies

`depends-on: [LAI-546, LAI-543]`.

Client-mirror owner for `checkpoint_saved` (with LAI-544, LAI-545) and for `handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`, `handoff_cancelled`, `handoff_expired`, `task_recovered` (with LAI-544, LAI-546).

Related existing card: **LAIKA-533** (hand-off button).

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-549-handoff-dialog`

## Migration / rollout notes

Completes the three-owner merges for the eight Phase 3 verbs.
