---
id: LAI-443
title: '`auth.session_refused` is unasserted — the same hole LAI-437 just closed, one branch over'
area: server
assignee: core
priority: p3
depends-on: [LAI-437]
discovered-from: LAI-437
status: review
started: 2026-09-01T14:30:00Z
finished: 2026-09-01T14:45:00Z
---

## Goal

LAI-437 pinned `auth.token_rejected` with a test that turns red if its branch
becomes unreachable again. **The branch below it has no such test.**

Measured during LAI-437's review: neutralising the `ApiError` branch in
`http/middleware/auth.ts` — `if (false)` in place of `if (err instanceof
ApiError)` — leaves **120 of 120 passing**.

**The behaviour survives**, and that is why nothing notices: LAI-437 made the
catch rethrow everything it does not recognise, so a deactivated user's
`ApiError` still reaches the error handler and still answers
`403 "This account has been deactivated"`. **What is lost is the log line**,
`auth.session_refused`, and nothing asserts it.

## Why it is the same defect and not a smaller one

`auth.token_rejected` was unreachable for a whole day — from LAI-442 to LAI-437 —
and *"nothing caught it because the status was right either way"*. **That is
exactly the state this branch is in now**: the response is correct, the log is
gone, and every test passes.

The only difference is that this one is currently *reachable*. Nothing keeps it
that way.

## Acceptance criteria

- [x] A test asserts `auth.session_refused` is emitted for a **deactivated
      user's session cookie**, with its `code`, and turns red when the branch is
      removed or made unreachable.
- [x] It asserts the **specific** code, not merely that a line exists — LAI-437's
      own comment makes that point: *"a branch that logs `unknown` for a revoked
      token satisfies 'a line exists' and is still wrong."*
- [x] **The two log branches are tested together**, or at least adjacently, so
      the ordering between them is visible to a reader — that ordering is what
      broke last time and it is invisible from either test alone.
- [x] The mutation is run: make the branch unreachable, watch the new test go
      red. This task exists because a mutation that *did not* go red found the
      original.

## Notes / context

**Do not merge the two branches.** They log different things for different
reasons — a rejected token has a `reason` and no session; a deactivated account
has a session and a `code`. Collapsing them is what caused the original bug.

**This is a log-only guard and it is worth having anyway.** §6.1 keeps the reason
out of the response deliberately, so the log is the *only* place the distinction
survives. An operator debugging "why was this refused" has nothing else.

## Outcome

Three tests in `test/http/middleware/auth.test.ts`, **placed immediately next to
the `token_rejected` case** rather than in `deactivated.test.ts` where the
subject would otherwise put them. AC3 is the reason and it is the right one: the
ordering is the behaviour, and it is invisible from either test alone.

- `logs session_refused, with its code, for a deactivated account` — asserts
  `code: 'forbidden'`, not that a line exists.
- `logs token_rejected and not session_refused for a refused token` — **the
  ordering, asserted as an ordering.** This is the assertion that was missing
  when LAI-442 landed: both branches were individually correct and the one above
  swallowed the one below.
- `logs session_refused and not token_rejected for a deactivated account` — the
  other direction, so *"log both lines every time"* does not satisfy the pair. A
  reader learns nothing from two lines that always appear.

Each has a working-first step so it cannot pass against a credential that was
never valid.

### The mutations, including yours

| mutation | before | now |
| --- | --- | --- |
| `if (false)` in place of `if (err instanceof ApiError)` | **120/120 passing** | red — 2 tests |
| `ApiError` branch above `TokenAuthError` again (the LAI-442 regression) | — | red — 2 tests |
| log a fixed `code: 'unauthorized'` instead of `err.code` | — | red — 1 test |

The second one is worth noting: it turns **LAI-437's** test red as well as one of
these. That is the pair working — the ordering is one property and it now fails
from whichever side you break it.

Each mutation printed that it had landed before its run. One earlier in this
sequence of tasks printed `ANCHOR FAILED` instead and did not run, and its
`EXIT=0` would have read as coverage.

### On not merging the two branches

The Notes say do not, and I did not. They carry genuinely different payloads —
a rejected token has a `reason` and no session; a deactivated account has a
session and a `code` — and the negative assertions above now make a future merge
fail rather than quietly halve the information.

### Gate

`@laika/server` **1713/1713**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0.

**`server/web` is still red on one assertion, and it is LAI-208's**, not this
task's: `TaskView.stale_flagged_at is served and Task does not declare it`.
It clears when LAI-157 lands. Nothing else fails.
