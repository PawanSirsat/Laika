---
id: LAI-220
title: A rate-limited sign-in tells the user their password is wrong
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-078
status: backlog
started:
finished:
---

## Goal

**A regression from LAI-078, which I wrote.** Found while checking a correction
another session sent about LAI-219's premise.

`api/auth.ts` turns **any** error carrying a `status` into a `SignInError`.
LAI-078 then made `AppShell` treat every `SignInError` as rejected credentials:

```ts
if (cause instanceof SignInError) setSignInRejected(true);
```

So a `429` renders *"Email or password is wrong."* Measured on a running
instance in `NODE_ENV=production`: five rapid failures trip better-auth's
limiter, and then signing in with the **correct** password shows

> Email or password is wrong.

The user retries with credentials that are fine, stays limited, is told again
they are wrong, and concludes they have forgotten their password. **The one
message that must never be shown to someone whose password is right.**

Before LAI-078 this path showed `cause.message` — *"Too many requests. Please
try again later."* — which was correct. The regression is mine and is the cost of
collapsing two failures into one boolean.

## Fix

Branch on the **status**, not on the error class. `401` is a credential
rejection; everything else keeps its own message.

`SignInError` does not carry the status today — it should, because the
classification belongs where the status is known rather than being re-derived
from a message string.

## Acceptance criteria

- [ ] A `429` on sign-in shows the server's own message, not the credential
      rejection, and does not put the email field in the invalid state.
- [ ] A `401` still shows *"Email or password is wrong."* with the design's
      field treatment (LAI-078 AC1) — this must not regress while fixing it.
- [ ] `SignInError` carries the HTTP status.
- [ ] A test covers `401` and `429` separately and fails if they collapse again.
      Prove it can fail.
- [ ] `5xx` and a network failure still say the instance is unreachable rather
      than blaming the reader's credentials.

## Notes

- better-auth's limiter answers `429` with `x-retry-after: 10` and a body of
  `{"code":"rate_limited","message":"Too many requests. Please try again
  later.","details":{"message":...}}`. The retry window is in a **header**, not
  the body, so showing a countdown needs the client to read it — worth doing
  only if it is cheap; the message alone is already correct.
- **This is only reachable in `NODE_ENV=production`** (LAI-096: better-auth's
  rate limiting is off in development and test). Nobody would hit it in a dev
  loop, which is exactly why it survived review.
