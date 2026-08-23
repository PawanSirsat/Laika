---
id: LAI-019
title: App shell, sidebar and routing
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-018]
discovered-from:
status: backlog
---

## Goal

The frame every authenticated screen mounts into: the sidebar, the routing
table, and the layout. Built without a single API call, so it is ready the moment
the first endpoint is.

## Acceptance criteria

- [ ] Sidebar with three groups in this order, matching
      `docs/design/README.md`:
      `WORK` (Board, Timeline, Sprints, Capacity) ·
      `REVIEW` (Dashboard, Meeting review) ·
      `SETTINGS` (Tokens, Organisation).
- [ ] **No `SYSTEM` group.** Login, first boot and the project picker are
      pre-auth or org-level routes, not nav destinations (CLAUDE.md §5.1).
- [ ] **No Calendar item.** It has no decision behind it (SPEC §14, q10).
- [ ] Routing for every screen in SPEC §11.4.2, each rendering its **empty state**
      from LAI-020 — not fake content, not "coming soon" placeholders.
- [ ] Active-route highlighting; the sidebar collapses at narrow widths.
- [ ] A route that does not exist renders a real 404, not a blank frame.
- [ ] Theme toggle in the shell, using LAI-018's system.
- [ ] Keyboard navigable end to end: every nav item reachable and activatable,
      visible focus, landmark regions.
- [ ] Renders correctly in both themes at 1280px and 1440px.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

The user chrome (current user, avatar, role badge) is **layout only** here — the
slot exists and renders an unauthenticated state. Wiring it to `GET /api/v1/me`
is LAI-007, which depends on the API.

Match the design's *style*, not its markup — the prototype is inline-styled HTML
rendered by a foreign runtime (`docs/design/README.md`).
