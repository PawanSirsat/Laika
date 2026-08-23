---
id: LAI-025
title: SPEC §4.8 (`activity`) cannot represent four of the event types it defines
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-003
status: backlog
---

## Goal

SPEC §4.8 (`activity`) marks only `task_id` as nullable. Applied literally, that
makes several of the activity types the **same section** defines impossible to
write. Confirm the nullability so the schema stops disagreeing with the prose.

## Acceptance criteria

- [ ] §4.8 states which of `project_id` and `actor_id` are nullable, and why.
- [ ] The activity types that are org-scoped or system-authored are named there,
      so the next reader does not rediscover this.
- [ ] `server/src/db/schema.ts` matches, and its "Deviation from §4.8" comment is
      removed or rewritten to cite the settled rule.
- [ ] If the answer is instead "a system user row exists and every event is
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
