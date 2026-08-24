---
id: LAI-055
title: Activity feed endpoints — project-scoped and org-wide
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-011]
discovered-from: LAI-049
status: backlog
---

## Goal

`activity` has been written on every mutation since LAI-003 and **nothing can
read it**. §6.4 lists `GET /api/v1/projects/:slug/activity` and
`GET /api/v1/activity`; neither exists. The task-detail slide-over, the dashboard
and the standup view all read this table, and none of them can be built until it
is readable.

## Acceptance criteria

- [ ] `GET /api/v1/projects/:slug/activity` — project-scoped, membership
      enforced.
- [ ] `GET /api/v1/activity` — org-wide, **viewer+**, and scoped to the projects
      the actor may see. An org-wide feed that leaks a project a Viewer is not a
      member of is the failure mode here; test it directly.
- [ ] Filters per §6.4: `?task_id=`, `?since=`, plus cursor pagination (§6.3).
- [ ] **Newest first** — a feed is scanned from the top. Comments read
      oldest-first (LAI-047) and the difference is deliberate; say so in a comment
      so the next reader does not "fix" one to match the other.
- [ ] Each row carries `actor_kind` so a client can badge agent-authored entries
      (§4.8) without a second lookup.
- [ ] **Read-only. No POST, PATCH or DELETE.** §4.8 is append-only and the
      service layer must offer no mutation path — LAI-003 already enforces this at
      the database; do not add a door above it.
- [ ] Services, not handlers (CONVENTIONS §2), `assertCan` on both routes.

## Notes / context

SPEC §6.4, §4.8, §6.3.

**`payload_json` shapes vary by verb** and the vocabulary has grown four times
today. Return it as-is rather than normalising — a reader that understands one
verb should not break when another gains a field.

**This is on the critical path for three screens**: task detail (activity trail),
dashboard (rollups), and the standup view. It is the last unread table in the
data model.

No new dependencies.
