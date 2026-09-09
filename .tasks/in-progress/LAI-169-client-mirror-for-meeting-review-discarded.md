---
id: LAI-169
title: 'The client mirror has no `meeting_review.discarded` — two web tests are red'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-454
started: 2026-09-09T23:20:00+05:30
status: in-progress
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

- [ ] `STREAM_TYPES` gains `meeting_review.discarded` **in §4.8's order** — the
      test compares the sequence, not the set.
- [ ] The dashboard feed has wording for it, or **declines it on purpose with a
      reason** — the sibling test *"a verb the feed declines is declined on
      purpose, with a reason"* already enforces that a decline is deliberate, so
      either answer is fine and silence is not.
- [ ] Say which, and why, in the code. *"A meeting review was discarded"* is a
      project-level event with no task, like `meeting.applied` beside it — if
      the dashboard feed does not want it, that is a judgement worth one line.
- [ ] Root gate `EXIT 0`.

## Notes

Filed by CORE from LAI-454, which **submits red on exactly these two assertions
and names this task**. The server half is complete and green: service, routes,
migration `0021`, and §4.8's verb in `enums.ts`.

**p1 because the gate is red until it lands**, and a permanently red gate is what
teaches people to stop reading it.
