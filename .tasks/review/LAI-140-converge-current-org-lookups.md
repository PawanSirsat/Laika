---
id: LAI-140
title: Two services still answer "which org" privately
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-405
status: review
started: 2026-09-02T06:10:00Z
finished: 2026-09-02T06:40:00Z
---

## Goal

`db/orgs.ts` now holds `requireOrgId`, added in LAI-405 when `unlisted.ts` was
about to become the **third** private copy of the same three-line query. The
first two are still private:

- `server/src/services/invites.ts` — `currentOrg(db)`, returns `{ id, name }`
- `server/src/services/tokens.ts` — `currentOrgId(db)`

Laika is single-org (§4.2), so this is a lookup with exactly one answer. Three
copies is three chances to disagree about the one case that differs: **what
happens when there is no org yet**, which first boot hits and which each copy
currently decides for itself. `tokens.ts` throws a `not_found` `ApiError`,
`db/orgs.ts` throws a plain `Error`, and `invites.ts` does something else again.

Not urgent and not a bug today. It is three declarations of one fact, which is
the shape that eventually drifts.

## Acceptance criteria

- [x] `invites.ts` and `tokens.ts` use `db/orgs.ts` rather than their own copies,
      or the task explains why one of them genuinely needs different behaviour.
- [x] **The no-org case answers the same way everywhere**, and the log says what
      that answer is. Today the three disagree; picking one is the point of the
      task, and `ApiError('not_found')` versus a plain `Error` is a real
      difference — one becomes a 404, the other a 500.
- [x] `invites.ts` needs the org **name** as well as the id. Either `db/orgs.ts`
      grows a second function with a caller, or `invites.ts` reads the name where
      it needs it — do not add an unused shape.
- [x] A test asserts the shared lookup behaves identically for the callers that
      switch to it, so this is a refactor and not a quiet behaviour change.
- [x] Full gate green.

## Notes / context

No new dependencies.

`db/orgs.ts` deliberately exports only the throwing form, because that is the
only shape with a caller. If a converged version needs a non-throwing one, add
it **with** its caller rather than ahead of it.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1638 server, 585 web, lint and format clean.**

### The answer picked, and why

Three copies gave three answers; **there was a fourth the task did not know
about**. `activity.ts:orgIdFor` threw `conflict` without details — found by
`grep`, not by reading.

| copy | answer | as HTTP |
| --- | --- | --- |
| `invites.ts` | `conflict` | 409 |
| `tokens.ts` | `not_found` | **404** |
| `db/orgs.ts` | plain `Error` | **500** |
| `activity.ts` | `conflict`, no details | 409 |

**A 404 says the thing is missing; a 500 says the server broke. Neither is
true.** Reaching any of these without an org means the **setup gate was
bypassed** — every API path is gated — so the answer is the gate's own:
`conflict` with `setup_required: true`. A caller past the gate sees what the gate
would have told it, in one shape.

**Not `setup_path`**: `db/` does not know about routes and should not learn. A
client that reached here has already seen the gate's answer, which carries it.

### The fourth copy is converged too, and that is a judgement

AC1 names `invites.ts` and `tokens.ts`. Converging three of four and filing the
last would leave the drift this task exists to remove, under a different file
name — and the Goal's own words are *"three declarations of one fact"*. It is
three lines and it strictly reduces the thing being fixed, so I took it. Say if
you would rather it had been filed.

### What I did **not** widen into

The same `grep` found `presenceEnabled` **byte-identical in two services**, both
written by me today (LAI-430 and LAI-432, an hour apart). That is a different
fact about the same row — a flag, with a different default and a different reason
for it — so it is **LAI-152**, filed, not folded in.

That is the same shape as this task one column over, and I did not notice it
while writing either copy. It took converging something else to see it.

### A behaviour change, stated

`test/db/orgs.test.ts`'s no-org assertion moved from a plain `Error` to the
gate's answer. The reasoning is at the site, because the next reader meets the
test before this file.

Four mutations, all caught: back to a 404, back to a plain `Error`,
`requireOrgId` no longer delegating, and returning undefined instead of throwing.
