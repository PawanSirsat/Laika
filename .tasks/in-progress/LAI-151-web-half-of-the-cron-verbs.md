---
id: LAI-151
title: The client vocabulary mirror has not seen LAI-431's four cron verbs
area: web
assignee: shell
priority: p2
depends-on: [LAI-431]
discovered-from: LAI-431
status: in-progress
started: 2026-09-01T06:39:03Z
---

## Goal

LAI-431 added four verbs to §4.8 for the in-process cron: `heartbeat.pruned`,
`task.stale_flagged`, `invite.expired`, `meeting_review.expired`.

**The client mirrors that vocabulary in two places**, and both fail:

```
server/web/test/api/use-events.test.ts
  not ok 1 - STREAM_TYPES equals ACTIVITY_TYPES, in order

server/web/test/routes/screens/dashboard/dashboard-derive.test.ts
  not ok 2 - covers every verb the server can write
```

This is the **third** time this pair has gone red for the same reason — LAI-113,
then LAI-222, now LAI-431. `server/web/` is SHELL's, so CORE filed it.

## What is needed

- `server/web/src/api/stream-types.ts` — the four verbs, **in `ACTIVITY_TYPES`
  order**, which is what the test asserts.
- The dashboard's verb handling covers them, or **lists them as deliberately
  unrendered**, the way `sprint.tasks_changed` was.

## Acceptance criteria

- [ ] Both named tests pass.
- [ ] A verb the dashboard does not render is listed as deliberate, not silently
      absent.

## Notes / context

**These four are a good candidate for "deliberately unrendered", and the reason
is different from `sprint.tasks_changed`'s.** That one was volume. These are
**not things a person did** — `actor_kind: 'system'`, `actor_id` null — and a
feed whose job is "what changed on this project, and who changed it" has nothing
to attribute. `task.stale_flagged` is the likely exception: it appears on a
task's own timeline and answers "why is this marked stale", which somebody does
ask.

**That is a UI judgement and it is SHELL's.** CORE has an opinion and no standing
to spend it.

**The recurrence is the finding, not the fix.** Three tasks, one shape: the
server grows a closed vocabulary and a client copy goes red. It is a known drift
axis (D-045's neighbourhood) and it is *working* — each time it has been caught in
seconds. The open question is whether the copy should be generated from
`enums.ts` rather than maintained, which is its own task and not this one.
