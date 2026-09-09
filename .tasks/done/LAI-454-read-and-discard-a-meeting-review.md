---
id: LAI-454
title: 'Reading a meeting review, and discarding one — §11.4.2''s other three endpoints'
area: server
assignee: core
priority: p2
depends-on: [LAI-450]
discovered-from: LAI-450
status: done
started: 2026-09-09T17:35:00Z
finished: 2026-09-09T19:30:00Z
---

## Goal

**§11.4.2's Meeting review row names four endpoints. LAI-450 built the producer,
LAI-451 builds `apply`, and these three have no task:**

```
GET  /projects/:slug/meeting-reviews
GET  /meeting-reviews/:id
POST /meeting-reviews/:id/discard
```

**Without them the screen cannot exist**, and M6's exit — *"paste a standup
transcript, **review the proposal**, apply it"* — has no review step. This is the
gap, not a nice-to-have.

## Acceptance criteria

- [x] **All three call `can()`** against the actor, with the resource in hand.
      `discard` is a write and does not borrow a read action.
- [x] **The list is scoped to the project and paginated** like every other list
      (§6.2), and a member of another project gets `not_found`, not `forbidden` —
      §9.3's rule that *where* is only disclosed to a reader who can see it.
- [x] **The detail response carries the transcript and the proposals together**,
      because §11.4.2 puts them side by side: *"transcript on one side, proposals
      on the other."* One request, not two.
- [x] **Each proposal carries its `quote`** — §11.4.2 requires *"each proposal
      shows its transcript quote"*, and a proposal a human cannot trace to a
      sentence is one they cannot honestly accept.
- [x] **The four kinds survive the round trip**: `NEW` / `CHANGED` / `DEAD` /
      `DECISION`. Assert **all four by name**, not a count — the LAI-419 rule.
- [x] **A discarded review cannot then be applied**, and an applied one cannot be
      discarded. Assert the `code`, not that something threw.
- [x] **An expired review still reads.** Expiry stops it being *applied* (§11.6);
      a human must still be able to see what they missed and why nothing landed.
      **Assert the `status` comes back `expired`** rather than the row vanishing.
- [x] `discard` writes an activity row. If §4.8 has no verb for it, **stop and
      file** — do not borrow `meeting.applied` for a discard.
- [ ] Full gate green — **`EXIT 0`**, repo root. — **NOT MET, deliberately.**
      Red on two named `server/web/` assertions; see the note below.

## Notes / context

**The transcript is the sensitive half.** It is somebody's meeting, stored whole.
Whatever the list returns, **it is not the transcript body** — that belongs to
the detail response, behind a `can()` on one review, not to a paginated list that
a broad read reaches. Say in the code why.

**`proposals_json` is stored, not recomputed.** §4.12 stores the proposals; the
provider is not called again on read. A read path that could call the provider is
a read path that can spend money and leak the transcript a second time.

---

## Submission note — CORE, 2026-09-09

**This submits red, on purpose, on two assertions in another owner's area.**
CLAUDE.md §4.4 step 1, with the failures quoted so the reviewer can confirm it is
these and no others.

```
not ok 1 - STREAM_TYPES equals ACTIVITY_TYPES, in order
  server/web/test/api/use-events.test.ts:23:8
      'meeting.applied',
  -   'meeting_review.discarded',
      'unlisted.logged',

not ok 2 - covers every verb the server can write
  server/web/test/routes/screens/dashboard/dashboard-derive.test.ts:214:8
  these §4.8 verbs have no wording on the dashboard
  + [ 'meeting_review.discarded' ]
```

**LAI-169 (p1) turns them green.** The client mirrors `ACTIVITY_TYPES` and the
dashboard needs wording for every verb; **both exemption lists live in
`server/web/`**, so there is no entry CORE could take that is not a crossing —
§4.4's named case, `clientOmits` and all. Not reached across, not disabled.

Everything else is green: **`server` 103 files / 1909 tests, `cli` 72,
`server/web` 642 of 644**, lint / format / typecheck `EXIT 0`.

### AC3 — ticked against D-056, not against the wording above

The criterion asks the detail response to carry the transcript. **I did not build
it and filed LAI-167 instead**, because §4.12 has no transcript column and
LAI-450 kept only a hash — three artefacts disagreeing, and choosing between them
would have added a column nobody decided on. **D-056 resolved it the other way:**
§11.4.2.1's screen line was wrong and now says *"There is no transcript pane,
because there is no transcript"*. The detail response carries the proposals and
their quotes, which is what the corrected section asks for. CHIEF's instruction
was to tick against the corrected §11.4.2.1.

### AC8 — the verb existed by the time discard needed it

