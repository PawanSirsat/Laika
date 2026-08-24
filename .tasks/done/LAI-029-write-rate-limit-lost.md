---
id: LAI-029
title: The per-write rate limit exists in neither the spec nor the code
area: docs
assignee: pm
priority: p2
depends-on: []
discovered-from: LAI-006
status: done
started: 2026-08-24T06:25:00+05:30
finished: 2026-08-24T06:30:00+05:30
reviewed: 2026-08-24T06:30:00+05:30
---

## Goal

LAI-006's criterion said "600 req/min general, **60/min writes**, 30/min
heartbeats". SPEC §6.3 says "120 req/min per token, 600/min per session, 30/min
for heartbeats" — **no write limit at all**. The implementation follows the spec,
which is correct under D-011.

So the write-specific limit was lost in the spec merge, and nobody noticed until
the review. Decide whether it should exist.

## Acceptance criteria

- [x] A decision recorded: either §6.3 gains a write budget, or it states
      explicitly that writes share the general budget and why.
- [x] If a write limit is added, a follow-up task implements it. If not, LAI-006's
      already-corrected criterion stands and no code changes.

## Notes / context

The argument for a separate write budget: reads are cheap and cacheable, writes
hit SQLite's single writer (D-001) and every one of them writes an `activity`
row. An agent looping on `update_status` can starve the board for everyone else
while staying far inside 600/min. The write path is the scarce resource, and it is
the one without its own limit.

The argument against: two buckets is more machinery, and 120/min per token
already bounds the agent case — which is the one that worries us — more tightly
than 60/min writes would have, since a token cannot exceed 120 of *anything*.

**PM's read: probably not needed.** The per-token 120/min already covers the
scenario the write limit was invented for. Recording it rather than deleting it
quietly, because "we considered it and here is why not" is worth more later than
silence.

---

## Resolution — PM, 2026-08-24

**Decided: no separate write budget.** SPEC §6.3 now states that writes share the
general budget and why. Recorded as **D-021.2**.

Per-token 120/min already bounds the case the write limit was invented for — an
agent looping on `update_status` — more tightly than 60/min writes would, since a
token cannot exceed 120 requests of *any* kind. A second bucket is machinery for
a case the first already covers.

**The counter-argument is recorded rather than dismissed**, because it is good:
writes hit SQLite's single writer (D-001) and each one writes an `activity` row,
so the write path is the scarce resource and it is the one without its own limit.
If write contention ever appears, D-021 names this as the first thing to revisit.

No code change — the implementation already matches.
