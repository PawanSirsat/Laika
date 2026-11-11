---
id: LAI-1193
title: 'Shared accessible Tabs and Tooltip primitives; label the board and space icon-only buttons'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T09:00:00Z
---

## Goal

One shared Tabs implementation (WAI-ARIA tabs pattern) and one Tooltip
primitive, with no new dependency, applied to the icon-only buttons of the
board toolbar and the space top bar (polly proposal: design-system-and-libraries
§Tabs/§Tooltip, visual-audit #4 and #6).

## Acceptance criteria

- [ ] One Tabs implementation in `server/web/src/components/`: roving
      tabindex, Left/Right/Home/End, `aria-selected`/`aria-controls`, visible
      focus; duplicate tablists (census by untruncated grep) migrated onto it
      and their private keyboard code deleted.
- [ ] Tab strips that scroll horizontally at 390px show an overflow fade on
      the clipped edge and scroll the active tab into view.
- [ ] Organisation / People / Roles screen content unchanged (only the tab
      component they use may change).
- [ ] One Tooltip primitive, no new dependency: hover and keyboard focus,
      a show delay, Escape dismisses, `aria-describedby`, never the only
      label, both themes, reduced motion, positioned with no inline style
      attribute (CSP checked in a browser test).
- [ ] Every icon-only button in the board toolbar and space top bar has an
      `aria-label` and the Tooltip; no bare `title=` tooltip left on them.
      Other `title=` sites censused and listed as follow-ups, not fixed.
- [ ] Browser keyboard tests for tabs and tooltip and unit tests; each
      mutated once to prove it fails.
- [ ] `pnpm lint`, `pnpm format` and the new/changed tests exit 0;
      screenshots dark/light at 1440/390.
