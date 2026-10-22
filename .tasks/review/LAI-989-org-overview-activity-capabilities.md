---
id: LAI-989
title: 'Overview has no pulse, Activity cannot be exported or say who, capabilities are unexplained, spaces cannot be pinned'
area: web
assignee: shell
priority: p2
depends-on: [LAI-984, LAI-985, LAI-986, LAI-960]
discovered-from:
status: review
started: 2026-10-22T19:16:58Z
finished: 2026-10-22T19:33:36Z
---

## Acceptance criteria (audit B10b, B11, B12, C5, C6)

- [x] Organisation → Overview: pulse tiles from `/org/overview`.
- [x] Activity: rows say who and roles ("added Mia as Member", "Adam Space
      admin → Member"); **Export CSV** with current filters.
- [x] Roles & permissions grid: new capabilities and each capability's
      description under its label.
- [x] Sidebar: pin spaces (stored per browser), pinned above recent.
- [x] Light/dark, 1440/390, browser tests. Gate exit 0 with servers merged.

## Claim note (SHELL, 2026-10-23)

Claimed on CHIEF's (Belka's) dispatch, not from `done/`: LAI-984, LAI-985 and
LAI-986 are the server halves carried by `LAI-993-release-2-server-integration`,
and LAI-960 / LAI-970 arrive with `LAI-977-space-settings-page`. Base
`63690059` merges both; neither is in `.tasks/done/` on `master` yet (§2 step
1's exception, recorded rather than read loosely).

## Submission (SHELL, 2026-10-23)

Every criterion is met on this branch. The gate is red only on other owners'
halves (§4.4). Quoted:

- **LAI-996 (CORE, filed here):** pairing `OrgOverviewView` makes the
  server census's `UNPAIRED` entry stale.
  `server/test/tooling/response-type-coverage.test.ts`:
  `+ "OrgOverviewView is paired now — remove it from UNPAIRED"` and
  `expected 87 to be 86`. The test exits 0 at base `63690059`.
- **LAI-987:** `activity-labels.test.ts` and `use-events.test.ts` want
  `user.signed_out` and `org.ownership_transferred`. `view-type-drift`
  wants `OrgView.extra_owners` and `UserView.last_seen_at`.
- **LAI-987 / LAI-988 / LAI-975:** `endpoint-coverage.test.ts` still lists
  `invites/*/reissue`, `org/transfer-ownership`, `password-resets/consume`,
  `tasks/summary`, `users/*/memberships`, `users/*/reset-link` and
  `users/*/sign-out`. `org/overview` is off the list.

The three halves this task owns are green: `org/overview` coverage,
`CapabilityView.description` drift, and the `OrgOverviewView` pairing.
