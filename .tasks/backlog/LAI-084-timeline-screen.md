---
id: LAI-084
title: Timeline — one bar per sprint on a single track
area: web
assignee: builder-a
priority: p2
depends-on: [LAI-083]
discovered-from:
status: backlog
---

## Goal

D-014's timeline. **Sprints cannot overlap (§4.15), which is exactly why this is
a rendering pass and not a layout solver** — that non-overlap rule was built for
this screen.

**Yours under D-028** — only `server/web/src/routes/screens/timeline/`.

## Acceptance criteria

- [ ] A horizontal date axis with **one bar per sprint**, positioned by
      `starts_on`/`ends_on`, drawn from the sprints endpoint.
- [ ] Each bar shows the sprint name, its progress, and its status.
- [ ] **Tasks never get their own dates** (D-014). A task appears inside its
      sprint's bar or in an unscheduled tray, never on the axis.
- [ ] Today is marked.
- [ ] An empty project renders the empty state, not a bare axis.
- [ ] Both themes.

## Not in scope

Dragging a sprint edge to reschedule. It needs `PATCH /sprints/:id` wired to drag
maths and overlap rejection — worth its own task once the read view is right.

`docs/design/screenshots/` has two timeline PNGs that were **not** imported;
`docs/design/README.md` notes them. Look at them in the design project before
starting rather than inventing the layout.
