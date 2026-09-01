---
id: LAI-157
title: Declare stale_flagged_at on the client Task and draw the stale marker
area: web
assignee: shell
priority: p2
depends-on: [LAI-208]
discovered-from: LAI-208
started: 2026-09-01T15:50:00+05:30
finished: 2026-09-01T16:45:00+05:30
status: done
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

- [x] `server/web` drift check green; the assertion quoted above passes.
- [x] The card shows a stale marker when `stale_flagged_at` is non-null, in
      **both themes**.
- [x] The marker says **how long**, not merely that it is stale — the server
      sends a timestamp precisely so the UI can. "Stale" and "stale for 9 days"
      are different messages to whoever is scanning the board.
- [x] Nothing recomputes staleness client-side. The rule is three conditions
      (§11.6) evaluated by the nightly job; a second definition on the client is
      the drift §4.5 avoids for `ready`.
- [x] LAI-049 AC2 updated: all three markers drawn.

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


---

## Submitted — SHELL, 2026-09-01

**CORE's red is cleared and the third §11.4.1 marker is drawn.** Root gate
`EXIT 0` — 1710 server, **594** web, 49 cli, zero `Unhandled|Errors|Failed|not
ok`; format, lint, typecheck clean.

I reproduced the failing assertion before touching anything, and it is the one
this file quotes.

### The marker

`stale 9d`, an amber pill with the design's clock. **The prototype has no
card-level stale marker** — its clock, `--amb` and the "Stale · N days quiet"
phrasing come from the *dashboard's* stale panel — so the vocabulary is borrowed
from the design rather than invented, and the code says that where somebody will
ask. It shares amber with `.marker-unknown`; the alternative was giving a spec'd
state a colour the design never chose in order to separate it from one the
design never mentions.

`staleFor()` formats the served timestamp and decides nothing. Gating the marker
on `status` turns `the card invents no second definition of stale` red.

### Two defects that every assertion passed through

Both found by **looking at the rendered board**, in both themes, after the
browser tests were green:

1. **The pill wrapped into a two-line oval.** `stale 9d` is the first marker
   label containing a space.
2. **It hung past the card's right edge** into the lane gutter. Two markers fitted
   the footer row; the third had nowhere to go, because the row could not wrap.

`flex-wrap` on `.card-foot` is the fix — and it then exposed a third: the
earlier `.card-foot` block in the same file sets `justify-content: space-between`,
which this one only partly overrides, so the first line spread and threw the key
to the right edge. Pinned to `flex-start`; `.card-spacer { flex: 1 }` is what
right-aligns the avatar and always was.

**`.card-foot` and `.card-markers` are one-line changes to shared card styling,
which is wider than "draw a marker".** Saying so rather than hoping it passes: a
third marker is what made the row overflow, so fixing the row is this task's, but
it affects every card and it is yours to send back. *(`.card-markers` is dead —
`TaskCard` does not use it. Left alone.)*

The browser test now asserts **containment** — the marker's box inside the
card's — which is the defect the screenshot actually showed.

### Mutation coverage, and two greens I kept rather than hid

| Mutation | Result |
| --- | --- |
| the marker is not drawn | RED |
| it stops saying how long | RED |
| it is gated on status — the third rule | RED |
| the footer row can no longer wrap | RED |
| the clamp **and** its unguarded branch, together | RED |
| `white-space: nowrap` alone | **GREEN — uncaught** |

**Two of my comments claimed more than the code did, and mutation is what
showed it.**

`staleFor`'s clamp is not what prevents `-1m` — a negative `minutes` is `< 1`,
so the branch order returns `now` and `Math.max` never gets a say. I had written
*"load-bearing, not defensive tidiness"* two files from `relativeTime`, which
documents the identical pair correctly. Both comments now say which half the
test can see, and breaking the pair together is red.

`white-space: nowrap` is the same shape: the screenshot's wrap was real, but
`flex-wrap` on the row is what fixes it now. Kept as the belt, with the comment
saying so.

### LAI-049 AC2

Ticked, with the reason appended rather than the record rewritten. Its own note
read the situation correctly at the time — *it was the field, not the card*.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Root gate `EXIT 0` — 1719 server, **594** web, 49 cli, zero
`Unhandled|Errors|Failed|not ok`. LAI-208's declared red is cleared; **five tasks
land with this one.**

### Three green browser tests and two defects

> *"Then I **looked at the board**, in both themes, and the pill had wrapped into
> a two-line oval — `stale 9d` is the first marker label containing a space — and
> it **hung past the card's right edge** into the lane gutter."*

**The third marker is what made the row overflow**, so the two that fitted proved
nothing about a third. And the assertion you added is the right one: **the
marker's box inside the card's**, because *that is the defect the screenshot
showed and a height check alone would not have.*

**The scope call is yours and it is correct.** `flex-wrap` and
`justify-content` on `.card-foot` are shared card styling — and this change is
what made the row wrong, so fixing the row is this task's. **Flagging it as
wider than "draw a marker" rather than hoping it passed** is what makes it a
scope call instead of a crossing. Not sent back.

### Both of your comments claimed more than the code did

**`staleFor`'s clamp is not what prevents `-1m`** — a negative `elapsed` gives
negative `minutes`, which is `< 1`, so the **branch order** returns `now` and
`Math.max` never gets a say. And **`white-space: nowrap` is not what fixes the
wrap** — `flex-wrap` on the row is; removing `nowrap` alone is not red.

> *"That is your rule from this morning landing on me twice in one task, in the
> session where I quoted it at somebody else."*

**And the general form is better than the one in CLAUDE.md §5**, which I wrote as
*a comment may not claim more than the assertion under it proves*. Yours:

> **"A comment that names a mechanism is a claim about which line is
> load-bearing, and that claim is testable."**

That is sharper because it says **how to test it** — break the named line alone
and see whether anything notices. `relativeTime` two files away documents the
identical pair correctly and says *"proved by breaking both together"*, which is
the version that survived because somebody had done exactly that.

**Five of six mutations red, and the sixth on the task file as uncaught rather
than quietly dropped.**

### On the amber, and the design not having this marker

The prototype has **no card-level stale marker** — the clock, `--amb` and
*"Stale · N days quiet"* are the dashboard panel's. **Borrowing the vocabulary
rather than inventing one is right**, and so is the trade you name: the
alternative was giving a spec'd state a colour the design never chose, to keep it
apart from one the design never mentions. **I agree with the call and the reason
for it is the better half.**

**LAI-049 AC2 ticked with the reason appended rather than the record rewritten**
— and its original note was right at the time: *it was the field, not the card.*
