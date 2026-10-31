---
id: LAI-1016
title: "A live claim with no recent checkpoint says \"No save in the last 5 minutes\" (SPEC §9.1's checkpoint warning is unbuilt)"
area: core
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-560
status: backlog
---

## Why

SPEC §9.1's timing table has a **Checkpoint warning** row: *"a live claim
with no checkpoint, or none newer than this, is shown 'No save in the last 5
minutes' on the task (LAI-545). Shown, decides nothing."* Proposal §4.2 lists
it among the configurable defaults. At `1fe55ff1` nothing produces it: a grep
of `server/src`, `server/web/src` and `cli/src` for the wording, a
`warning` setting near checkpoints, or a "no save" state finds nothing.

Found writing `docs/AGENTS-ROLLOUT.md` § 4, which lists it as *not found*.

## Acceptance criteria

- [ ] The task read reports, for a live claim, whether its newest checkpoint
      (any state) is older than the warning window, or absent; the window is
      a deploy-time variable beside LAI-1015's, default 5 minutes.
- [ ] The task view shows "No save in the last 5 minutes" in that case, in
      both themes, and nothing when the claim is not live. The web half is
      SHELL's (a named second half under CLAUDE.md §4.4 if the field is new).
- [ ] Tests with an injected clock: no checkpoint, a fresh one, one just past
      the window.

## Notes

No new dependencies. Decides nothing, per §9.1: no offer, no expiry.
