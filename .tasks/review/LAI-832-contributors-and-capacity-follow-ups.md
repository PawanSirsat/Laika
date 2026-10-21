---
id: LAI-832
title: 'Contributors and Capacity follow-ups: backlog shown apart at 390, one stale rule everywhere, exact Delivered wording, tab overflow, untested cases'
area: web
assignee: chief
priority: p2
depends-on: [LAI-817, LAI-818]
discovered-from: LAI-817
status: review
started: 2026-10-21T05:37:16Z
finished: 2026-10-21T07:06:45Z
---

## Goal

Close the non-blocking findings from the LAI-817 and LAI-818 reviews
(2026-10-21) so the Dashboard and Capacity say exactly what they count
(D-092).

## Acceptance criteria

- [x] **Backlog shown apart on Open work now (D-092 §3).** The person count
      excludes backlog, the same way review is already left out, or the
      backlog part stays visible at 390 px. Today the detail line is cut off,
      so 78 reads as load when about 50 of it is backlog.
- [x] **One stale rule (D-092 §4).** `board-derive.ts` `STALE_DAYS` (5 days
      untouched) still drives the Activity screen's stale panel
      (`ActivityPanels.tsx`) and the List's amber marker (`list-derive.ts`).
      Both use the server's `stale_flagged_at` instead. Remove the client
      rule.
- [x] **Delivered wording.** The footnote and column title say "moved into
      review, or straight into done" (`Contributors.tsx`). The All-time empty
      state reads properly instead of "…or done all time."
- [x] **Needs attention tabs at 390.** The third tab's count no longer runs
      into the card edge (`.dash-tabs` in `dashboard.css`).
      *Already true on master (LAI-828, `3ed7e698`); now held by a test.*
- [x] **Review wait does not move with the range.** "Waiting for review >
      5 days" uses the real time of the move into review. Today it falls back
      to `min(updated_at, rangeStart)`, so a task 10 days in review drops out
      on "Last 24 hours".
      *Limit: for every reader `GET /review` answers (task.write, the org's
      oldest 200). A viewer and a task past the 200 still fall back: LAI-850.*
- [x] **Tests for cases that work but are untested:**
      - two people moving the same task into review;
      - a reader who can see one space but not another, checking that their
        overall Capacity load leaves the hidden space out;
      - the drift check comparing `extends CapacityWorkload`.
- [x] **Capacity's "No work" chip versus the "No load" badge.** Decide
      whether the chip becomes "No load". Write the decision and its reason
      in this file.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
      *Not ticked by the builder: root run 1 exited 1 on two server load
      timeouts, both green alone. The final run is after this commit, in the
      PR. See Result.*

## Named cross-area edits (D-033)

The task's area is `web`. One criterion needs a test outside it, and nothing
else crosses:

- **`server/test/services/presence.test.ts`** — one new test case, *"leaves a
  space the reader cannot see out of the overall load"*, in `describe('capacity
  per person (LAI-767)') > describe('workload')`. It asserts what
  `capacityNow` already does; **no `server/src/` file is changed.**

Not crossed: `docs/`. The SPEC wording this task makes stale is listed for
CHIEF in the Result, not edited.

## Result (builder for CHIEF, 2026-10-21)

Card **LAIKA-629** (`start_working` with branch
`LAI-832-contributors-capacity-follow-ups`). Commits `bf490029..HEAD`.

### Per criterion

- **Backlog shown apart (D-092 §3).** I chose the first option: **the person
  count excludes backlog.** On Open work now a person's number is now their
  load, to do plus in progress, which is Capacity's rule
  (`summary-derive.ts` `workloadByPerson`, `PersonLoad.backlog`,
  `Workload.backlog`). Their backlog has its own line, *+42 in backlog*
  (`.dash-legend-backlog`), and the ring has a faint **Backlog** share between
  the people and *Waiting for review*; its legend row opens the List filtered
  to backlog. The count's own detail line now wraps as well: at 390 px it cut
  *11 blocked*. The browser test checks every line under every name at 1440
  and 390, on our font and on a wider one (letter-spacing 0.12em), and found
  nothing cut. Per-person *blocked* now counts only committed work, so it
  matches the count it sits under.
