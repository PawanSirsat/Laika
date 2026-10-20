---
id: LAI-817
title: 'Dashboard: "Work by person" ranks open work instead of contribution, and Stale, Blocked, the donut and % done mislead'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-796
status: done
started: 2026-10-20T13:01:46Z
finished: 2026-10-20T19:17:51Z
---

## Goal

A space's dashboard answers "who contributed in this range" honestly, and
every other figure on it says what it counts. **D-092 is the contract.**

## Found (audit-metrics-sense, 2026-10-20, reproduced from production)

- **Work by person** (`server/web/src/routes/screens/dashboard/summary-derive.ts:140-164`,
  range filter `card-filters.ts:152-188`, wired `DashboardScreen.tsx:261-270`):
  open tasks with `updated_at` in range, by **current** assignee. In OnRoute
  over 7 days: Ashutosh 24 (14 review, 8 to do, 2 in progress, 7 blocked),
  Unassigned 15, Sakshi 7, Pawan 6.
- **Who actually delivered** (moves into review or done, by actor, with an
  agent credited to its token owner): 7 days Ashutosh 23, Pawan 3; 30 days /
  all time Pawan 168, Ashutosh 86, Sakshi 16. `task.status_changed` rows
  carry `actor_id`, `actor_kind` and `from`/`to`. The dashboard already loads
  the range's activity (`use-dashboard.ts:110-113`), and OnRoute's 3,848 rows
  fit under the 5,000-row client cap (`every-page.ts:18`).
- **Donut centre "52 open tasks"**: OnRoute has 301 open.
- **Stale 266** (`summary-derive.ts:225-239`) counts any open task more than
  5 days untouched. The server's rule (`jobs.ts:277-304`, §11.6) flags **7**.
  Of the 266, 37 are in review (median wait 8 days).
- **Blocked 30** is true, but 19 are backlog waiting on backlog.
- **"N updated"** is bumped by sprint moves, reorders, branch matches and PR
  links, so it really means "touched".
- **Status overview "% done"** is of tasks touched in the range: 15% on
  7 days against 42% project-wide.
- **Due dates**: only 2 of 301 open tasks have one.

## Acceptance criteria

- [x] **Contributors.** The card is titled "Contributors" or similar. It ranks
      people by **Delivered** in the range (D-092 item 1): an agent's move is
      credited to its token owner, and a task moved twice counts once. A
      **Reviewed** column sits beside it, and self-closes are footnoted. It is
      built web-only from the activity the screen already loads; no new
      endpoint.
- [x] **Open work now.** A second tab, **"Open work now"**, ignores the range
      and splits **waiting for review** out of each person's open work
      (D-092 item 2). Unassigned stays.
- [x] **Donut.** The donut centre and its label say what they count, for
      example "52 of 301 touched in 7 days", or the donut shows all open.
      Pick one and say why.
- [x] **Needs attention.**
      - **Stale** uses `stale_flagged_at`, the server's rule. Check that the
        task payload carries it; if not, stop and report.
      - Add a **"Waiting for review > 5 days"** entry.
      - **Blocked** counts to do and in progress, with backlog chains shown
        apart.
- [x] **Labels.** "Updated" is relabelled "touched". The status overview's
      centre shows project-wide % done, or is labelled "of tasks touched".
      The due tile says when few tasks have due dates.
- [x] **Tests.** They fail on today's code:
      - the contributor ranking from a fixture of status changes: an agent's
        move is credited to its owner, a task moved twice counts once, and a
        review→done by someone else counts as Reviewed;
      - Open work now ignores the range;
      - stale uses `stale_flagged_at`.
      Prove two by mutation.
- [x] **Screenshots.** Before and after, light and dark, 1440 and 390, in
      `/tmp/laika-dash-shots/`, with an OnRoute-like fixture.
- [x] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Builder notes (owner-direct, 2026-10-20/21)

Card on the board: **LAIKA-617** (`start_working` with branch
`LAI-817-dashboard-contributors`). Branch commits `cf42644f..c0e7a061`, plus
this file's move.

### What each criterion is, and where

