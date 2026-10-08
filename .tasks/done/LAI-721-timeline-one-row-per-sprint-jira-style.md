---
id: LAI-721
title: 'Timeline, Jira-style: one row per sprint on a left-right scrolling axis, tasks only when a sprint is opened'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: done
started: 2026-10-08T11:18:42Z
finished: 2026-10-08T17:36:11Z
---

## Goal

Made on the owner's direct instruction, batch 2 of the UI polish series, on
branch `build-ui-polish` (not pushed; the owner releases the batch in one
push). The builder is a single agent working the way `docs/HANDOVER.md` §4
describes.

The owner, 2026-10-08, with five screenshots of production's Timeline (one row
per task, hundreds of rows, a squeezed axis): *"I want left-right scrollable,
but not with all the tasks — by the sprints, like Jira, with all the UI/UX like
that. I don't want the tasks in time."*

When this is finished the Timeline reads like Jira's: one row per sprint with a
bar across its dates, on an axis that scrolls sideways at a chosen zoom, today
marked; a sprint opens to list its tasks, which have no bars. That is SPEC
§11.4.3 as written — "each sprint is one bar", "Expanding a sprint lists its
tasks. Tasks have no bars of their own" — which D-049 had overridden.

## Scope — the exact files (CLAUDE.md §1)

- `server/web/src/routes/screens/timeline/TimelineScreen.tsx`
- `server/web/src/routes/screens/timeline/timeline.css`
- `server/web/src/routes/screens/timeline/timeline-derive.ts`
- `server/web/src/routes/screens/timeline/use-timeline.ts` (new) — the
  on-demand data hook
- `server/web/test/routes/screens/timeline/timeline-derive.test.ts`
- `server/web/test/browser/timeline-bars.test.ts` — rewritten for sprint rows
- `server/web/test/browser/timeline-blocked-and-tabs.test.ts` — rewritten or
  removed: it asserts task bars and the sprint-chip strip this task removes
- `server/web/test/browser/timeline-sprints.test.ts` (new)
- `docs/DECISIONS.md` — one new entry, withdrawing D-049's task rows

## Acceptance criteria

- [x] One row per sprint, in date order. No row per task on the axis.
- [x] Each sprint row's left column names it (`S4` and its name), its dates
      and its state (active, ended, planned); its bar spans `starts_on` to
      `ends_on` on the axis. Once a sprint is opened and its tasks are loaded,
      its row and bar show progress (`done/total`) and a blocked count.
