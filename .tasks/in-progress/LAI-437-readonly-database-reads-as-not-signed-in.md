---
id: LAI-437
title: A read-only database reports as "Not signed in"
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-434
status: backlog
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

- [ ] A resolver failure that is **not** a credential problem does not answer
      `unauthorized`. A `SQLITE_READONLY`, a full disk, or any unexpected throw
      is a **`500`/`internal`** with the §6.3 shape — the request is not
      unauthenticated, it is unserviceable.
- [ ] The distinction is made on **what was thrown**, not on a string match
      against its message. `TokenAuthError` and its variants are credential
      failures; anything else is not.
- [ ] `sign-in` has the same defect — it returned `500` only because better-auth
      surfaced its own error. Check the path and make it deliberate rather than
      accidental.
- [ ] A test that a resolver throwing a non-auth error yields `internal`, and
      that an invalid token still yields `unauthorized`. **Both**, or the fix is
      satisfiable by answering `500` to everything.
- [ ] The log line stays. It was the only reason this was diagnosable in two
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
