---
id: LAI-1193
title: 'Shared accessible Tabs and Tooltip primitives; label the board and space icon-only buttons'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-11T09:00:00Z
finished: 2026-11-11T13:30:00Z
---

## Goal

One shared Tabs implementation (WAI-ARIA tabs pattern) and one Tooltip
primitive, with no new dependency, applied to the icon-only buttons of the
board toolbar and the space top bar (polly proposal: design-system-and-libraries
§Tabs/§Tooltip, visual-audit #4 and #6).

## Acceptance criteria

- [x] One Tabs implementation in `server/web/src/components/`: roving
      tabindex, Left/Right/Home/End, `aria-selected`/`aria-controls`, visible
      focus; duplicate tablists (census by untruncated grep) migrated onto it
      and their private keyboard code deleted.
- [x] Tab strips that scroll horizontally at 390px show an overflow fade on
      the clipped edge and scroll the active tab into view.
- [x] Organisation / People / Roles screen content unchanged (only the tab
      component they use may change).
- [x] One Tooltip primitive, no new dependency: hover and keyboard focus,
      a show delay, Escape dismisses, `aria-describedby`, never the only
      label, both themes, reduced motion, positioned with no inline style
      attribute (CSP checked in a browser test).
- [x] Every icon-only button in the board toolbar and space top bar has an
      `aria-label` and the Tooltip; no bare `title=` tooltip left on them.
      Other `title=` sites censused and listed as follow-ups, not fixed.
- [x] Browser keyboard tests for tabs and tooltip and unit tests; each
      mutated once to prove it fails.
- [x] `pnpm lint`, `pnpm format` and the new/changed tests exit 0;
      screenshots dark/light at 1440/390.

## Notes for review (SHELL, 2026-11-11)

- **`PageTabs`, `ViewTabs` and the profile's tabs are the *route* variant**:
  they keep `nav` + links + `aria-current` (design-system-and-libraries
  §Tabs) and get everything else from the shared strip — roving tabindex,
  Left/Right/Home/End, visible focus, fade and reveal. They have no
  `aria-selected`/`aria-controls` because each tab is an address read by the
  screen under it, and the five screens have no single panel element to
  name; giving them one would mean reshaping those screens (Organisation
  among them, which another task owns). The six local tablists carry the full
  pattern.
- **`DayTabs` has no `aria-controls`**: My day's sections are siblings in its
  grid, styled with `>` and `+` combinators; a wrapping `tabpanel` broke them
  (measured: `my-day-tabs.test.ts` went red) and overlaps PR #287. Follow-up.
- Merged `origin/integration-ui-transformation` (8e6a2249) on the owner's
  instruction; the census was re-run on the merged tree and the two new
  tablists (Usage Breakdown, profile Work tiles) and the profile nav were
  migrated.
