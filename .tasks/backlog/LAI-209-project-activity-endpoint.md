---
id: LAI-209
title: GET /projects/:slug/activity, so agent-authored work can be badged
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-049
status: backlog
---

## Goal

LAI-049 AC8 requires agent-authored recent activity badged from `actor_kind`
(§4.8), and SPEC §6.4 lists `GET /projects/:slug/activity`. **The endpoint does
not exist** — there is no activity route at all, so the board cannot badge
anything.

The `activity` table exists and is written on every mutation (LAI-011). Only the
read path is missing.

## Acceptance criteria

- [ ] `GET /api/v1/projects/:slug/activity` returns activity rows for a project,
      paginated like every other list (§6.3), `can()`-checked for `project.read`.
- [ ] Each row carries `actor_kind` (`'user' | 'agent'`), `actor_id`, `type`,
      `task_id` and `created_at` — enough to badge a card without a second call.
- [ ] `?task_id=` filters to one task, so a card can ask about itself.
- [ ] A row written by a token-authenticated request comes back with
      `actor_kind: 'agent'`, asserted end to end rather than by unit test.
- [ ] A follow-up `area: web` task is filed to badge the cards.

## Notes / context

Discovered building the board. **Not blocking** — the board ships without the
badge, and LAI-049 records AC8 as unmet with this task as the reason.

`created_via` on a task (`'web' | 'mcp' | 'api' | …`) is **not** a substitute: it
records how the task was *created*, not whether an agent has touched it recently.
Badging from it would mark a task an agent created months ago and say nothing
about one an agent is working on now — which is the opposite of what §11.4.1
asks for. I deliberately did not use it.

No new dependencies.
