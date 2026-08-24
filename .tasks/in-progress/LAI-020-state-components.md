---
id: LAI-020
title: Empty, loading, error and permission-denied states
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-018]
discovered-from:
status: in-progress
started: 2026-08-24T05:42:16+05:30
---

## Goal

The four states every screen needs and every project forgets until the end. Build
them once, first, so no screen ships with a blank white panel where a failure
should be explained.

## Acceptance criteria

- [ ] **Empty state** component: icon, headline, one line of explanation, and an
      optional action. Text is per-instance, not generic — "No projects yet.
      Create the first one and point it at a repo" beats "No data".
- [ ] **Loading state**: skeletons shaped like the content they replace, not a
      centred spinner. No layout shift when real content arrives.
- [ ] **Error state**: what failed, whether retrying will help, a retry action,
      and the `request_id` when the API returned one (SPEC §13.2) so a user can
      quote it.
- [ ] **Permission-denied state**, distinct from error and from empty: the actor
      may not see this, and says which role would. `forbidden` must never render
      as an empty list — a Viewer seeing "no tasks" when tasks exist is a lie.
- [ ] **Offline / stream-disconnected** banner for when SSE drops, with a
      reconnect countdown. The design shows this on the login screen; it belongs
      to the shell too.
- [ ] All five work in both themes and are keyboard reachable.
- [ ] A gallery page renders every state so they can be reviewed without
      navigating the app.

## Notes / context

Milestone: **M1**. **API-independent — startable now.** D-016.

These components take props and render; they do not fetch. That is what keeps
them API-independent while still being the real components screens will use.

The empty-state copy for each screen comes from `docs/design/` — the prototype
writes real sentences and they are better than anything invented here.
