---
id: LAI-081
title: Applying tags, and filtering the board by one
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-079, LAI-056, LAI-066]
discovered-from: LAI-073
status: backlog
---

## Goal

LAI-066 renders tag chips. This makes them usable: apply and remove them on a
task, and filter the board by one.

## Acceptance criteria

- [ ] Tags are editable in the task detail panel (LAI-056), saved through
      `PATCH /api/v1/tasks/:id`.
- [ ] The picker offers the project's existing tags from
      `GET /api/v1/projects/:slug/tags`, **with their usage counts** — a count is
      what stops someone minting `frontend` when `ui` is already on forty tasks.
- [ ] A new tag can be typed and applied in one action; the server creates it.
- [ ] **The client does not pre-validate the name beyond trimming and
      lower-casing.** The rule lives in the server (D-027) and the server owns it;
      surface its 422 rather than reimplementing the pattern in two places where
      they can drift.
- [ ] Filter the board with `?tag=`, in the URL so it survives a reload — the same
      mechanism `?project=` and the sprint filter use.
- [ ] A Viewer sees tags and can filter by them, but gets no editing affordance.
- [ ] Both themes.

## Notes / context

**Not in scope: renaming and deleting a tag project-wide.** Those are `lead+`
(D-027) and belong on a project settings screen that does not exist yet. The
endpoints will be there from LAI-079 — leave them for that screen rather than
hiding a destructive project-wide action inside a task panel.
