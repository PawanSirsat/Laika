---
id: LAI-732
title: 'Dashboard: the range applies to Status overview and Work by person, and each card has its own filter'
area: web
assignee: owner-direct
priority: p1
depends-on: [LAI-724]
status: review
started: 2026-10-08T17:22:23Z
finished: 2026-10-08T17:48:21Z
---

## Goal

Made on the owner's direct instruction. With screenshots of the production
Dashboard, the owner: *"this is the filter on top in dashboard but when i click
on that nothing change in the page the stat i mean changed but not this section
in the status overview and the work by person section also add more filter in
that but in that make sense there only also in others in compact popup so user
can select that"*.

The range buttons (Last 24 hours / 7 days / 30 days / All time) change the
four stat cards and nothing else. **Status overview** and **Work by person**
count the whole project whatever range is chosen. Make the range apply to both,
and give each card a compact filter of its own.

The owner did not answer which rule the range should use; the default proposed
to them is taken: **a card counts the tasks updated within the range** — the
rule of the "N updated" stat card.

## Scope — the exact files

- new `server/web/src/routes/screens/dashboard/card-filters.ts` — reading the
  per-card URL params and deriving each card's task set
- new `server/web/src/routes/screens/dashboard/CardFilter.tsx` — the per-card
  icon button and compact popover
- `server/web/src/routes/screens/dashboard/DashboardScreen.tsx`,
  `StatusOverview.tsx`, `WorkByPerson.tsx`, `summary-derive.ts`,
  `dashboard.css`
- tests: new `server/web/test/routes/screens/dashboard/card-filters.test.ts`,
  new `server/web/test/browser/dashboard-card-filters.test.ts`
- `logs/perf-2026-10-08.md` — this task's log

## Acceptance criteria

- [x] With a range other than All time, Status overview and Work by person
      count only tasks updated within it; All time with no card filter shows
      exactly what they show today (cancelled excluded with its note, open work
      per person, the Unassigned row).
- [x] Each card's subtitle says what it covers ("41 tasks updated in the last
      7 days", an "all time" override, the number of card filters).
- [x] Each card has a filter icon with an active-count badge that opens a
      compact popover: Status overview — Sprint (Any / Active / a sprint),
      Assignee (Anyone / Unassigned / a member), Priority, Label, Agent-created
      only, Range (follow the dashboard / all tasks); Work by person — Sprint,
      Priority, Label, statuses (open only / include done), Range.
- [x] The popover has Clear, closes on Escape and outside click, takes and
      returns focus, works in both themes, and looks like the Board's Filter
      popover.
- [x] Each card's filters live in the URL under its own prefix (`so_`, `wp_`);
      a refresh or a shared link keeps them; an invalid value is ignored and not
      counted (LAI-487).
- [x] No new whole-project walk and no new endpoint: the cards read the store's
      task set.
- [x] Unit tests for the derivations (range × each filter), browser tests for
      the popovers and for the range moving both cards, each red on the code
      before this task.
- [x] Screenshots, light and dark, in `/tmp/laika-dashboard-shots/`.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 after the
      last edit.

## Notes / context

- **No shared Dropdown on this branch.** It is being built on
  build-ui-dropdown. The popover uses the Board Filter popover's field styling
  (native selects in labelled cells), behind one `CardField` component, so the
  integration step can swap the controls for the Dropdown in one place.
- Nothing is pushed from this branch.

## Built

On the owner's direct instruction. Details in `logs/perf-2026-10-08.md`
(entry 17:48Z).

- **The range.** A card counts the tasks updated on or after the range's start
  (`card-filters.ts` `cardTasks`); All time applies no bound, and with no card
  filter returns the set itself, so the cards are exactly today's.
- **The filters.** `so_sprint`, `so_assignee`, `so_priority`, `so_tag`,
  `so_agent`, `so_range`; `wp_sprint`, `wp_priority`, `wp_tag`, `wp_status`,
  `wp_range`. Invalid values ignored and not counted.
- **Read from the store's task set**; the sprint list is the cached read the
  shell already makes. No new walk, no new endpoint.
- **Dropdown:** none on this branch. `CardField` / `CardSelect` in
  `CardFilter.tsx` are the one place the integration step swaps for it.
- **Correction:** `started` was filed as 15:20Z, a guess; the filing commit is
  17:22:23Z.
- **The gate criterion is ticked on the gate run after this commit** (the
  report), on the HEAD that carries this file.

## Review notes (round 1)

**Review: APPROVE, nothing blocking** (2026-10-08, relayed by the
orchestrator). Follow-ups made as new commits on build-perf-store, after
`git merge master` (da87fd7, release 2, with LAI-726's Dropdown; clean merge):

1. **The Dropdown is in.** `CardSelect` renders `components/Dropdown.tsx`; no
   native `<select>` is left, and `no-native-select.test.ts` passes without
   excluding any dashboard file. This supersedes the "no shared Dropdown on
   this branch" notes above. The popover ignores clicks in the portalled panel
   and an Escape the panel used, as BoardToolbar does.
2. **Focus bug fixed.** With a filter set, opening the popover focused Clear,
   so Enter wiped the filters. Focus now goes to the first field, on open and
   after Clear. Test red on 0234534 (focus was on `BUTTON.dcf-clear`).
3. **Test gap:** a screen test that goes red if `DashboardScreen` judges
   blocked from `peopleTasks` instead of the whole project.
4. **Test gap:** the range bound is exact, `updated_at == since` kept and
   `since - 1` excluded; red if `<` becomes `<=`.