- [x] **No whole-project walk** (owner's orchestrator, 2026-10-08): only the
      sprint list loads up front; an opened sprint's tasks are fetched with
      `?sprint=<id>`, and the Unscheduled tray's with `?sprint=none` when it is
      opened. Asserted on the requests the page makes.
- [x] The axis scrolls left and right inside the card; the sprint column stays
      put while it does; the header (months, then weeks or months) stays put
      while rows scroll.
- [x] Zoom: Weeks, Months, Quarters. A **Today** button brings today into view;
      on open the chart is scrolled so today is in view.
- [x] Today is one vertical line with a label, across the header and rows.
- [x] A sprint opens and closes by its chevron (keyboard reachable,
      `aria-expanded`); opened, it lists its tasks — key, title, status,
      assignee — with no bar per task. A task opens in the task drawer.
- [x] Sprints are collapsed on open, except one named by `?sprint=`.
- [x] Past sprints are dimmed, not hidden (§11.4.3); the unscheduled tray
      stays below the chart.
- [x] Design tokens only; both themes verified by screenshot; fits 1366 wide
      with no page-level horizontal scroll.
- [x] Browser tests for: one row per sprint and none per task, bar geometry
      against the dates, horizontal scrolling with the sprint column fixed,
      zoom changing the scale, expand/collapse, and Today — each shown to fail
      against the old screen.
- [x] The repo-root gate is green: `pnpm test`, `pnpm lint`, `pnpm format` each
      exit 0, run after the last edit.

## Notes / context

- **Data: on demand, not `useSprints`.** `useSprints` walks every task with
  full markdown (`use-sprints.ts`), and a later performance phase will replace
  the client data layer; this screen must not add a walk. The sprints carry no
  counts and the tasks endpoint has no count or field projection, so progress
  needs a sprint's tasks: they are fetched when the sprint is opened, with the
  existing `sprint` filter. *Expand all* is an explicit request for every
  sprint's tasks. No new endpoint, no new dependency.
- Read-only, as today: dragging a sprint edge and dragging from the tray are
  still not built (§11.4.3 lists them; out of scope here).

## Released, 2026-10-08

Claimed and released the same day, before any code was committed: LAI-717 came
back from review and one task is in progress at a time (CLAUDE.md §2). The
builder's draft (`TimelineScreen.tsx`, `timeline-derive.ts`) is kept outside
the repo and is re-claimed as soon as LAI-717 is back in review.

## Re-claimed, 2026-10-08T11:18:42Z

On the go-ahead after LAI-717 went to review. If LAI-717 comes back with
changes, those take priority: this task pauses at a clean commit, and having
two tasks in progress for that reason is recorded in both files.

## Builder's notes (2026-10-08T12:32:37Z)

- **Data, on demand** (`use-timeline.ts`): sprints only up front; a sprint's
  tasks via `?sprint=<id>` when opened; the tray via `?sprint=none` when
  opened. The stub in `timeline-sprints.test.ts` refuses any task request that
  names no sprint, so a walk would fail the run. Why not more: sprints carry
  no counts and the tasks endpoint has no count or field projection, so a
  sprint's progress shows once it is opened (D-074 §4).
- **D-074** recorded; it was the next free number on every branch at writing.
- **Tests:** `timeline-sprints.test.ts` (11) and `timeline-derive.test.ts`
  (26). All 11 browser tests fail on the old screen, though uniformly at its
  first wait (the old screen has no sprint rows). The behaviours are proven by
  mutation instead: tasks walked up front, a non-sticky sprint column, zoom
  ignored, no scroll to today — each fails its test.
- `timeline-bars.test.ts` and `timeline-blocked-and-tabs.test.ts` removed:
  they asserted task bars and the sprint-chip strip this replaces.
- The today pill sits in the header's lower row, so it never hides a month's
  or quarter's name.
- Discovered, not done: LAI-725 (the space bar's filters show on the Timeline
  and filter nothing — true before this task too).

## Review notes (round 1)

Reviewed 2026-10-08: CHANGES REQUIRED. The full gate on `be39c52` was run by
the reviewer and confirmed: TEST 0 / LINT 0 / FMT 0. Unticked: 2 (counts only
after opening), 4 (the header test cannot fail), 6 (pill and line can show
different days), 11 (tests that cannot fail).

Blocking
1. The header test cannot fail: `.tlx` does not scroll vertically, so
   `scrollTop += 40` stays 0. Make it scroll, assert `scrollTop > 0`, prove
   it fails with the sticky rule removed.
2. A stale comment in `timeline-derive.test.ts` describes D-049's task bars;
   delete it.

Should-fix
3. Bad or far-future dates break the axis (2062: 1.1 s per click; 9999: ~75 s
   a render, 416k ticks; 1e17: no header, "Invalid Date"). Exclude invalid
   sprints with a notice, clamp the window, format a band label only when a
   band starts, memoise bands and ticks. Tests for 2062, 9999, 1e17 with a
   render-time bound.
4. Blocked undercounts: `undefined` (a blocker elsewhere) is dropped. Show
   unknowns ("1 blocked · 2 unknown"), on the bar and the task row; test.
5. Today pill (local date) and line (UTC) can disagree. Format the pill from
   `startOfDay(now)` in UTC; test with a fixed clock near midnight.
6. Opened sprints never refresh. Watch `useLive().generation`, debounce,
   reload sprints and every opened key; a drawer edit updates its row. Keep
   `use-timeline.ts`'s API narrow (open keys, tasks for key) — it becomes a
   view over the per-project store build-perf-store is introducing.
7. `?sprint=`: open only ids in `rows` (ignore `all`, `none`); scroll to that
   sprint's start on first open; test both.
8. Counts without opening (§11.4.3): serve `task_counts` on the REST sprint
   list from `sprintTaskCounts` (one grouped query, `can()`-checked as the
   list is), update SPEC §6.4's sprint shape, keep the drift check green, show
   done/total (and blocked) on every bar. Server and client tests.
   **Owner-directed widening into `server/src`** — files named below.
9. D-074 said "§11.4.3 as written"; it is not (single track, tray beside, no
   zoom, name+goal+counts on the bar). Append a correction; update §11.4.3 to
   describe the screen as built.

Nits: drop the dashed span band on task rows; neutral unassigned avatar;
today pill must not cover tick labels; sticky month label clipping at Weeks;
Quarters axis ends at the quarter's end; one vertical scroller; keyboard
panning on the chart and one tab stop per sprint; Expand all at most 3
requests at once; respect `truncated` with a notice; remove dead
`sprintSummary.wip` and the dead strip describe; `use-timeline.ts` races
(`signal.aborted` in `.then`, `.finally` deletes only its own controller);
missing tests — empty state, "No tasks in this sprint", error and retry,
per-task Blocked.

### Scope widened for round 1 (named files, owner-directed)

- `server/src/services/sprints.ts` — `task_counts` on the sprint list view
- `server/src/http/routes/sprints.ts` — serve it on `GET /projects/:slug/sprints`
- `server/test/…` — a test for the field's shape and counts
- `server/web/src/api/sprints.ts` — the client `Sprint` type gains the field
- `docs/SPEC.md` — §6.4's sprint shape and §11.4.3's text
- `docs/DECISIONS.md` — a correction appended to D-074

## Round 1 — what changed (2026-10-08T13:35:49Z)

Blocking
1. Header test really scrolls: 520px tall with S2 open, asserts `scrollTop > 0`
   first (`timeline-sprints.test.ts:333`). Fails with `.tlx-head` not sticky,
   and with the chart grown to its content (positive control, 0px).
2. The stale D-049 comment and the dead strip describe are gone from
   `timeline-derive.test.ts`.

Should-fix
3. `onAxis` (`timeline-derive.ts:86`, ±5 years, finite, not backwards) keeps
   2062 / 9999 / 1e17 off the axis and lists them in a notice
   (`TimelineScreen.tsx:326`); `chartWindow` bounded by it; `bands()` formats
   a label once per band (`:190`); header memoised (`TimelineScreen.tsx:208`).
   Browser test with all three plus time bounds (`:736`); unit test counts the
   formatter calls and times the widest window. On be39c52 "a bad sprint was
   drawn"; `onAxis` always true fails three unit tests; formatting per day
   fails the per-band count.
4. Blocked unknowns: `blockedTally` (`:269`), "1 blocked · 1 unknown" on the
   bar, "Blocked?" on the row (`TimelineScreen.tsx:791`). Fails on be39c52;
   counting `undefined` as unblocked fails the unit test.
5. `todayLabel` formats `startOfDay(now)` in UTC (`:234`). Browser test at
   23:30 UTC in Pacific/Auckland fails on be39c52; the unit test checks Los
   Angeles, Auckland and UTC, and fails with `timeZone` removed.
6. Live: `useLive().generation`, 500 ms settle, refetches sprints and every
   open key (`use-timeline.ts:76`); API narrowed to open keys in, tasks for a
   key out; comment that it becomes a view over build-perf-store's store.
   Test renames a task through the stream; fails on be39c52.
7. `?sprint=` opens only an id in `rows` (`TimelineScreen.tsx:229`) and scrolls
   to its start; `all`, `none` and junk open nothing and ask nothing. Both fail
   on be39c52 ("sprint=all asked for ?sprint=all&limit=200").
8. `task_counts` on `GET /projects/:slug/sprints`: `withTaskCounts`
   (`server/src/services/sprints.ts:304`) over `sprintTaskCounts`, one grouped
   query behind the list's `project.read`; route `:111`; server test (`:287`)
   fails when the route serves the bare page. Client `Sprint.task_counts`
   (optional — only the list sends it), drift pair `SprintListView`↔`Sprint`
   (named `*View` so the server's response-type census counts it; the nested
   counts are unpaired, as `ProjectSummary`'s are). Every bar shows done/total unopened; fails on
   be39c52. SPEC §6.4 documents the field.
9. D-074 correction appended; SPEC §11.4.3 rewritten as built.

Nits — all done: no band on task rows; neutral unassigned mark; tick labels
give way to the pill; month labels whole or absent; Quarters end at a
quarter's end; one vertical scroller; the chart is a tab stop the arrow keys
pan, one tab stop per sprint; Expand all ≤ 3 requests (test peaks ≤ 3, ≥ 2);
`truncated` shown; dead `sprintSummary`/`wip` removed; `.then` checks
`aborted`, `.finally` deletes only its own controller; tests for the empty
project, an empty sprint, errors and retries (sprint list and one sprint),
per-task Blocked. Narrow bars keep their key; count and blocked note move
past the bar's end when they do not fit.

Proof: the 28 browser tests against be39c52 — 14 fail for their own reason;
the 14 that pass there were each made to fail by a targeted mutation of the
new code (header not sticky, chart unbounded, empty-sprint text, no empty
state, no retry, closed keys kept) or were proven in round 0. All restored,
checksums matched.

Note: `a98f7a3` landed with one lint error (a commit chained after lint's
output, not its exit code); fixed in `c6a5cc3`, not amended.

## Review notes (round 2)

Reviewed 2026-10-08: CHANGES REQUIRED, one blocker. The reviewer ran the full
gate on `e2eae8d`: TEST 0 / LINT 0 / FMT 0. Round 0 is fixed; the server
endpoint is sound. Unticked: 1 (valid distant sprints were hidden), 11 (two
header tests pass with no labels drawn).

Blocking
1. The month-label test passes with `{fits && (` → `{false && (`; the
   today-pill test passes with every tick and lower label blanked. Assert a
   visible label at each stop naming the month under the view's left edge,
   and a non-empty tick label on each side of the pill; prove both fail under
   those mutations.

Should-fix
2. SPEC §11.4.2.1 dropped "drag an edge to reschedule" — out of scope. Revert;
   mark it not built in §11.4.3's as-built note; file a backlog task for it.
3. Valid distant sprints hidden with the wrong advice. Exclude only non-dates
   and absurd values (beyond ±50 years); separate wording for "not a valid
   date" and "beyond the timeline's reach"; a sprint 6 years either side is
   drawn, with the window and tick count bounded by density, not by range.
   Tested, with a render bound.
4. "Blocked?" noise: skip done and cancelled tasks in the tally and the row;
   the bar says "N blocked?" to match the row. Tested.
5. The stale "§11.4.3 as written" comment at the top of `timeline-derive.ts`.

Nits: §11.4.3 says the today line runs across the header (only the pill
does); "one vertical scroller" is false with the tray open — fix the layout;
`taskRequests` attaches after `open()` — use `h.calls`, with a positive
control; time bounds may flake — measure work, keep any time bound ≥3× and
backed by a work count; the counts query covers the whole project on every
page — filter by the page's sprint ids, tested; "Blocked?" squeezes long
titles — an icon with a tooltip at narrow widths; live refresh — a minimum
interval between refetches.

## Round 2 — what changed (2026-10-08T17:36:11Z)

1. Label tests: the month test asserts a label in view at every stop naming
   the month under the left edge (`timeline-sprints.test.ts:485`); the pill
   test asserts labels either side (`:447`). Under `{false && (` → "no month
   named at scrollLeft 0"; with ticks blanked → "no label left of the pill".
2. SPEC §11.4.2.1 restored; §11.4.3 lists drag-to-reschedule as not built;
   LAI-731 filed.
3. `axisProblem` (`timeline-derive.ts:98`): `invalid` vs `beyond` (50 years),
   two notices (`TimelineScreen.tsx:334`, `:341`); bands/ticks step by month
   and week (`:207`, `:241`); header drawn only in view (`TimelineScreen.tsx:377`).
   Tests `:824`, `:848`; reach 5 years → fails; no virtualisation → 2169 ticks.
4. Blocked? skips done/cancelled (`timeline-derive.ts:302`,
   `TimelineScreen.tsx:773`); bar says "N blocked?". Fails on e2eae8d.
5. Stale comment corrected (`timeline-derive.ts:12`).
Nits: SPEC today line and tray text; tray is the chart's last group
(`TimelineScreen.tsx:586`, test `:901`); `h.calls` with positive controls;
time bounds backstopped by work counts; counts filtered to the page's sprints
(`server/src/services/sprints.ts:257`, test `server/test/services/sprints.test.ts:649`);
Blocked label whole-or-icon, gives way first (`timeline.css:494`);
refetches throttled ≥2 s (`use-timeline.ts:42`, tests `:1035`, `:1054`).

## Accepted

2026-10-08, by polly (orchestrator), for release 3. Review: APPROVED (round 3,
re-review of the round-2 fixes at d6b206c). Integrated on `build-release-3`
at merge 50e809a. Conflicts were append-only (`docs/DECISIONS.md` D-074 beside
D-075, the ui-polish log), and both sides were kept. On top of the merge:
`no-native-select.test.ts` scans the Timeline now (5ec03f9, f6d77f2). The new
Timeline has no native select. `use-timeline.ts` reads the shared project task
store when another screen already holds the set: no `?sprint=` request, with a
browser test that goes red when the store path is disabled. A cold Timeline
still reads on demand (D-074, 4).
