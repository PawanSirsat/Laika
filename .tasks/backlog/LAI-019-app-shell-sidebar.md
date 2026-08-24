---
id: LAI-019
title: App shell, sidebar and routing
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-018, LAI-020]
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

---

## Released by Builder-B, 2026-08-24 — undeclared dependency on LAI-020

Claimed, then released within a minute of reading it. No code written.

**Acceptance criterion 4 requires LAI-020.** It says every route must render
"its **empty state** from LAI-020 — not fake content, not 'coming soon'
placeholders". LAI-020 builds exactly those components and is still in
`.tasks/backlog/`. `depends-on` listed only LAI-018, so this task looked ready
when it was not.

**Why I did not work around it.** The only ways through were to render
placeholders, which the criterion forbids by name, or to write my own
empty-state component — which would duplicate LAI-020's first acceptance
criterion and then conflict with it, in the same area, by the same builder.

`depends-on` corrected to `[LAI-018, LAI-020]`. **Nothing is blocked**: LAI-020
is claimable now and I am taking it next, so this is a reordering of my own
queue rather than a stall. This task should be ready as soon as LAI-020 is
accepted.

The rest of the task is unchanged and needs no rewrite.
