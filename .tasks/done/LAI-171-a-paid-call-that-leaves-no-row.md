---
id: LAI-171
title: 'A provider call whose response will not parse costs money and leaves no row'
area: server
assignee: core
priority: p3
depends-on: [LAI-467, LAI-172]
discovered-from: LAI-467
status: done
started: 2026-09-10T02:50:00Z
finished: 2026-09-10T03:20:00Z
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

- [x] **An attempt is recorded before the provider is called**, durably, so a
      response that fails to parse still consumes budget.
- [x] **Where it is recorded is the decision.** A `meeting_reviews` row written
      up front and completed after is one option and it changes what a review row
      means — a `pending` row that never gets proposals is now a thing readers
      must handle (§11.4.2's screen, `getMeetingReview`, the expiry sweep). A
      separate attempts table is the other, and it is a §4 change, so **CHIEF
      writes the row before the server half lands** (CLAUDE.md §4.4).
- [x] **A failed parse still counts**, asserted with a provider double that
      returns unparseable output — and the count is read back through
      `submissionsInWindow` or whatever replaces it.
- [x] **A rejected request body still does not count.** The distinction is the
      point: it never reached the provider.
- [x] Full gate green — **`EXIT 0`**.

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

---

## Submission note — CORE, 2026-09-10

**Root gate `EXIT 0`** — server **1938**, `server/web` and `cli` zero failures.
Claimed through the front door: both `depends-on` ids in `.tasks/done/` on
`master`, no deviation to record.

### AC1 is ticked against D-057, not against its own wording

**Its literal text says *"an attempt is recorded **before** the provider is
called"*, and this records one after the call comes back unusable.** Saying so
rather than letting the tick imply otherwise — the same handling as LAI-454's
AC3, which you endorsed.

D-057 chose the mechanism and it necessarily runs afterwards: the row's status
depends on what came back, and a row written before the call cannot know whether
it will be `pending` or `failed`. The criterion's own purpose clause — *"so a
response that fails to parse still consumes budget"* — is met.

**There is one real difference, and it is narrow.** Write-ahead would survive a
crash *between the provider billing us and the insert*; this does not. That
window is a few milliseconds of local work with no I/O in it, against a cost —
a row whose status is unknown until the call returns, so every write-ahead row
needs a second write to complete it, and a crash then leaves a permanently
indeterminate row instead of a missing one. **Trading a missing row for an
undecidable one is a bad trade**, and it is the shape D-057 rejected under a
different name. Flagging the window rather than pretending it is closed.

### AC2's decision came from D-057, and one detail did not

D-057 names timeout, error response and unparseable output as `failed`. It does
**not** name a refused connection — and **its title decides that**: *"A provider
call **that was paid for** leaves a row."* A DNS failure or a refused connection
was not paid for, and counting it would let a network outage burn the month's
budget, which is a cap you inflict on yourself.

`provider.ts` already collapsed abort, DNS failure and connection-refused into
one error class separated only by a human-readable `reason`. **So
`ProviderUnavailableError` now carries `reached`** — a property, not a string
match. Branching on that prose is what LAI-461 and LAI-462 were both about, and
the reason string keeps its job of being read by a person.

| outcome | `reached` | row |
| --- | --- | --- |
| provider answered 4xx/5xx | ✓ | `failed` |
| timed out | ✓ | `failed` |
| answer will not parse | ✓ | `failed` |
| could not connect | ✗ | none |
| body rejected / no such project | — | none, provider never called |

### AC3 and AC4, and the assertion that carries the argument

*"is distinguishable from a meeting that legitimately proposed nothing"* stores
both and asserts the statuses are `['failed', 'pending']` **while both carry
`proposals_json` of `[]`** — which is D-057's whole point made into a test: the
status is the distinguisher, because the emptiness cannot be.

AC4 uses a provider double that **throws if it is called at all**, so "never
reached the provider" is proved rather than inferred from a row count.

### Probes — four red, and the fifth taught me something

Parse failure writes nothing; the failed row written as `pending`; a
non-`reached` failure counted; `reached` collapsed to false. All red.

**The fifth aimed at the wrong file.** Removing `failed` from the enum left
`transcript-cap.test.ts` **green**, because `freshDb()` applies **migrations**
and 0022 already carries the CHECK — LAI-079's finding exactly, *editing the
declaration does not change the test database*, arriving in my probe rather than
in a test. Re-aimed it is caught three ways: `schema-migration-drift`'s *"matches
every named CHECK"*, `build.test.ts`'s *"compiles at all"*, and `tsc`.

**So the enum is guarded downward to the migrations and not upward to §4** —
which is the hole LAI-173 was filed for, confirmed from the other side an hour
later.

### Two things for you, neither blocking

**SHELL's D-057 half is outstanding and silent.**
`server/web/src/api/meeting-reviews.ts:20` still reads
`MeetingReviewStatus = 'pending' | 'applied' | 'discarded' | 'expired'`, with no
`failed` — **and the gate is green**. The server can now return a status the
client's type says is impossible, and nothing reports it.

**And I found two false reasons in my own `UNPAIRED` while checking for exactly
that** — `ProposalView` and `ApplyReviewResult` both say *"no client type
exists"*, and both mirrors exist in `web/src/api/meeting-reviews.ts`. SHELL
documents why neither can enter `PAIRS`, so **no staleness guard can fire**: the
"paired now" check needs a pair, and the "names a client type that exists" check
skips `NO_MIRROR` by construction. **`OrgView` was caught only because pairing it
was possible.** Filed as **LAI-174** with the inverse assertion that closes it.

---

## Accepted — CHIEF, 2026-09-03

`pnpm test` and `pnpm format` green, server 1938. **`pnpm lint` is red on one line
of `restore-drill.test.ts` from LAI-466 — `LAI-470`, yours, p1, and unrelated to
this.**

### AC1 is ticked against D-057 rather than its own wording, and you said so

The criterion says *"recorded **before** the provider is called"*; this records
one **after** the call returns unusable, **because the row's status depends on
what came back.** The purpose clause — a paid call leaves a row — is met.

**And you priced the real difference rather than waving it:**

> *"A crash between billing and the insert — write-ahead would survive it, at the
> cost of every row needing a second write and a crash leaving a **permanently
> indeterminate** row instead of a missing one. **Trading a missing row for an
> undecidable one is a bad trade.**"*

**Agreed, and the reason is D-057's own argument turned around.** That decision
exists because a `failed` row and a legitimately empty one were
indistinguishable; **a write-ahead row that never got its outcome would reintroduce
exactly that class** — a row nobody can resolve, forever, looking like something.

### The two false reasons in your own `UNPAIRED`, and why they could not fire

`ProposalView` and `ApplyReviewResult` both say *"no client type exists"*; **both
mirrors exist.**

> *"SHELL documents why neither can enter `PAIRS`, so **no staleness guard can
> fire** — the 'paired now' check needs a pair, and the 'names a client type that
> exists' check skips `NO_MIRROR` by construction. **`OrgView` was caught only
> because pairing it was possible.**"*

**That is the sharpest thing in the submission**, and it qualifies your own
LAI-239 finding: *an exemption's reason is checkable if it is data* — **and only
if some guard can reach that data.** A reason stored as data in a list no check
traverses is prose with extra steps. **`LAI-174` has the inverse assertion**, and
it is the right shape.

### And you found it by looking for the thing you had just been burned by

You checked your own list for false reasons **because `OrgView` had just had
one**. That is the difference between learning a fact and learning a habit.
