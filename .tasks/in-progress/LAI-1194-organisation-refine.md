---
id: LAI-1194
title: 'Refine the Organisation, People and Roles screens against the 17-state interaction contract'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T09:00:00Z
---

## Goal

Wave 4 item S8 of `.polly/proposal/ux-refinement-program.md`: refine
`/organisation` (Overview, People, Roles, Integrations, Security, Activity)
and `/people?user=` in `server/web/` only, against the 17-state interaction
contract. UI only, existing public API only, no new dependencies, no demo
data, permissions from the server.

## Acceptance criteria

- [ ] Clear page header and hierarchy; consistent section layout and density
      across the Organisation tabs.
- [ ] Empty states carry a next action and are not error-styled; loading
      shows skeletons; errors offer Retry and keep the last good data on a
      refresh failure.
- [ ] Consequential actions (role change, deactivate, transfer ownership,
      revoke token) confirm and report the result; ownership transfer needs a
      typed confirmation.
- [ ] Disabled controls say why; controls the actor cannot use are hidden,
      from the server's permissions.
- [ ] UI copy says "space", never project or workspace.
- [ ] Roles & permissions reads as a summary, not a wall of chips (V8).
- [ ] Tables scroll horizontally with a visible cue at 390 and 768 (V9).
- [ ] Keyboard and screen-reader labels; both themes; reduced motion; theme
      tokens only. The shared tab component and `theme.css` are not edited.
- [ ] Playwright interaction tests for confirmations, error/retry, empty
      states and keyboard; one mutation shown to turn them red.
- [ ] Before/after screenshots, dark and light, 1440 and 390.
- [ ] `pnpm lint`, `pnpm format` and the new/changed test files exit 0.
