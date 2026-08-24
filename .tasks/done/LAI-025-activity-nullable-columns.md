---
id: LAI-025
title: SPEC §4.8 (`activity`) cannot represent four of the event types it defines
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-003
status: done
started: 2026-08-24T07:00:00+05:30
finished: 2026-08-24T07:05:00+05:30
reviewed: 2026-08-24T07:05:00+05:30
---

## Goal

SPEC §4.8 (`activity`) marks only `task_id` as nullable. Applied literally, that
makes several of the activity types the **same section** defines impossible to
write. Confirm the nullability so the schema stops disagreeing with the prose.

## Acceptance criteria

- [x] §4.8 states which of `project_id` and `actor_id` are nullable, and why.
- [x] The activity types that are org-scoped or system-authored are named there,
      so the next reader does not rediscover this.
- [x] `server/src/db/schema.ts` matches, and its "Deviation from §4.8" comment is
      removed or rewritten to cite the settled rule.
- [x] If the answer is instead "a system user row exists and every event is
      project-scoped", say which task creates that user and what it is called —
      LAI-009 (first-run) would have to seed it.

## Notes / context

Discovered implementing LAI-003. The conflict, concretely:

| §4.8 type | Has no project | Has no user actor |
| --- | :---: | :---: |
| `token.created`, `token.revoked` | ✓ | |
| `unlisted.logged` (§4.14 — deliberately outside any project) | ✓ | |
| `member.added`, `member.role_changed` at org level | ✓ | |
| `webhook.commit`, `webhook.received` (§6.1: signature-authenticated system actor) | | ✓ |
| cron-written events (§11.6 — stale flagging, expiry) | | ✓ |

**Current implementation, chosen so nothing is blocked:** `project_id` and
`actor_id` are both nullable; `org_id` stays `NOT NULL` because every event
belongs to the one org. Both are `ON DELETE SET NULL` rather than cascade — an
audit log that deletes its own history when a project is removed is not an audit
log. Tests in `server/test/db/activity.test.ts` cover writing a `token.created`
with no project and a `webhook.commit` with no actor.

This is a spec-internal contradiction rather than a task-versus-spec one, so
D-011's "spec wins" does not resolve it — hence the task.

No new dependencies.

---

## Resolution — PM, 2026-08-24

**Settled as D-022.** SPEC §4.8 now states nullability per column and names the
event types that force it, so the next reader does not rediscover this.

- `project_id` **nullable** — `token.created`, `token.revoked`,
  `unlisted.logged`, org-level `member.added` and `member.role_changed`.
- `actor_kind` gains **`system`** — cron (§11.6) and inbound webhooks.
- `actor_id` **nullable if and only if `actor_kind = 'system'`**, enforced by a
  check constraint in both directions.

**Your fourth criterion was the right question to force.** A seeded system user
was the real alternative, and it loses: it puts a fake row in `users` that shows
up in member lists, can be invited or assigned work, and must be seeded correctly
by LAI-009 forever — all to avoid a null check. `actor_kind` already exists to
classify who acted and the UI already branches on it.

**The constraint matters more than the nullability**, which your task did not ask
about and is the part worth having. Plain nullable makes `actor_id IS NULL`
ambiguous — system-authored, or a bug that failed to set it? For the table
feeding the audit trail that ambiguity is the whole problem.

**Your schema deviation was right and is now the rule.** Flagging it in a source
comment that *named the conflicting types* is why this became a decision instead
of folklore — a comment saying "widened this, seemed necessary" would have been
read as a shortcut and eventually reverted.

**Implementation: LAI-044.** Nothing writes `system` events yet (webhooks are M6,
cron M5), so the vocabulary lands before the first writer — the cheap moment,
since adding a check constraint to a populated table means a migration with a
data audit attached.
