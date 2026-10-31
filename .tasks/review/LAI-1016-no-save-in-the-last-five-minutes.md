---
id: LAI-1016
title: "A live claim with no recent checkpoint says \"No save in the last 5 minutes\" (SPEC §9.1's checkpoint warning is unbuilt)"
area: core
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-560
started: 2026-10-31T17:43:12Z
status: review
finished: 2026-10-31T17:59:30Z
---

## Why

SPEC §9.1's timing table has a **Checkpoint warning** row: *"a live claim
with no checkpoint, or none newer than this, is shown 'No save in the last 5
minutes' on the task (LAI-545). Shown, decides nothing."* Proposal §4.2 lists
it among the configurable defaults. At `1fe55ff1` nothing produces it: a grep
of `server/src`, `server/web/src` and `cli/src` for the wording, a
`warning` setting near checkpoints, or a "no save" state finds nothing.

Board: LAIKA-870. Found writing `docs/AGENTS-ROLLOUT.md` § 4, which lists it as *not found*.

## Acceptance criteria

- [ ] The task read reports, for a live claim, whether its newest checkpoint
      (any state) is older than the warning window, or absent; the window is
      a deploy-time variable beside LAI-1015's, default 5 minutes.
- [x] The task view shows "No save in the last 5 minutes" in that case, in
      both themes, and nothing when the claim is not live. The web half is
      SHELL's (a named second half under CLAUDE.md §4.4 if the field is new).
- [x] Tests with an injected clock: no checkpoint, a fresh one, one just past
      the window.

## Notes

No new dependencies. Decides nothing, per §9.1: no offer, no expiry.

## Builder notes (CORE on Belka, 2026-10-31)

**Criterion 1 is half done, and left unticked on purpose.** Every task read
carries `handoff.no_recent_save`: `{ since, window_ms }` or `null`. It is set
when the newest claim is live (`active` or `paused`) and the later of the
claim's start and the newest checkpoint (any state) is more than the window
ago, on the server's clock. The window is `saveWarningMs` in
`CheckpointSettings`, default 5 minutes, set through `configureCheckpoints`.

It is **not yet a deploy-time variable**. A new `LAIKA_*` variable needs a
SPEC §11.7 row (`env-contract.test.ts`), and `docs/` is CHIEF's. LAI-1015
already wires `configureCheckpoints` from the environment and takes the §11.7
crossing for the other two checkpoint settings. `saveWarningMs` should ride
with it as `LAIKA_CHECKPOINT_SAVE_WARNING_SECONDS`.

**The honest reading of "changes pending".** The server cannot see a
session's unsaved edits, so the field says only how long the holder has gone
without a save, never that work is pending. Measuring from the claim's start
keeps a claim younger than the window from being warned the moment it
starts.

**The web half was built in the same PR on the owner's dispatch.** SHELL's
area: `server/web/src` and `server/web/test`. The warning goes under the live
claim's *Working* / *Connection lost* line, on the card and in the drawer:
the words beside the warning triangle, never in place of the claim's state.

**Docs half for CHIEF.** SPEC §6.4's `handoff` shape should name
`no_recent_save`.
