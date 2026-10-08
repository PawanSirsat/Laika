---
id: LAI-732
title: 'Dashboard: the range applies to Status overview and Work by person, and each card has its own filter'
area: web
assignee: owner-direct
priority: p1
depends-on: [LAI-724]
status: in-progress
started: 2026-10-08T15:20:00Z
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

- [ ] With a range other than All time, Status overview and Work by person
      count only tasks updated within it; All time with no card filter shows
      exactly what they show today (cancelled excluded with its note, open work
      per person, the Unassigned row).
- [ ] Each card's subtitle says what it covers ("41 tasks updated in the last
      7 days", an "all time" override, the number of card filters).
- [ ] Each card has a filter icon with an active-count badge that opens a
      compact popover: Status overview — Sprint (Any / Active / a sprint),
      Assignee (Anyone / Unassigned / a member), Priority, Label, Agent-created
      only, Range (follow the dashboard / all tasks); Work by person — Sprint,
      Priority, Label, statuses (open only / include done), Range.
- [ ] The popover has Clear, closes on Escape and outside click, takes and
      returns focus, works in both themes, and looks like the Board's Filter
      popover.
- [ ] Each card's filters live in the URL under its own prefix (`so_`, `wp_`);
      a refresh or a shared link keeps them; an invalid value is ignored and not
      counted (LAI-487).
- [ ] No new whole-project walk and no new endpoint: the cards read the store's
      task set.
- [ ] Unit tests for the derivations (range × each filter), browser tests for
      the popovers and for the range moving both cards, each red on the code
      before this task.
- [ ] Screenshots, light and dark, in `/tmp/laika-dashboard-shots/`.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 after the
      last edit.

## Notes / context

- **No shared Dropdown on this branch.** It is being built on
  build-ui-dropdown. The popover uses the Board Filter popover's field styling
  (native selects in labelled cells), behind one `CardField` component, so the
  integration step can swap the controls for the Dropdown in one place.
- Nothing is pushed from this branch.
