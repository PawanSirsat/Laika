---
id: LAI-1194
title: 'Refine the Organisation, People and Roles screens against the 17-state interaction contract'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-11T09:00:00Z
finished: 2026-11-11T12:30:00Z
---

## Goal

Wave 4 item S8 of `.polly/proposal/ux-refinement-program.md`: refine
`/organisation` (Overview, People, Roles, Integrations, Security, Activity)
and `/people?user=` in `server/web/` only, against the 17-state interaction
contract. UI only, existing public API only, no new dependencies, no demo
data, permissions from the server.

## Acceptance criteria

- [x] Clear page header and hierarchy; consistent section layout and density
      across the Organisation tabs.
- [x] Empty states carry a next action and are not error-styled; loading
      shows skeletons; errors offer Retry and keep the last good data on a
      refresh failure.
- [x] Consequential actions (role change, deactivate, transfer ownership,
      revoke token) confirm and report the result; ownership transfer needs a
      typed confirmation.
- [x] Disabled controls say why; controls the actor cannot use are hidden,
      from the server's permissions.
- [x] UI copy says "space", never project or workspace.
- [x] Roles & permissions reads as a summary, not a wall of chips (V8).
- [x] Tables scroll horizontally with a visible cue at 390 and 768 (V9).
- [x] Keyboard and screen-reader labels; both themes; reduced motion; theme
      tokens only. The shared tab component and `theme.css` are not edited.
- [x] Playwright interaction tests for confirmations, error/retry, empty
      states and keyboard; one mutation shown to turn them red.
- [x] Before/after screenshots, dark and light, 1440 and 390.
- [x] `pnpm lint`, `pnpm format` and the new/changed test files exit 0.

## Builder notes (SHELL, 2026-11-11)

- Tests: `server/web/test/browser/organisation-refine.test.ts` (17 cases) and
  one case appended to `person-admin.test.ts`. Two existing cases were changed
  with the reason in a comment: `organisation-roles.test.ts` (Reactivate now
  confirms) and `organisation-people.test.ts` (the empty state has a second
  action, so the Invite button is named). `member-profile.test.ts` follows the
  "Not in any space yet" copy.
- Mutation: Reactivate calling the server without asking, and a refresh failure
  replacing the page, each turned exactly their test red; source restored and
  compared with `cmp`.
- Screenshots: `.polly/screenshots/organisation/{before,after}/`, stubbed API,
  dark and light, 1440 and 390, plus the People card at 390.
- Not done here (needs other owners or tasks): the shared tab component,
  `theme.css`, the `/members` links (retiring `/members` is B13), and the
  Tool/agent wording on token groups (S11's copy pass).
