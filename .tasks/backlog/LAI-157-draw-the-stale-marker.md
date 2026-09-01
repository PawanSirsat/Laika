---
id: LAI-157
title: Declare stale_flagged_at on the client Task and draw the stale marker
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-208]
discovered-from: LAI-208
status: backlog
---

## Goal

**`server/web` is red until this lands, and that is deliberate** (§4.4, D-045).

LAI-208 puts `stale_flagged_at` on `TaskView`. The client mirror does not declare
it, so LAI-213's drift check fails — correctly. The exact assertion:

```
server/web/test/api/view-type-drift.test.ts:154
not ok 2 - no server field is missing from its client type

  TaskView.stale_flagged_at is served and Task does not declare it —
  add it, or list it in clientOmits with a reason
```

**This is the one red, and nothing else.** `@laika/server` is 1705/1705,
`cli` 19/19, lint and format clean. `clientOmits` lives in `server/web/`, so CORE
has no exemption it could take that is not a crossing — which is why the half
lands red rather than reaching across (CLAUDE.md §4.4).

## What to do

1. **Declare it on the client `Task`**: `stale_flagged_at: number | null`. That
   alone turns the drift check green.
2. **Draw the third marker.** SPEC §11.4.1 lists **blocked**, **ready** and
   **stale**; LAI-049 AC2 requires all three and records `stale` as unmet with
   LAI-208 as the reason. The other two are already drawn.

## Acceptance criteria

- [ ] `server/web` drift check green; the assertion quoted above passes.
- [ ] The card shows a stale marker when `stale_flagged_at` is non-null, in
      **both themes**.
- [ ] The marker says **how long**, not merely that it is stale — the server
      sends a timestamp precisely so the UI can. "Stale" and "stale for 9 days"
      are different messages to whoever is scanning the board.
- [ ] Nothing recomputes staleness client-side. The rule is three conditions
      (§11.6) evaluated by the nightly job; a second definition on the client is
      the drift §4.5 avoids for `ready`.
- [ ] LAI-049 AC2 updated: all three markers drawn.

## Notes

**The field clears itself.** LAI-208 also made the job un-write the flag when a
task stops being stale — moved out of `in_progress`, touched again, or beaten on
by an agent — so the UI does not need to guard against a permanent mark on a
finished task. Worth knowing before you write a condition that does.

**There is a lag, by design.** A task rescued at noon keeps its marker until the
next nightly run, because the job owns the field in both directions rather than
the routes clearing it on write. Do not paper over that on the client by hiding
the marker on non-`in_progress` tasks: that is a second staleness rule, and if
the lag is judged too visible the fix is the job's schedule, not a client guess.