- **Contributors** — `contributors-derive.ts` (pure) ranks by **Delivered**:
  distinct tasks moved into review, or into done without review, from the
  range's `task.status_changed` rows. It credits `actor_id`, which is the
  token's owner on an agent's row (`activityActor`, `resolve-actor.ts:212`).
  **Reviewed**: distinct tasks moved out of review (to done, or sent back) on
  work someone else delivered. The deliverer is the last move into review seen
  in the range, with the assignee standing in for a delivery made before it.
  Self-closes are counted and footnoted ("*N of them were closed without
  review"). Web-only, from the activity `use-dashboard.ts` already loads. The
  card is titled **Contributors**, with tabs **Delivered** and **Open work
  now**.
- **Open work now** — every open task, with no range, by assignee. A person's
  count is backlog, to do and in progress; their review work shows on its own
  line ("+34 waiting for review"). All review is one orange "Waiting for
  review" share. Unassigned stays.
- **Donut: I picked "shows all open".** The people donut is now Open work
  now's: centre "301 open tasks", with no range (D-092 item 2: open work is
  "now"). A sample of tasks touched this week is nobody's workload, so
  labelling the sample would still leave a misleading chart.
- **Needs attention** — **Stale** = open and `stale_flagged_at` set. The task
  payload carries it (`TaskSummary.stale_flagged_at`, `api/tasks.ts:112`), so
  there was no stop. **Waiting for review > 5 days** is a new tab: wait since
  the last move into review in the range, else the earlier of the range start
  and `updated_at`, which never overstates. **Blocked** counts to do and in
  progress; backlog and review chains are listed apart under "Not counted".
- **Labels** — "updated" → **touched** (with a hover saying what bumps it).
  The status centre says **"done of touched"** while the card counts the
  range's touched tasks, and "done" on All time or All tasks. The due tile adds
  "only 2 of 301 open tasks have a due date" when fewer than half are dated.

### Deliberate changes beyond the letter, each for the same reason

- The people card's filter lost **Range** and **Include done** (`wp_range`,
  `wp_status` are no longer read). Open work has no range, and done work is
  Delivered's, never open work's. A saved link with either opens unfiltered;
  `card-filters.test.ts` asserts that absence.
- Per-person "blocked" on Open work now uses the same committed rule as the
  Blocked tab, so the two never disagree.
- `MAX_PEOPLE` 5 → 4: orange is review's (the lane colour), which leaves four
  chip hues for named people.
- The user-facing copy on `/people` and the reachability reason now say
  "Contributors". **SPEC §11 line ~4111 still says "*Work by person* row"**:
  that is `docs/`, CHIEF's to reword.

### Numbers measured on the OnRoute-shaped fixture (`test/browser/onroute-dashboard.ts`)

Built from named groups; before-screens reproduce production exactly: Work by
person Ashutosh 24 / Unassigned 15 / Sakshi 7 / Pawan 6, centre 52, Stale 266,
Blocked 30, 17% done.

| range | Delivered (Reviewed) |
| --- | --- |
| 7 days | Ashutosh 23 (0), Pawan 3 (10), Sakshi 0 (1) — 1 self-close |
| 30 days | Pawan 168 (53), Ashutosh 86 (59), Sakshi 16 (1) — 26 self-closes |
| all time | the same as 30 days |

After: Open work now centre 301 under every range; Stale 7, Waiting for review
> 5 days 37, Blocked 11 with 19 apart; 63 touched in 7 days; "done of touched".

### LAI-823 (bulk imports) — not built here, not made awkward

`contributors()` counts whatever events it is handed, so excluding a bulk move
is a filter on `events` before the call (said in `DashboardScreen.tsx`).
Nothing in it knows a date.

### Tests (each file run alone, exit codes)

