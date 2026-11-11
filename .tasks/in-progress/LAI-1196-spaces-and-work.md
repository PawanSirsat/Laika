---
id: LAI-1196
title: 'web: refine the Spaces directory (/projects) and the Work page (/work)'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T00:00:00Z
---

## Goal

Refine the two org-level directories against the 17-state interaction
contract (`.polly/proposal/interaction-inventory.md`): the Spaces directory
at `/projects` and everyone's Work at `/work`. UI only, existing public API,
no new dependencies, no demo data, permissions stay server-authoritative.

Scope is `server/web/` only. `theme.css` is not edited (the brand/glass PRs
own it); theme tokens only.

## Acceptance criteria

- [ ] `/projects` has a clear header and primary action; cards and rows show
      name, key, colour, members and open work in one hierarchy, and never
      print the raw URL slug as content.
- [ ] Search, filter, sort and grid-vs-list on `/projects` live in the URL
      and survive a reload.
- [ ] Creating a space validates its fields, reports the result and lands in
      the new space; the empty-org "Create a space" action from My day uses
      the same route and flow.
- [ ] Archiving a space is confirmed with a stated consequence.
- [ ] The shared context editor shows save status and revision history
      clearly.
- [ ] `/work` keeps space, status and assignee filters and grouping in the
      URL, has a useful empty state, a loading skeleton, and an error with
      Retry that keeps the last data on screen.
- [ ] Tables on both screens scroll with a visible cue at 390 and 768.
- [ ] UI copy says "space"; keyboard and screen-reader labels; both themes;
      reduced motion respected.
- [ ] Playwright interaction tests cover create, archive confirm,
      URL-persisted filters surviving reload, and error/Retry; one mutation
      proves they fail.
- [ ] `pnpm lint`, `pnpm format` and the new/changed tests exit 0.
