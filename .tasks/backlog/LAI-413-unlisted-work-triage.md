---
id: LAI-413
title: Triage unlisted work — promote or dismiss
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-405]
discovered-from:
status: backlog
---

## Goal

`log_unlisted_work` is how an agent records something it noticed outside any
project. Without a screen, those rows accumulate where nobody looks, and the one
tool with no REST twin becomes a write-only hole.

Lives under `REVIEW` in the sidebar — it is a queue a human works through.

## Acceptance criteria

- [ ] Lists `GET /api/v1/unlisted`: repo, note, who logged it, when. Paginated.
      Filters for `?user=` and `?since=`.
- [ ] Promote opens a form for `project_slug`, `title` and optional `priority`,
      calls `POST /unlisted/:id/promote`, and on success **links to the created
      task**. A promotion that gives no way to reach its result is a dead end.
- [ ] Dismiss removes the row from the default list, with confirmation and an
      undo path or a filter that can find dismissed rows again. Dismissing is not
      deleting.
- [ ] A row already promoted shows its task rather than offering promote again —
      the server returns `409` for a second attempt, and the UI should not walk
      the user into it.
- [ ] Someone without `audit_log.export` never sees the nav entry. **Absent, not
      disabled** — LAI-082 settled that for the whole sidebar; follow it.
- [ ] Empty state says what this queue is and why it is empty, in the product's
      own words. Empty is the normal state until agents are running.
- [ ] Both themes. Rendered in a real browser.
- [ ] Full gate green.

## Notes

No new dependencies. No demo module — LAI-405 delivers the endpoints (D-032).
