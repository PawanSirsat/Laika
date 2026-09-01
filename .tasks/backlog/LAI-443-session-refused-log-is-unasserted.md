---
id: LAI-443
title: '`auth.session_refused` is unasserted — the same hole LAI-437 just closed, one branch over'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-437]
discovered-from: LAI-437
status: backlog
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

- [ ] A test asserts `auth.session_refused` is emitted for a **deactivated
      user's session cookie**, with its `code`, and turns red when the branch is
      removed or made unreachable.
- [ ] It asserts the **specific** code, not merely that a line exists — LAI-437's
      own comment makes that point: *"a branch that logs `unknown` for a revoked
      token satisfies 'a line exists' and is still wrong."*
- [ ] **The two log branches are tested together**, or at least adjacently, so
      the ordering between them is visible to a reader — that ordering is what
      broke last time and it is invisible from either test alone.
- [ ] The mutation is run: make the branch unreachable, watch the new test go
      red. This task exists because a mutation that *did not* go red found the
      original.

## Notes / context

**Do not merge the two branches.** They log different things for different
reasons — a rejected token has a `reason` and no session; a deactivated account
has a session and a `code`. Collapsing them is what caused the original bug.

**This is a log-only guard and it is worth having anyway.** §6.1 keeps the reason
out of the response deliberately, so the log is the *only* place the distinction
survives. An operator debugging "why was this refused" has nothing else.
