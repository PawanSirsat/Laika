---
id: LAI-718
title: 'View settings'' filter chips: remove a sprint the way the toolbar does, and name what they filter'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-717
status: backlog
---

## Goal

LAI-717 added removable chips under the board toolbar. View settings already
had its own chip list (`ViewSettings.tsx`, "Filter" section), and the two now
disagree in two ways:

1. **Removing the sprint chip means different things.** The toolbar chip goes
   through the popover's "Any" (`?sprint=all`, every sprint). The View-settings
   chip calls `setParam(key, undefined)` in `BoardScreen.tsx`, which deletes
   `?sprint=`. **Correction (LAI-717 review):** a missing `?sprint=` does not
   immediately mean the active sprint; the board re-applies its active-sprint
   default (LAI-713) only on re-entry or a reload. So the deleted key shows
   every sprint now and the active sprint later, while `sprint=all` keeps
   every sprint across a reload.
2. **The labels say less.** View settings shows `activeFilters` labels such as
   `Assignee` and `Sprint` with no name; the toolbar chips say
   `Assignee: Ada Lovelace` and `Sprint: S1 · Foundations` (`filter-chips.ts`).

3. **The same split sits inside the toolbar's own chip row** (LAI-717
   review): a sprint chip's × writes `sprint=all` (kept on reload), while the
   row's *Clear all* — `withoutFilters`, unchanged by LAI-717 — deletes the
   key, so the active sprint comes back on reload. The two now sit side by
   side. Decide whether *Clear all* should leave `sprint=all`, and make View
   settings match whichever is chosen.

## Acceptance criteria

- [ ] Removing the sprint chip in View settings leaves the same URL as
      removing it from the toolbar row (`sprint=all`), asserted in a browser
      test on `/board` with an active sprint.
- [ ] View settings' chips read the same labels as the toolbar row, from
      `filterChips`, not a second wording.
- [ ] No change to which filters exist or what they send.

## Notes / context

- Found while building LAI-717; not changed there because View settings was
  outside its named scope.
- The removal handler LAI-717 added is `removeFilter` in `BoardScreen.tsx`.
