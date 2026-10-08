---
id: LAI-721
title: 'Timeline, Jira-style: one row per sprint on a left-right scrolling axis, tasks only when a sprint is opened'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-08T11:18:42Z
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
- [ ] Each sprint row's left column names it (`S4` and its name), its dates
      and its state (active, ended, planned); its bar spans `starts_on` to
      `ends_on` on the axis. Once a sprint is opened and its tasks are loaded,
      its row and bar show progress (`done/total`) and a blocked count.
- [x] **No whole-project walk** (owner's orchestrator, 2026-10-08): only the
      sprint list loads up front; an opened sprint's tasks are fetched with
      `?sprint=<id>`, and the Unscheduled tray's with `?sprint=none` when it is
      opened. Asserted on the requests the page makes.
- [ ] The axis scrolls left and right inside the card; the sprint column stays
      put while it does; the header (months, then weeks or months) stays put
      while rows scroll.
- [x] Zoom: Weeks, Months, Quarters. A **Today** button brings today into view;
      on open the chart is scrolled so today is in view.
- [ ] Today is one vertical line with a label, across the header and rows.
- [x] A sprint opens and closes by its chevron (keyboard reachable,
      `aria-expanded`); opened, it lists its tasks — key, title, status,
      assignee — with no bar per task. A task opens in the task drawer.
- [x] Sprints are collapsed on open, except one named by `?sprint=`.
- [x] Past sprints are dimmed, not hidden (§11.4.3); the unscheduled tray
      stays below the chart.
- [x] Design tokens only; both themes verified by screenshot; fits 1366 wide
      with no page-level horizontal scroll.
- [ ] Browser tests for: one row per sprint and none per task, bar geometry
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

