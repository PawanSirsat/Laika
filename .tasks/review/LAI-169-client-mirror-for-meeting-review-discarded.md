---
id: LAI-169
title: 'The client mirror has no `meeting_review.discarded` — two web tests are red'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-454
started: 2026-09-09T23:20:00+05:30
finished: 2026-09-09T23:23:09+05:30
status: review
---

## Goal

**D-056 added `meeting_review.discarded` to §4.8 and LAI-454 added it to
`enums.ts`. The client mirrors both lists and has neither.** Two tests in
`server/web/` are red, and they are red *correctly* — this is the drift check
refusing a half-landed contract, which is CLAUDE.md §4.4's expected state.

**Both assertions, verbatim from the root gate:**

```
not ok 1 - STREAM_TYPES equals ACTIVITY_TYPES, in order
  server/web/test/api/use-events.test.ts:23:8
      'meeting.applied',
  -   'meeting_review.discarded',
      'unlisted.logged',
```

```
not ok 2 - covers every verb the server can write
  server/web/test/routes/screens/dashboard/dashboard-derive.test.ts:214:8
  these §4.8 verbs have no wording on the dashboard
  + [ 'meeting_review.discarded' ]
  - []
```

`server/web` otherwise passes 642.

## Why CORE did not fix it

`server/web/` is SHELL's (D-031), and **the exemption lists are there too** — so
there is no entry CORE could take that is not a crossing. CLAUDE.md §4.4 names
this exact case:

> **Unless the exemption list lives in the other owner's area** — `clientOmits`
> in `server/web/` is the case that came up. Then there is no exemption to take
> that is not a crossing, and step 1's red-with-a-named-failure is the whole
> mechanism. **Never reach across to take one**, and never disable the check: a
> drift check refusing a half-landed contract is the check working.

## Acceptance criteria

- [x] `STREAM_TYPES` gains `meeting_review.discarded` **in §4.8's order** — the
      test compares the sequence, not the set.
- [x] The dashboard feed has wording for it, or **declines it on purpose with a
      reason** — the sibling test *"a verb the feed declines is declined on
      purpose, with a reason"* already enforces that a decline is deliberate, so
      either answer is fine and silence is not.
- [x] Say which, and why, in the code. *"A meeting review was discarded"* is a
      project-level event with no task, like `meeting.applied` beside it — if
      the dashboard feed does not want it, that is a judgement worth one line.
- [ ] Root gate `EXIT 0`.

## Notes

Filed by CORE from LAI-454, which **submits red on exactly these two assertions
and names this task**. The server half is complete and green: service, routes,
migration `0021`, and §4.8's verb in `enums.ts`.

**p1 because the gate is red until it lands**, and a permanently red gate is what
teaches people to stop reading it.


---

## Submitted red — SHELL, §4.4 step 1

**The gate is `EXIT 1` on exactly one assertion, and it is not the one this task
describes. The direction is reversed.**

```
server/web test: not ok 67 - the stream subscribes to exactly what the server emits
  server/web/test/api/use-events.test.ts
  +   'meeting_review.discarded'      <- the client has it, ACTIVITY_TYPES does not
```

format, lint and typecheck clean; `server` and `cli` green; `server/web` 643 of
644.

### Why it is reversed, measured across all three branches

The task says web is red and this half turns it green. **On `shell` it was
green**, because the test reads `server/src/db/enums.ts` **from the working
tree**, and no branch carries the verb yet:

```
master  enums has the verb: 0     SPEC §4.8 has it: 1
core    enums has the verb: 0
shell   enums has the verb: 0
```

**CORE's half is uncommitted in their worktree** — present in
`Laika-core/server/src/db/enums.ts`, absent from every ref. So the red the task
quotes is CORE's working tree, not any branch, and **`master` cannot merge my
half first without going red**.

**Merge order matters and it is the opposite of the usual:** CORE's enum commit
must reach `master` **before** this, not after.

### My half is proved correct, not merely red for the expected reason

Red alone is not evidence of a correct half. Simulating CORE's landing — the verb
added to `enums.ts` in this worktree — both files go green:

```
# pass 34   # fail 0
```

`enums.ts` was restored and checked by checksum; `git status` is clean, and this
branch carries none of CORE's work.

### The wording, and why it is not a decline

**Worded, not declined**, and the pair either side is the argument.
`meeting_review.expired` sits in the **declines** map because *nobody did it* —
§11.6's sweep aged it out and there is nobody to name. **A discard is the
opposite**: a person read the whole proposal set and threw it away. It has an
actor, it is a decision, and a feed whose job is *"what changed and who changed
it"* is exactly where a decision belongs.

> `'meeting_review.discarded': 'discarded a meeting review'`

The phrasing avoids *rejected* and *failed*: nothing went wrong, somebody chose —
the same distinction that stopped it sharing a verb with the expiry.

### Position, and a disagreement worth knowing about

`STREAM_TYPES` is compared to `ACTIVITY_TYPES` **in order**, so it goes where the
enum puts it — after `meeting.applied`. **§4.8's prose lists it last.** The two
agree on membership and **not on position**, and the ordered comparison is
against the enum, so the SPEC's order is not what this file mirrors. Said in the
code where the next person will wonder.
