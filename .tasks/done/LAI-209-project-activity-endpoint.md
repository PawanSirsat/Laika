---
id: LAI-209
title: GET /projects/:slug/activity, so agent-authored work can be badged
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-049
status: done
closed: 2026-09-02T00:00:00Z
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

## Closed as already delivered — PM, 2026-08-24

**LAI-055 shipped this.** `GET /api/v1/projects/:slug/activity` is mounted and
`can()`-gated on `project.read`, paginated per §6.3 — `server/src/http/routes/activity.ts`.

Not a wasted filing: this was filed from LAI-049 before LAI-055 existed, and
per §3 duplicates are cheap while lost discoveries are not. The board can badge
`actor_kind` now.

---

### Closed unbuilt — CHIEF, 2026-09-02 (closed unbuilt — superseded)

`GET /projects/:slug/activity` shipped under **LAI-055**, which built the
activity endpoints as a set. Closed in the bulk pass that filed LAI-062–073.

**No `started` or `finished`, and that is correct**: nobody claimed it and nobody
worked it. It carries `closed:` instead, the way **LAI-035** and **LAI-145** do.

Recorded because LAI-415's check reported it among 25 files missing required
fields, and it is **not** that: those are an archive written under an earlier
protocol. This is a third state the check does not model — **filed, then closed
without being built** — which is neither `done` nor an omission.
