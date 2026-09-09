---
id: LAI-454
title: 'Reading a meeting review, and discarding one — §11.4.2''s other three endpoints'
area: server
assignee: core
priority: p2
depends-on: [LAI-450]
discovered-from: LAI-450
status: in-progress
started: 2026-09-09T17:35:00Z
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

- [ ] **All three call `can()`** against the actor, with the resource in hand.
      `discard` is a write and does not borrow a read action.
- [ ] **The list is scoped to the project and paginated** like every other list
      (§6.2), and a member of another project gets `not_found`, not `forbidden` —
      §9.3's rule that *where* is only disclosed to a reader who can see it.
- [ ] **The detail response carries the transcript and the proposals together**,
      because §11.4.2 puts them side by side: *"transcript on one side, proposals
      on the other."* One request, not two.
- [ ] **Each proposal carries its `quote`** — §11.4.2 requires *"each proposal
      shows its transcript quote"*, and a proposal a human cannot trace to a
      sentence is one they cannot honestly accept.
- [ ] **The four kinds survive the round trip**: `NEW` / `CHANGED` / `DEAD` /
      `DECISION`. Assert **all four by name**, not a count — the LAI-419 rule.
- [ ] **A discarded review cannot then be applied**, and an applied one cannot be
      discarded. Assert the `code`, not that something threw.
- [ ] **An expired review still reads.** Expiry stops it being *applied* (§11.6);
      a human must still be able to see what they missed and why nothing landed.
      **Assert the `status` comes back `expired`** rather than the row vanishing.
- [ ] `discard` writes an activity row. If §4.8 has no verb for it, **stop and
      file** — do not borrow `meeting.applied` for a discard.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**The transcript is the sensitive half.** It is somebody's meeting, stored whole.
Whatever the list returns, **it is not the transcript body** — that belongs to
the detail response, behind a `can()` on one review, not to a paginated list that
a broad read reaches. Say in the code why.

**`proposals_json` is stored, not recomputed.** §4.12 stores the proposals; the
provider is not called again on read. A read path that could call the provider is
a read path that can spend money and leak the transcript a second time.