- **One stale rule (D-092 §4).** `board-derive.ts` now has `isStale()`
  (open, and `stale_flagged_at` set) and `staleTasks()` (longest-flagged
  first, uncapped). `STALE_DAYS` and `ageDays` are gone. The Activity tab's
  Stale panel and header count use them; the panel says *stale 4d* from the
  flag. It was capped at six by `updated_at`, so the header could never say
  more than 6. The List's amber is `isStale()`, ahead of the
  under-an-hour accent, and the cell's hover says *flagged stale 1d ago*.
  The Dashboard reads the same function; `summary-derive.ts`'s own copy is
  gone. Census, not a sample: `grep -rni stale server/web/src` (every hit
  read) finds no other client stale rule. The rest are the word used for
  caches, the board's refresh, the editor's stale text and My day's drafts.
- **Delivered wording.** The footnote and the column's title say *moved into
  review, or straight into done* (`Contributors.tsx` `DELIVERED_RULE`). On
  All time the footnote leaves the range out, and the empty state reads
  *Nobody has moved work into review, or straight into done, yet.* (or
  *Nothing in this card's scope has been delivered or reviewed yet.* with a
  filter). Other ranges keep *in the last 7 days.*
- **Needs attention tabs at 390.** **Already fixed on master** by LAI-828's
  `3ed7e698`, after this task was filed: `.dash-tabs` wraps, so *Waiting for
  review > 5 days 37* drops to its own line. Screenshots before any change of
  mine at 390 and 360, and at 390 on the wider font, show nothing at the card
  edge. **No CSS change.** A browser test now holds every tab and count inside
  the card's content box at 390 on both fonts, with no sideways scroll, and
  asserts the three tabs' accessible names. Mutation `nowrap` → red.
- **Review wait does not move with the range.** `waitingForReview` takes a
  `queued` map of task → `waiting_since` from `GET /review`. The Dashboard
  builds it from the shell's existing read (`useShell().reviewQueue`, the
  sidebar badge's request), so it adds no request. The time used is the later
  of the queue's and the range's own move, because the queue can be up to a
  minute old after a send-back. With neither, it falls back as before.
  **No server change:** the API already returns the time. **Limit:**
  `GET /review` covers projects where the reader holds `task.write`, and the
  org's oldest 200. A project viewer, and a task past the 200, still fall back
  to the range. A fix for them is a served field on the task view: SPEC §6.4
  plus server plus web, three owners. Filed as **LAI-850**.
