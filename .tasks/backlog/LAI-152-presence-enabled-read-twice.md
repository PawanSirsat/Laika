---
id: LAI-152
title: '`presenceEnabled` is byte-identical in two services, and I wrote both today'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-140
status: backlog
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

- [ ] One reader, in `db/orgs.ts` beside `requireOrg` — it is a query with no
      policy in it, which is what `db/` is for (CONVENTIONS §2).
- [ ] Both services call it.
- [ ] **The no-org answer stays `true`, and is stated once.** Presence is on by
      default (§4.2) and an instance with no org has nothing to have disabled;
      today that reasoning exists in neither copy, only in the `?? 1`.
- [ ] A test that the shared reader answers `true` with no org at all — the case
      neither private copy tests today.

## Notes / context

**Do not give it a non-throwing twin unless it has a caller.** `db/orgs.ts` says
so about `requireOrgId` and the rule applies to itself: this one is genuinely
non-throwing because "no org" has a correct answer here, unlike the id.

**Both callers read it for different purposes** — `heartbeats.ts` to decide
whether to store a row at all (LAI-150), `presence.ts` to set `enabled` on the
response (LAI-432). That is two callers of one fact, not two facts.
