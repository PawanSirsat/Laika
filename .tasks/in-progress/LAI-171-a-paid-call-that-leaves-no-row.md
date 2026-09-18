---
id: LAI-171
title: 'A provider call whose response will not parse costs money and leaves no row'
area: server
assignee: core
priority: p3
depends-on: [LAI-467, LAI-172]
discovered-from: LAI-467
status: in-progress
started: 2026-09-10T02:50:00Z
---

## Goal

LAI-467 made §10.2's spend cap durable by **deriving it from `meeting_reviews`**,
which is a strict improvement — a count you can recompute cannot drift — and it
leaves one path uncounted.

`storeTranscriptReview` calls the provider and *then* inserts:

```ts
const proposals = parseProposals(await client.complete({ prompt }));   // money
db.insert(meetingReviews).values({ … })                                // the row
```

**A model that returns something `parseProposals` refuses has cost money and left
no row**, so it does not consume budget. Repeated, it is unbounded spend behind a
cap that reads zero.

A malformed *request* body is fine and should stay uncounted: it is rejected
before the provider is reached, so it spends nothing.

## Why it is p3 and what raises it

**Nothing here guards real money yet** — §12's provider config exists and no
deployment has a key in it. LAI-467 carries the same trigger: **raise this the
day one does.**

It is also the *smaller* half of what LAI-467 fixed. A restart forgave the entire
month's count; this forgives the submissions whose provider answered badly, which
needs a provider that is both configured and misbehaving.

## Acceptance criteria

- [ ] **An attempt is recorded before the provider is called**, durably, so a
      response that fails to parse still consumes budget.
- [ ] **Where it is recorded is the decision.** A `meeting_reviews` row written
      up front and completed after is one option and it changes what a review row
      means — a `pending` row that never gets proposals is now a thing readers
      must handle (§11.4.2's screen, `getMeetingReview`, the expiry sweep). A
      separate attempts table is the other, and it is a §4 change, so **CHIEF
      writes the row before the server half lands** (CLAUDE.md §4.4).
- [ ] **A failed parse still counts**, asserted with a provider double that
      returns unparseable output — and the count is read back through
      `submissionsInWindow` or whatever replaces it.
- [ ] **A rejected request body still does not count.** The distinction is the
      point: it never reached the provider.
- [ ] Full gate green — **`EXIT 0`**.

## Notes

Found and written down by CORE while doing LAI-467, not discovered later:
`submissionsInWindow`'s docblock names this gap and points here, so the next
reader of the cap meets the limitation at the same time as the mechanism.

**Do not close it by moving the insert before the provider call without deciding
what a proposal-less review row means.** That is the trap — it makes the count
right and leaves a row shape three readers do not expect.

---

## Released by CORE, 2026-09-10 — blocked on LAI-172

Claimed, investigated, and released unstarted. **The obvious implementation does
not work, and finding out why is the useful part.**

AC2 offered *"a `meeting_reviews` row written up front and completed after"* as
one option, and worried it makes a proposal-less row something readers must
handle. **The real problem is worse: `{"proposals": []}` is already a legitimate
answer.** Nothing in `parseProposals` refuses it, and a meeting the model
considered and had nothing to propose about is a real, reviewable outcome with
`proposal_count: 0`.

So a row written with `[]` after a **parse failure** is indistinguishable from
one written after a **successful empty answer**. A reviewer opening it concludes
the meeting was unproductive; the truth is the provider misbehaved and was paid
for it.

**That is LAI-466's failure shape one table over** — a broken state that looks
exactly like a legitimate absent one — and it is the thing I spent that task
asserting against.

Every form of a distinguishable state is a §4 change: a `failed` status in
§4.12, a separate attempts table, or an §4.8 verb. **LAI-172 filed** with the
argument and a recommendation (`failed`), and this task now depends on it.

Nothing was implemented, so there is nothing to unpick.