- **Untested cases, now tested.**
  - Two people moving one task into review: `contributors-derive.test.ts`.
    Ada and Bob each delivered it once; Cat's send-back and accept are one
    review; Ada closing it is a review, Bob closing it is not.
  - A reader who sees one space and not another:
    `server/test/services/presence.test.ts`, *leaves a space the reader cannot
    see out of the overall load*. Ada is Heavy (28 committed) to an admin, and
    Light (1, Laika's only) to a Laika member who cannot read Secret.
  - The drift check now compares `extends CapacityWorkload`:
    `web/test/api/presence.test.ts` `heritageOf`. The three mirrored
    interfaces must extend what the server's extend. Controls show it parses
    both sides, and on a copy with the `extends` dropped it catches what the
    own-field check misses.
- **No work → No load.** See the decision below.

### Decision: Capacity's chip is *No load*

The chip was *No work*: no open work at all. The badge beside it says *No
load*: nothing committed. A person with 50 in backlog therefore read *No load*
on their card and was left out of *No work*. **The chip is now *No load*, and
passes when `loadIn(person, space)` is `'none'`**: the server's own load, and
that space's when one is selected, as *Heavy load* already does
(`capacity-derive.ts`). Reason: D-092 §3 says backlog is the pipeline and
review waits on the reviewer, so "who has room" is who has nothing committed.
One word for one rule on one card is §5's *labels say what they count*. The
filter id stays `none`, so a saved address still opens it. The other way,
renaming the badge to *No work*, was rejected: LAI-818's reviewer accepted
*No load* because *No work* "would say something the counts beside it deny".

### Named cross-area edits (D-033)

`server/test/services/presence.test.ts`: one test case, listed above the
work in this file (commit `0962e200`) before it was made (`6de95b1e`). **No
`server/src/` file changed.** No `docs/` change.

### SPEC wording for CHIEF (not edited)

- **§11.4.2.1, Capacity:** filter chips *… Overdue*, ***No work***, *Never
  seen* → ***No load*** (nothing committed in the selected space; backlog and
  review do not count).
- **§11.4.2.1, Dashboard** (*"a donut of open work by person … needs attention
  (blocked and stale, true counts)"*): open work now counts to do and in
  progress per person, with backlog and waiting for review as their own
  shares. Stale is the server's flag on every screen (Dashboard, Activity,
  List). Needs attention has *Waiting for review > 5 days*, from the review
  queue's time of the move.
- **§11.4.2 screen map, Dashboard row:** it now also reads `GET /review`,
  through the shell's existing request.

### Tests and proof

Each test was red on the old code, or proved by mutation where the old code
already passed:

| mutant (each confirmed landed by grep, restored by checksum) | file(s) run | result |
| --- | --- | --- |
| M1 `isStale` back to five quiet days | board-derive, list-derive, activity-tab | exit 1, 5 failed |
| M2 backlog back in the person count | summary-derive, dashboard-contributors | exit 1, 6 failed |
| M3 the review queue ignored | summary-derive, dashboard-contributors | exit 1, 2 failed |
| M4 *No load* back to `open === 0` | capacity-derive | exit 1, 2 failed |
| M5 the first deliverer kept, not the last | contributors-derive | exit 1, 1 failed |
| M6 client `extends Omit<CapacityWorkload, 'backlog'>` | api/presence | exit 1, 3 failed |
| M7 one visibility answer for every space (server) | server presence.test.ts | exit 1, 1 of 67 failed (the new test only) |
| M8 `.dash-tabs` `nowrap` | dashboard-contributors (tab test) | exit 1, 1 failed |
| M9 the old Delivered wording | dashboard-contributors (wording) | exit 1, 2 failed |
| M10 the count's detail ellipsised again | dashboard-contributors (backlog test) | exit 1, 1 failed |

Red before the fix, unmutated: capacity-derive (2), summary-derive (5),
board-derive (would not import `isStale`), list-derive (2). The two-deliverer
and `extends` tests passed on today's code, as expected, since the task called
those cases working but untested. M5 and M6 prove they bite.

Each intermediate commit was typechecked from `git archive` of that commit
(`tsc -p server/web/tsconfig.json --noEmit` → 0 at `3fb33617`, `5dcfea47`,
`da520a7b`).

Screenshots, light and dark, 1440 and 390: `/tmp/laika-832-shots/`. They
show the tabs before (390, 360, 390 on the wider font), and after for
Delivered, Open work now, Needs attention and Capacity.

### Gate

Run 1, from the worktree root, after `pnpm format:fix` (exit 0, nothing
rewritten), on `35fa28bd`:

- `pnpm test > /tmp/lai832-gate.txt 2>&1` → **TEST 1.** Web: 2655 tests,
  2655 pass, 0 fail. cli: 535, 533 pass, 0 fail, 2 skipped. Server:
  `Test Files 2 failed | 163 passed | 2 skipped (167)`,
  `Tests 1 failed | 3372 passed | 13 skipped (3386)`. Both failures are
  timeouts in files this branch does not touch:
  - `test/tooling/build.test.ts > the build is idempotent (LAI-028) >
    produces an identical tree on a second run with no clean between`:
    `Test timed out in 120000ms`;
  - `test/tooling/environment-posture.test.ts > the list of differences
    stays honest`: `Hook timed out in 60000ms`.
- Re-run alone, load average about 40 (four builders on this machine):
  `npx vitest run test/tooling/environment-posture.test.ts` → **0**
  (13/13); `npx vitest run test/tooling/build.test.ts` → **0** (16/16).
- `pnpm lint` → **0** (run on the finished code before it was committed).

The final root run of all three comes after this file and the log, so that
nothing is edited after it. Its exit codes are in the PR and in the board's
`finish_task`.

### Discovered

- **LAI-850** (server, p3): the review wait is exact only where `GET /review`
  answers.
- **LAI-851** (web, p3): Needs attention's titles start after each row's own
  key, so `OR-104` and `OR-21` start their titles at different places.
- The Activity tab's Stale panel was capped at six (`.slice(0, 6)`), so its
  header could never say more than 6 stale tasks: a cap the label did not
  admit (D-092 §5). Fixed here by listing what the server flagged, uncapped,
  in the panel's own scroll.
