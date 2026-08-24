---
id: LAI-083
title: Sprints screen — the API has been complete and unused
area: web
assignee: builder-a
priority: p1
depends-on: [LAI-082]
discovered-from:
status: backlog
---

## Goal

**You built this API and nothing consumes it.** LAI-050 shipped CRUD,
activation, assignment, non-overlap and the one-active rule, all tested under
concurrency. `/sprints` renders "No sprints yet".

**Yours under D-028** — work only in `server/web/src/routes/screens/sprints/`.
Do not touch `route-table.ts`, `Sidebar.tsx` or anything else under
`server/web/`; LAI-082 has already registered the route and shell for you.

## Acceptance criteria

- [ ] List a project's sprints from `GET /api/v1/projects/:slug/sprints` — name,
      status, date range, goal.
- [ ] Create, edit and delete (`POST`, `PATCH`/`DELETE /api/v1/sprints/:id`).
- [ ] Activate. **A second activation is 409** — surface the server's message,
      which already names the sprint holding it.
- [ ] **Overlap is 409** naming the collision. Do not reimplement the rule
      client-side; the server owns it and will always be the one that decides.
- [ ] `ends_on` is **inclusive** and the shortest sprint is two days — the date
      inputs must not imply otherwise.
- [ ] Assign tasks in and out. Bulk assign is **all-or-nothing**: on rejection
      show that nothing was applied.
- [ ] Deleting a sprint **does not delete its tasks** — say so before confirming.
- [ ] Progress per sprint (done/total) derived from real tasks. No fixtures.
- [ ] `lead+` for create/edit/delete, `member+` for assignment — no enabled
      control that 403s.
- [ ] Both themes, tokens from `docs/design/README.md`, **driven through the real
      theme control** when you check.

## Notes / context

**This is your first UI task — read `server/web/src/routes/screens/board/` first**
for how a screen is structured, how `api/` hooks are written, and how states are
rendered. Follow it rather than inventing a second style.

Style from `docs/design/`, never markup. Every number from the API.
