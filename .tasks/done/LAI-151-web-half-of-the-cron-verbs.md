---
id: LAI-151
title: The client vocabulary mirror has not seen LAI-431's four cron verbs
area: web
assignee: shell
priority: p2
depends-on: [LAI-431]
discovered-from: LAI-431
status: done
started: 2026-09-01T06:39:03Z
finished: 2026-09-01T07:35:00Z
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

- [x] Both named tests pass.
- [x] A verb the dashboard does not render is listed as deliberate, not silently
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

---

## Build note — SHELL, 2026-09-01

**Submitted red under D-045**, one failure, the point of the task:

```
not ok - STREAM_TYPES equals ACTIVITY_TYPES, in order
```

`master` declares 32; `core` declares 36; I mirror 36. Green when LAI-431 lands
beside it. **584 of 585 passing, 0 type errors.** Order taken from
`git show core:server/src/db/enums.ts`, not from the task text.

### The judgement: three declined, one kept — and the reason differs from last time

**`sprint.tasks_changed` was declined for volume.** These three are declined for
**attribution**: they carry `actor_kind: system` and no `actor_id`, and this
feed's job is *what changed on this project, and who changed it*. There is
nobody to name. They are an operator's lines, and an operator reads the activity
API or the logs.

- `heartbeat.pruned` — a count and a cutoff.
- `invite.expired` — nobody did this; the invite aged out.
- `meeting_review.expired` — the same.

**`task.stale_flagged` is kept**, and that is the interesting half. It is the one
cron verb a person asks about — *"why is this marked stale"* — and the flag
itself provokes the question. Silencing it would hide the answer.

**Both halves are asserted**, not just the declines: a test says
`task.stale_flagged` is shown and carries its wording, and **mutation-proven** —
adding it to `FEED_SILENT` turns that test red. A decision to *keep* something
is as easy to reverse by accident as a decision to drop it, and only one of them
had a guard before.

### On the recurrence, since the task raises it

Third time in a day: LAI-113 → LAI-147, LAI-222, now LAI-431 → LAI-151. **The
check is working** — each time it was caught in seconds rather than as an event
the board silently dropped.

Whether the client copy should be *generated* from `enums.ts` is a real question
and I have not answered it here, because it is a change to how two packages
relate and this task is fifteen minutes of mirroring. Worth noting what
generation would **not** fix: the labels and the `FEED_SILENT` judgement are
per-verb decisions a person has to make, so a generated `STREAM_TYPES` removes
one of the two red tests and leaves the other. **The half that needs a human
would still need one.**

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, and taken at a boundary without being asked — which is the standing
rule working the first time it was stated.

### The judgement, and the reason is not last time's

Three declined, one kept. **`sprint.tasks_changed` was declined for volume;
these three are declined for attribution:**

> *"`heartbeat.pruned`, `invite.expired` and `meeting_review.expired` carry
> `actor_kind: system` and no `actor_id`, and this feed's job is **what changed
> on this project, and who changed it**. There is nobody to name."*

That is a better rule than the one it follows, because it is about the feed's
purpose rather than about a row count — and it predicts the next case. Operator
lines belong in the activity API and the logs.

**`task.stale_flagged` kept**, and it is the one cron verb a person asks about:
the flag itself provokes the question.

### Asserting the keep, which the task did not ask for

> *"A decision to **keep** something is as easy to reverse by accident as a
> decision to drop it, and only the drop had a guard."*

**That is the gap in `FEED_SILENT`'s design and I did not see it.** The silent
list is tested; the shown list was tested only by absence from it. Mutation-proven
— adding `task.stale_flagged` to `FEED_SILENT` turns the new test red.

### The third no-op mutation of the day

Anchored on `'meeting_review.expired':`, which appears **twice** — in the labels
and in `FEED_SILENT` — so the assert failed, nothing was written, and the suite
came back green. Read for a moment as *"the guard did not catch it"*, with the
traceback directly above the green line.

> **"A no-op mutation and a hollow assertion are the same false result in
> different clothes."**

Three instances today across two sessions and me. The habit that fixes it is the
one in CLAUDE.md §5 — make the anchor failure loud and **read it before reading
the result**.

### On generating the mirror

Worth weighing and correctly not answered inside a fifteen-minute task: it would
fix **one** of the two red tests. The labels and the `FEED_SILENT` judgement are
per-verb decisions a person makes either way, **so generation removes the
mechanical half and leaves the half that needs a human** — which is the right
division and also the reason it is not obviously worth the coupling between two
packages. Filed thinking, not a decision.
