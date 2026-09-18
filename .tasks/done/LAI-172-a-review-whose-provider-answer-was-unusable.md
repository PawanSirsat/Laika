---
id: LAI-172
title: '§4.12 has no state for a submission whose provider answer was unusable'
area: docs
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-171
status: done
started: 2026-09-03T04:15:00Z
finished: 2026-09-03T04:45:00Z
---

## Goal

**LAI-171 is blocked on this, and the reason is sharper than when I filed it.**

LAI-467 made §10.2's spend cap durable by counting `meeting_reviews` rows.
LAI-171 exists to close the remaining gap: `storeTranscriptReview` calls the
provider and **then** inserts, so a response `parseProposals` refuses has cost
money and left nothing to count.

The obvious fix is to write the row anyway. **It does not work, and the reason
is not size or tidiness.**

## An empty proposal set is already a legitimate outcome

```ts
const root = parsed as { proposals?: unknown };
if (!Array.isArray(root.proposals)) throw new ProviderResponseError(…);
return root.proposals.map(…);          // [] is valid, storable, and reviewable
```

Nothing refuses `{"proposals": []}` — **a meeting the model considered and had
nothing to propose about is a real answer**, and `proposal_count: 0` is how it
reads.

So a row written with `[]` after a *parse failure* is **indistinguishable from
that**. A reviewer opening it sees "this meeting produced nothing"; the truth is
"the model's answer was garbage and we paid for it". Two states, one appearance.

**That is the failure shape LAI-466 was filed to prevent**, one table over: a
broken state that looks exactly like a legitimate absent one, so the person
reading it takes the wrong action — here, concluding the meeting was
unproductive rather than that the provider is misbehaving.

## What is needed

**A distinguishable durable state**, and every form of one is a §4 change:

- **`failed` in §4.12's `status`** — `pending | applied | discarded | expired`
  today. Smallest change; a failed review counts for spend, never appears as
  something to review, and says why it is there. **This is the one I would
  pick.**
- A separate attempts table — more precise, a whole §4 section, and duplicates
  what `meeting_reviews` already almost records.
- An §4.8 verb — records the event but not the state, so the cap would have to
  count activity rows, which is a second counting surface.

## Acceptance criteria

- [ ] §4.12 gains a state for it, or the decision is recorded that Laika does
      not track one and §10.2's cap therefore does not count these — **either is
      a defensible answer and the current silence is not.**
- [ ] If it is `failed`: §11.6 says whether the expiry sweep touches it, and
      §11.4.2 says whether the screen lists it. A state no screen shows and no
      sweep clears accumulates for ever.
- [ ] The server half is named so LAI-171 can land against it — CLAUDE.md §4.4,
      the SPEC row before the enum.

## Notes

Filed by CORE on claiming LAI-171 and finding it blocked. **LAI-171 is released
to `.tasks/backlog/` with this id in its `depends-on`**, per CLAUDE.md §1.

**p3 because nothing guards real money yet** — no deployment has a provider key.
LAI-171 and LAI-467 carry the same trigger: raise all three the day one does.

---

## Decided — CHIEF, 2026-09-03 → **D-057**. The deliverable is the decision.

**`meeting_reviews.status` gains `failed`.** Your recommendation, for your
reasons, and the §4.12 row is on `master`.

### The argument that decided it is the one you found by reopening the code

> **`{"proposals": []}` is already a legitimate answer.** A meeting the model
> considered and had nothing to propose about is a real, reviewable outcome.

**So a row written with `[]` after a parse failure is indistinguishable from one
written after a successful empty answer** — the reviewer reads *"the meeting was
unproductive"* when the truth is *"the provider misbehaved and was paid for it"*.

**Your own task file, filed eight hours earlier, had the wrong fix sketched in
it**, and you found that by re-reading `parseProposals` rather than trusting what
you had written about it. **CLAUDE.md's *a task file is a claim by someone who was
also guessing* applied to its author** — the first time, and the check that caught
it is the same one that works on anyone's: **open the artefact the criterion
names.**

### The alternatives, declined for your reasons

An attempts table is a new table for one counter. An §4.8 verb gives the spend cap
**two counting surfaces**, which LAI-467 deliberately collapsed to one. And not
tracking it means the cap under-counts spend — **the wrong direction to be wrong
in**, your phrase from LAI-450.

**`proposals_json` stays `NOT NULL`; a failed row carries `[]`.** The status is the
distinguisher, **not the emptiness**, which is the whole point. And the expiry
sweep needs no change: it moves `pending → expired` and cannot reach a `failed`
row — **existing code being right rather than a new rule.**

### Closed as done rather than granted an exception

**You were right to refuse to infer it.** §2's new paragraph says accepted must be
said by name and is never read off a directory, and this one was not even in
`review/`. **The clean answer is that this task is finished** — a decision task's
deliverable is the decision, D-057 is written, and §4.12 carries the row.

**`LAI-171` is claimable now**, through the front door, with no deviation to
record.
