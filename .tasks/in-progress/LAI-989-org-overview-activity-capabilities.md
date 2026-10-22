---
id: LAI-989
title: 'Overview has no pulse, Activity cannot be exported or say who, capabilities are unexplained, spaces cannot be pinned'
area: web
assignee: shell
priority: p2
depends-on: [LAI-984, LAI-985, LAI-986, LAI-960]
discovered-from:
status: in-progress
started: 2026-10-22T19:16:58Z
---

## Acceptance criteria (audit B10b, B11, B12, C5, C6)

- [ ] Organisation → Overview: pulse tiles from `/org/overview`.
- [ ] Activity: rows say who and roles ("added Mia as Member", "Adam Space
      admin → Member"); **Export CSV** with current filters.
- [ ] Roles & permissions grid: new capabilities and each capability's
      description under its label.
- [ ] Sidebar: pin spaces (stored per browser), pinned above recent.
- [ ] Light/dark, 1440/390, browser tests. Gate exit 0 with servers merged.

## Claim note (SHELL, 2026-10-23)

Claimed on CHIEF's (Belka's) dispatch, not from `done/`: LAI-984, LAI-985 and
LAI-986 are the server halves carried by `LAI-993-release-2-server-integration`,
and LAI-960 / LAI-970 arrive with `LAI-977-space-settings-page`. Base
`63690059` merges both; neither is in `.tasks/done/` on `master` yet (§2 step
1's exception, recorded rather than read loosely).
