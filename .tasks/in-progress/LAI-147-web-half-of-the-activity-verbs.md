---
id: LAI-147
title: The client mirrors §4.8's vocabulary and has not seen LAI-113's seven verbs
area: web
assignee: shell
priority: p2
depends-on: [LAI-113]
discovered-from: LAI-113
status: in-progress
started: 2026-09-01T05:52:20Z
finished: 2026-09-01T06:20:00Z
---

## Goal

LAI-113 added seven verbs to §4.8: `sprint.created`, `sprint.updated`,
`sprint.deleted`, `sprint.tasks_changed`, `project.context_updated`,
`unlisted.promoted`, `unlisted.dismissed`.

**The client mirrors that vocabulary in two places**, and both now fail:

```
server/web/test/api/use-events.test.ts:22
  not ok 1 - STREAM_TYPES equals ACTIVITY_TYPES, in order

server/web/test/routes/screens/dashboard/dashboard-derive.test.ts:208
  not ok 2 - covers every verb the server can write
      + 'sprint.created', 'sprint.updated', 'sprint.deleted',
      + 'sprint.tasks_changed', 'project.context_updated',
      + 'unlisted.promoted', 'unlisted.dismissed'
```

Both are working exactly as designed. `server/web/` is SHELL's, so CORE filed
this rather than crossing.

## What is needed

- `server/web/src/api/stream-types.ts` — `STREAM_TYPES` gains all seven, **in
  the same order as `ACTIVITY_TYPES`**, which is what its test asserts.
- The dashboard's verb handling covers the seven. Four of them are worth
  rendering (`sprint.created` / `updated` / `deleted`, `project.context_updated`);
  `sprint.tasks_changed` is high-volume and may want the same treatment as
  `task.updated`. **That is a UI judgement and it is SHELL's**, not something
  CORE should specify from here.

## Acceptance criteria

- [x] Both named tests pass.
- [x] `STREAM_TYPES` order matches `ACTIVITY_TYPES` — the test checks order, not
      just membership.
- [x] A verb the dashboard deliberately does not render is **listed as
      deliberate**, not silently absent. `sprint.tasks_changed` is the likely
      candidate: one row per task moved is noise in a feed a person reads.

## Notes / context

**This is a drift axis LAI-213 does not cover.** LAI-213 binds client *view
types* to server `*View` types. This is a different mirror — a **closed
vocabulary** shared between server and client — and it has its own two tests,
which is why it was caught at all.

Worth knowing when predicting whether a server change lands green: *"does a
`*View` move?"* is not the whole question. The client also mirrors
`ACTIVITY_TYPES`, and it will mirror anything else that is closed on both sides.
LAI-113's landing was predicted green on the `*View` question alone and was not.

**Do not resolve this by loosening either test.** They are the reason the gap was
visible within seconds instead of appearing later as an event the board silently
drops.

---

## Landed on `master` by cherry-pick — CHIEF, 2026-09-01

CORE filed this on `core`, where SHELL could not claim it: **there was nothing in
`.tasks/backlog/` on `master` to `git mv`.** SHELL found that, checked it with
`git merge-base --is-ancestor` rather than reporting a feeling, and **declined to
`git checkout core -- ` the file** — which would have put the same path on two
branches with different histories, and made it look as though they had filed a
task CORE filed. That was the right call and the reasoning is worth keeping: one
cherry-pick on CHIEF's side is cheaper than an add/add conflict on both.

**Cherry-picked with `-x`** so the origin commit is recorded. The full `core`
merge is held until this half lands, because `core` also carries LAI-113's and
LAI-222's code, and merging it now would put `master` red on assertions this task
exists to clear.

### The judgement CORE left open, and SHELL's answer

`sprint.tasks_changed` should be **listed as deliberately unrendered.** One row
per task moved is noise in a feed a person reads, and the feed's job is to say
what changed about the **project**, not to narrate every drag.

**The important half is that it is listed rather than absent.** A verb the
dashboard silently drops and a verb it deliberately declines look identical to
the next reader, and only one of them is a decision — the same distinction
`clientOmits` exists to carry. Confirm it against the real dashboard before
shipping the opinion.

---

## Build note — SHELL, 2026-09-01

### **Submitted red under D-045: one failure, and it is the point of the task**

From the **repo-root** `pnpm test`:

```
not ok - STREAM_TYPES equals ACTIVITY_TYPES, in order
```

`master` declares **23** activity types; `core` declares **32**. I now mirror 32,
so the assertion fails until **LAI-113 and LAI-222** land beside it. Not
loosened, not exempted — the Notes are explicit that loosening it is how the gap
would have stayed invisible. 561 of 562 passing, 0 type errors, lint and format
clean.

### The task says seven verbs. It needs nine.

Filed against LAI-113 alone, so it names LAI-113's seven. But `core` also
carries **`user.deactivated`** and **`user.reactivated`** from LAI-222 — and
CHIEF's instruction was that *both* tasks are blocked on these two assertions.
`STREAM_TYPES equals ACTIVITY_TYPES` is exact, so mirroring seven of nine would
leave it red and unblock neither.

**All nine are in, in `core`'s order.** Verified against
`git show core:server/src/db/enums.ts` rather than inferred from the task text.

### `sprint.tasks_changed`: declined, and the decline is the deliverable

One row per task moved is noise in a feed whose job is saying what changed about
the **project**, not narrating every drag. So it is in `FEED_SILENT` **with a
reason**, and `shownInFeed` is what the screen calls.

**It keeps its label.** The decision is about *display*, not vocabulary — and a
verb that is silently absent and a verb that is deliberately declined **look
identical to the next reader, and only one of them is a decision.** A test
asserts every declined verb still has wording, so a gap cannot hide inside the
decline.

Three mutations, three reds: a reason too short to be a reason, `shownInFeed`
always true, and the label removed so the verb is declined *and* unlabelled.

### Two things the filter must not quietly change

- **The counts still see every event.** *"52 events, 3 by agents"* is a claim
  about what happened; hiding a verb from a list must not silently change the
  arithmetic printed beside it.
- **The empty state no longer contradicts the count.** If everything in range is
  declined, the old copy said *"Nothing in the last 7 days"* beside *"52
  events"*. It now says nothing worth **showing**, and why.

### Confirmed on the real dashboard — with one limit

Rendered against the running instance: **52 events, the feed renders, the count
reads 52**, and the filter breaks nothing.

**I could not render a `sprint.tasks_changed` row**, and would rather say so than
imply I did: the verb does not exist in `master`'s `CHECK` constraint, so the
database refuses the insert — I tried, and it was rejected by
`activity_type_check`. The decline is proven by test and by reading the screen's
code path, not by a row on screen. **It is worth re-checking once `core` lands.**

### An unrelated crash, found by looking

The dashboard rendered **blank** at first: `TypeError: e.blocked_by is not
iterable`. My dev server was still running **pre-LAI-429 code** and sending
`dependencies` to a client expecting `blocked_by`. Not a defect in this change —
but it is the **third time** a stale dev process has produced a false result for
me, and it is exactly the client/server contract LAI-213 exists to catch at build
time. Restarting made it green.
