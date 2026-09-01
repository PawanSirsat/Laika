---
id: LAI-437
title: A read-only database reports as "Not signed in"
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-434
status: review
started: 2026-09-01T13:05:00Z
finished: 2026-09-01T13:40:00Z
---

## Goal

Found by breaking a real instance: after restoring a database file with the wrong
owner, **every token-authenticated request returned `401 unauthorized — "Not
signed in"`**. The cause was in the log and not in the response:

```
{"message":"attempt to write a readonly database","event":"auth.resolve_failed"}
{"code":"unauthorized","status":401,"message":"Not signed in"}
```

`resolveActor` updates `tokens.last_used_at`. On a read-only database that write
throws, the resolver catches it, and **an infrastructure failure is reported as a
credential failure.**

## Why this matters more than it looks

**It sends the operator to the wrong place.** *"Not signed in"* means "your token
is wrong": rotate it, mint a new one, check you copied it correctly. None of that
can work, because the token was always fine — the disk is read-only, the volume
is full, or the file has the wrong owner. **Every minute spent on the credential
is a minute the real cause is not being looked at.**

**Third instance of this exact family.** LAI-224 rendered a `403` as *"can't
reach the instance"*. LAI-090 answered a rate-limited sign-in with *"email or
password is wrong"*. Both sent a reader somewhere that could not help, and both
have their own task because the failure is invisible until somebody hits it.

**And it is silent in the happy path**, so no existing test catches it: the
resolver's catch-all is only reached when something underneath is broken.

## Acceptance criteria

- [x] A resolver failure that is **not** a credential problem does not answer
      `unauthorized`. A `SQLITE_READONLY`, a full disk, or any unexpected throw
      is a **`500`/`internal`** with the §6.3 shape — the request is not
      unauthenticated, it is unserviceable.
- [x] The distinction is made on **what was thrown**, not on a string match
      against its message. `TokenAuthError` and its variants are credential
      failures; anything else is not.
- [x] `sign-in` has the same defect — it returned `500` only because better-auth
      surfaced its own error. Check the path and make it deliberate rather than
      accidental.
- [x] A test that a resolver throwing a non-auth error yields `internal`, and
      that an invalid token still yields `unauthorized`. **Both**, or the fix is
      satisfiable by answering `500` to everything.
- [x] The log line stays. It was the only reason this was diagnosable in two
      minutes rather than twenty.

## Notes / context

**Do not stop updating `last_used_at`.** §4.9 needs it, and the throttle already
limits it. The bug is the classification, not the write.

**Worth checking whether the read path can avoid the write entirely** when the
throttle says the timestamp is fresh — a read-only database would then serve
reads normally, which is a better failure mode than refusing everything. That is
a second, larger change; if it is more than a few lines, file it rather than
folding it in.

Reproduced by making `/data/laika.db` owned by a different user than the process.

## Outcome

**Reproduced first, then fixed.** `PRAGMA query_only = ON` produces the same
`SQLITE_READONLY` from the same driver as a wrong-owner file, deterministically
and without depending on which user runs the suite. Before the change:

```
before:                        200
token, stale stamp, read-only: 401 {"code":"unauthorized","message":"Not signed in"}
invalid token, read-only:      401 {"code":"unauthorized","message":"That access token is not valid"}
```

The first version of that reproduction **passed against the bug** — 200, not 401
— because `touchTokenUsage` is throttled to one write a minute and a token minted
seconds earlier writes nothing. Clearing `last_used_at` is what makes the write
run, and it is in the test helper for the same reason.

### The fix

`authMiddleware` no longer swallows. The two credential failures are named types
and were already rethrown; **everything else is now rethrown too**, so
`createErrorHandler`'s unhandled path answers `internal` with the `request_id`
(§13.2) and logs the stack.

