---
id: LAI-234
title: A comment cannot be edited or deleted from the UI
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-460
status: backlog
---

## Goal

`PATCH /api/v1/comments/:id` and `DELETE /api/v1/comments/:id` are served and
**called by nothing** (LAI-460).

§4.8 carries `comment.edited` and `comment.deleted`, and the client already
models a **tombstone** — `isCommentTombstone` exists in `api/comments.ts` and the
panel renders one. **So the UI can display the result of a deletion it cannot
perform.**

## Acceptance criteria

- [ ] A comment's author can edit and delete their own; the panel shows the
      tombstone it already knows how to draw.
- [ ] Permission comes from the API, not from a guess about roles — an edit
      control that appears and then 403s is worse than none.
- [ ] LAI-460's exemption for `api/v1/comments/*` is removed.
- [ ] Both themes. Full gate `EXIT 0`.
