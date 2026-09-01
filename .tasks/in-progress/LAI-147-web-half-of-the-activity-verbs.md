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

- [ ] Both named tests pass.
- [ ] `STREAM_TYPES` order matches `ACTIVITY_TYPES` — the test checks order, not
      just membership.
- [ ] A verb the dashboard deliberately does not render is **listed as
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