Rethrowing rather than wrapping in `ApiError('internal')` is deliberate: a
wrapper discards the stack and the request id, which are the two things an
operator needs. **No string matching anywhere** (AC2) — the distinction is
entirely `instanceof`.

### The comment was defending a path that does not exist

The swallow was justified by *"A malformed or expired cookie is an anonymous
request, not a 500."* **Measured: it never happens.** better-auth's `getSession`
**returns `null`** for a garbage cookie, a nonsense header and a
well-formed-but-invalid token alike — it does not throw, so it cannot reach that
catch, and `session === null` above already handles all three.

That comment is why the swallow survived review: it named a real-sounding case
and nobody checked that the case could occur. `treats a garbage cookie as
anonymous rather than as an error` in `flow.test.ts` still passes untouched,
which is the evidence that the path it guards is the `null` one.

### A second defect, found by a mutation that passed

Mutating "a refused token answers `internal` too" changed **nothing**. Not a gap
in the test — the branch I mutated was **unreachable**.

`TokenAuthError extends ApiError` (`tokens.ts:116`). **LAI-442 added an
`instanceof ApiError` branch above the token branch**, so from that change until
now every rejected token logged `auth.session_refused` with
`code: 'unauthorized'` and **no `reason`** — unknown, revoked, expired and
inactive_user collapsed into one line, which is the single thing that log exists
to tell apart. `resolve-actor.ts`'s note that the reason is *"logged and not
returned"* quietly stopped being true.

Proved before claiming it:

```
status: 401
auth.token_rejected present:  false
auth.session_refused present: true   (code: unauthorized, no reason)
```

**This is mine — I wrote LAI-442.** Nothing caught it because the status was
right either way, and a 401 with the right message is exactly what a reviewer
checks. Fixed by testing the specific type first, with a test that pins the
**reason** rather than the presence of a line.

I treated it as in scope rather than filing it: it is the same `catch` block,
the same misclassification, and the task's subject is auth failures reported as
something they are not. Say if you would rather it were separate.

### Tests, and both directions

Six new, in `test/http/middleware/auth.test.ts`. Mutations, each confirmed to
have landed before its run — one of the four printed `ANCHOR FAILED` and did not,
and the `EXIT=0` under it would have read as coverage:

| mutation | result |
| --- | --- |
| restore the swallow (no rethrow) | red — 2 tests |
| `ApiError` above `TokenAuthError` again (the LAI-442 regression) | red |
| log a fixed `reason` instead of the real one | red |
| a refused token answers `internal` too | **no-op — mutated dead code**, which is how the regression above was found |

The second direction is the one AC4 insisted on: *"still says unauthorized for a
token that is actually invalid"*. Without it, "answer 500 to everything" passes,
and that is a worse bug than the one being fixed — it would tell an operator the
disk is broken every time somebody mistypes a token.

### Sign-in (AC3)

Already `500 internal`, and now asserted. `translateAuthResponse` maps 5xx to
`internal`, so better-auth surfacing its own error produced the right answer by
accident; the new test pins it against the LAI-090 failure — an infrastructure
fault rendered as *"Email or password is wrong."*

### The Notes' question, answered and split out

*"Worth checking whether the read path can avoid the write entirely when the
throttle says the timestamp is fresh"* — **it already does**: `tokens.ts:179`
returns early inside 60 s. So a read-only database serves reads for a minute
after each token's last use and then stops, which is worse than either
alternative because it makes a total outage look intermittent.

Fixing that means deciding whether a failed **bookkeeping** write should fail the
request — which is the "loud failure into a silent one" question LAI-231 answered
the other way for `poll()`, and it deserves the same deliberation rather than
riding along here. Filed as **LAI-156** with both arguments written out, per the
Notes' instruction to file if it is more than a few lines.

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` 1701/1701,
`web` 585/585, `cli` 19/19. `pnpm lint` EXIT=0 — it caught an untyped
`JSON.parse(...).error` in my own new test — `pnpm format` EXIT=0.