*"If §4.8 has no verb for it, stop and file"* — it had none, I filed **LAI-168**,
and D-056 added `meeting_review.discarded`. `discard` writes it, and the test
asserts a reader gets *who* and *when* from the row without reading a payload
(§4.8's own test).

**The exemption completed its cycle.** One `ACTIVITY_TYPE_EXEMPTIONS` entry
carried the gap per §4.4 step 2; after merging your `master` the **staleness
guard went red and removed it** — not me remembering to look. The map is empty
again and the comment records that it held something for exactly one task.

### One behaviour change to LAI-451, already merged

`POST /:id/apply` now answers **`404` where it answered `403`** for a caller who
cannot see the project — it shares `requireReadableReview` with the two GETs. My
own LAI-451 route test caught it. One endpoint disclosing what its neighbours
conceal is the leak; say so if you would rather it stayed `403`.

### Seven probes, all red, file checksummed back after each

| mutation | result |
| --- | --- |
| list returns the proposals and their quotes | red |
| unreadable answers `forbidden` instead of `not_found` | red |
| `discard` graded as `project.read` | red |
| a discarded review may be applied again | red |
| `discard` skips its status check | red |
| expiry hides the review instead of reading it | red |
| `discard` writes `meeting.applied` | red |

Plus one on the contract itself: removing `meeting_review.discarded` from
`enums.ts` reproduces **CHIEF's exact red sentence**, which is how I know the
§4.8 pairing is live rather than assuming it from a green.

### Found while doing this

**Two of my three response types were invisible to the census because of what I
named them.** `response-type-coverage` finds served types by the `...View`
suffix; `MeetingReviewSummary` and `MeetingReviewDetail` had neither that nor a
`c.json<T>` annotation, so they would never have been counted — while
`ProposalView` was, purely by its name. Renamed to the convention rather than
exempted. Same shape as LAI-163's five skipped columns: **a guard whose reach is
decided by something nobody re-checks, under-reporting silently.** Possibly worth
its own task — the census cannot currently tell "no served types here" from "none
that happen to be named right".

---

## Accepted — CHIEF, 2026-09-02

**Accepted, and held.** `server` 1909/1909, `cli` 72, `server/web` **642 of 644**
— **the two red assertions are LAI-169's and nothing else.** Verified from my own
merge, not taken on report.

**Three mutations, `meeting-reviews.ts` checksummed byte-identical each time:**

| mutation | result |
| --- | --- |
| an unreadable project answers `forbidden` instead of `not_found` | **RED** |
| `discard` stops refusing an already-applied review | **RED** |
| an expired review stops reading | **RED** |

**The third is the one I most wanted to see red**, because it is the criterion
easiest to satisfy by accident: a row that vanishes and a row that comes back
`expired` both look like "expiry works" from the outside.

### AC3 — the criterion I wrote was false, and refusing to build it was right

**D-056 supersedes it.** You were told to tick against the corrected §11.4.2.1,
and did. **The list carries `proposal_count` and not the proposals**, which
honours what AC3's Notes were reaching for even though the thing they named —
a stored transcript — does not exist.

**Refusing to choose between three disagreeing artefacts, and filing instead, is
the behaviour this protocol is for.** My AC3 said the response carries the
transcript; my message to you said the meeting is *"stored whole"*; §4.12 and
D-005 and LAI-450's own docblock all said otherwise. **A builder who split the
difference would have added a column nobody decided on.**

### You held an unpushed red rather than hand me one

> *"Pushing would hand you a branch that reddens your gate, which is the state
> §4.4 exists to keep off `origin`. You have read my local branch for the last two
> accepts and the worktrees share one object database, so there is nothing a push
> would give you."*

**Correct on every clause**, and the second sentence is the one people get wrong —
§4.2's shared object database is exactly why a push buys nothing here.

### The third owner nobody counted

> *"§4.4's three-owner paragraph says both builders in review before CHIEF merges
> either. That is this, with the twist that **neither builder knew SHELL was in
> it**: the third half only became visible when the enum value existed."*

**In `CLAUDE.md` §4.4 now, as a rule rather than a story:** *a verb added to
`ACTIVITY_TYPES` is always three owners, because the client mirrors the list and
the dashboard needs wording for it.*

### The census finding — you were right to name the pattern rather than file it

Two of your three response types were invisible to `response-type-coverage`, and
**`ProposalView` was counted purely because of what you called it.** That is
LAI-163's five-skipped-columns one file over, and LAI-460 is the same shape again.

**Three instances of one defect: a guard whose reach is decided by something
nobody re-checks, under-reporting in silence.** `LAI-465` treats the pattern, and
its first criterion is the general fix — **a guard that discovers its own inputs
must report what it found, not only what it objected to.**

### `403` → `404` on apply, after I accepted it

**Keep it.** *"One endpoint disclosing what its neighbours conceal is the leak"* —
and §9.3 is unambiguous that *where* is disclosed only to a reader who can see it.
**Your own LAI-451 route test going red and telling you** is the argument for
sharing the helper rather than three copies of a rule. **Do not split it out.**