- `node --test test/routes/screens/dashboard/contributors-derive.test.ts` → 0 (13/13)
- `node --test test/routes/screens/dashboard/summary-derive.test.ts` → 0 (17/17)
- `node --test test/routes/screens/dashboard/card-filters.test.ts` → 0 (22/22)
- `node --test test/routes/screens/dashboard/dashboard-derive.test.ts` → 0 (27/27)
- `node --test test/routes/reachable.test.ts` → 0 (7/7)
- `node --test test/browser/dashboard-contributors.test.ts` → 0 (7/7)
- `node --test test/browser/dashboard-summary.test.ts` → 0 (10/10)
- `node --test test/browser/dashboard-card-filters.test.ts` → 0 (10/10)
- `node --test test/browser/member-profile.test.ts` → 0 (37/37)

They fail on today's code: the contributor tests cannot import a module that
did not exist, and the mutations below are the old rules put back.

### Mutations (each landed by checksum and grep, restored by checksum)

| mutant | file run | result |
| --- | --- | --- |
| M1 agent moves not credited (`actor_kind !== 'user'` skipped) | contributors-derive.test.ts | exit 1, 3 failed |
| M2 stale back to "open and 5 days untouched" | summary-derive.test.ts | exit 1, 1 failed |
| M3 Open work now follows the range | card-filters.test.ts | exit 1, 3 failed |
| M4 review text back inside the ellipsised detail | dashboard-contributors.test.ts | exit 1 ("cut by 167px") |

**M4 first survived.** The clipping check read an inline span's
`scrollWidth - clientWidth`, which is 0 for any inline element. It now
measures against the column's edge. The defect it guards was found by
screenshot, not by any test: the review split was cut off at both widths
while its text still matched.

### Gate — not all three 0; explained

- `pnpm test` → **1**. Web 2350/2353: three `member-profile.test.ts`
  assertions expected "active 2 min" and saw "3 min" (the clock moved under
  load). pnpm then killed the server and cli suites before they finished.
- Re-runs alone: `member-profile.test.ts` → 0 (37/37);
  `pnpm --filter @laika/server test` → 0 (160 files, 3294 tests).
- A second full run by mistake (`pnpm --filter laika test` matches the root
  package): web 2353/2353, cli 532 run / 0 failed, server 3 load timeouts
  (`build.test.ts` 120 s, `environment-posture` hook 60 s, `sign-in-throttle`
  5 s), all of which passed in the server-alone run.
- `pnpm lint` → 1 (two findings in my lines), fixed in `c0e7a061`, then
  `pnpm lint` → **0**, `pnpm format` → **0**. The fix came after the test
  gate; after it, `tsc --noEmit` → 0 and both touched unit files → 0.

### Screenshots

`/tmp/laika-dash-shots/`: `before-*` (7 days at 1440 and 390, light and dark;
30 days 1440 light) and `after-*` (the same, plus Open work now at both widths
and themes, Waiting for review at 1440, Blocked at 390 dark).

### Discovered

- ~~LAI-829~~ **filed and withdrawn the same sitting.** `create_task` with
  `external_ref: LAI-817` answered "already the outside id of LAIKA-617", and
  I read it as the call refusing its own new card. It was not: LAIKA-617's
  description ("Mirrors `.tasks/backlog/LAI-817-…` on master") is not the text
  I sent. The orchestrator's mirror made it between my `not_found` lookup and
  my create, and the refusal was correct. The id stays burned in the commits.
- `e36aed7a` carries `WorkByPerson.tsx → Contributors.tsx` as a pure rename
  (an earlier `git mv` was staged); `76107954` lands its content. The build is
  broken only at that one intermediate commit.

## Accepted (CHIEF, 2026-10-21)

Review (review-dashboard-contributors): APPROVE, no blocking issues. The
reviewer re-ran mutations M1 (agent credit) and M3 (open work following the
range) and both went red; probed Delivered for review twice, two people, a
self-close and agent moves, and all were right. Condition: the root gate must
pass on the merge commit, which CHIEF ran on master before pushing.

Correction to the builder's note: the build is red at two commits, not one
(`e36aed7a` and `76107954`; green again at `decaa947`). Bisect with
`--first-parent`. The member-profile minute flake predates this branch
(LAI-750/751) and is fixed under LAI-830. Non-blocking notes carried to
LAI-832. SPEC's "Work by person" wording updated by CHIEF.
