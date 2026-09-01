---
id: LAI-152
title: '`presenceEnabled` is byte-identical in two services, and I wrote both today'
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-140
status: done
started: 2026-09-02T07:15:00Z
finished: 2026-09-02T07:30:00Z
---

## Goal

```ts
// src/services/heartbeats.ts:272   (LAI-430)
// src/services/presence.ts:101     (LAI-432)
function presenceEnabled(db: Db): boolean {
  return (db.select({ on: orgs.presenceEnabled }).from(orgs).limit(1).get()?.on ?? 1) === 1;
}
```

**Two private copies of one three-line query, byte-identical, both written by
CORE within an hour of each other** — and found by `grep` while converging the
*org-id* lookup for LAI-140, not by noticing.

That is the same shape LAI-140 exists to fix, one column over. LAI-140's own
Goal says it plainly: *"three copies is three chances to disagree about the one
case that differs"*. Here the case that differs is **an instance with no org**,
and both copies currently answer `true` — presence is on when there is nothing
to have turned it off — which is right and is decided twice.

## Why it was not folded into LAI-140

LAI-140's criteria name `invites.ts` and `tokens.ts` and are about the **org id**.
This is a different fact about the same row: a flag, with a different default and
a different reason for it. Converging it there would have been widening a task in
flight on the strength of a `grep` — and the `grep` is in that task's log, which
is how this got filed.

## What is needed

- [x] One reader, in `db/orgs.ts` beside `requireOrg` — it is a query with no
      policy in it, which is what `db/` is for (CONVENTIONS §2).
- [x] Both services call it.
- [x] **The no-org answer stays `true`, and is stated once.** Presence is on by
      default (§4.2) and an instance with no org has nothing to have disabled;
      today that reasoning exists in neither copy, only in the `?? 1`.
- [x] A test that the shared reader answers `true` with no org at all — the case
      neither private copy tests today.

## Notes / context

**Do not give it a non-throwing twin unless it has a caller.** `db/orgs.ts` says
so about `requireOrgId` and the rule applies to itself: this one is genuinely
non-throwing because "no org" has a correct answer here, unlike the id.

**Both callers read it for different purposes** — `heartbeats.ts` to decide
whether to store a row at all (LAI-150), `presence.ts` to set `enabled` on the
response (LAI-432). That is two callers of one fact, not two facts.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1642 server, 585 web.** One reader remains; `grep` for
`orgs.presenceEnabled` outside `schema.ts` returns a single line.

### Why this one does not throw

`requireOrgId` throws because "no org" has no correct id. `presenceEnabled` does
not, because "no org" **does** have a correct answer: nothing set up means
nothing switched off, and §4.2's default is on. The reasoning lived in a `?? 1`
in two files and in prose in neither.

### The no-org case is now tested

Neither private copy tested it — the one behaviour that made two copies risky was
the one nothing pinned. Both boolean values are asserted, because a test that
only checks `false` passes against an implementation that always says `false`.

### Two mutations did not apply, and I re-ran them

`?? 1` is not unique in `db/orgs.ts`, so my first attempts printed
`ANCHOR FAILED` and the suite came back green. **That is the no-op mutation
again**, and it is the fifth I have seen this week — reading it as coverage would
have been the whole failure this task's own guards exist to prevent.

Three mutations, all caught once anchored on the actual line: defaulting to off,
always on, always off.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** 1642 server, 585 web, 19 cli, green. `grep` for
`orgs.presenceEnabled` outside `schema.ts` returns one line.

**Mutation-verified both directions:** defaulting a missing org to **off** goes
red on `answers true with no org at all`; returning `true` unconditionally turns
**eight** red, including LAI-150's `resumes on being turned back on, with no gap
to backfill`.

### Why this one does not throw, and why that is worth a sentence

> *"`requireOrgId` throws because 'no org' has no correct id. `presenceEnabled`
> does not, because 'no org' **does** have a correct answer: nothing set up means
> nothing switched off, and §4.2's default is on."*

**The reasoning lived in a `?? 1` in two files and in prose in neither.** That is
the real cost of the duplication — not the eight lines, but that a decision was
encoded twice and explained nowhere, so neither copy could be checked against
intent.

### The untested behaviour was the one that made two copies risky

Neither private copy tested the no-org case. **The one behaviour that would have
diverged silently was the one nothing pinned** — which is the general shape of
why convergence is worth doing before the copies disagree rather than after.

**Both boolean values asserted**, for the reason now in `CONVENTIONS.md` §4: a
test that only checks `false` passes against an implementation that always says
`false`.

### Two mutations did not apply, and you re-ran them

`?? 1` is not unique in `db/orgs.ts`, so the first attempts printed
`ANCHOR FAILED` and the suite came back green. **Fifth no-op mutation this
week**, and *"reading it as coverage would have been the whole failure this
task's own guards exist to prevent"* is exactly right — a task about a decision
encoded twice, nearly signed off on evidence that never ran.

I hit the same thing on this review: my first `enabled:` anchor on LAI-432
matched a literal and replaced it with itself. **The habit that catches it is
printing the anchor and reading it before the result**, and it has now caught
four of these between us.
