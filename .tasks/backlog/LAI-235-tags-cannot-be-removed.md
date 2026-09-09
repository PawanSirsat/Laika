---
id: LAI-235
title: A project tag cannot be removed
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-460
status: backlog
---

## Goal

`DELETE /api/v1/projects/:slug/tags/:name` is served and **called by nothing**
(LAI-460). `listProjectTags` and `setTaskTags` are wired; removing a tag from the
project is not, so a typo'd tag is permanent from the UI.

## Acceptance criteria

- [ ] A tag can be removed from the project, with what it is attached to shown
      first — removal is not per-task and the count is the whole warning.
- [ ] D-027 still holds: no per-tag colour.
- [ ] LAI-460's exemption for `api/v1/projects/*/tags/*` is removed.
- [ ] Full gate `EXIT 0`.
