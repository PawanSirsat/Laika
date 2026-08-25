---
id: LAI-220
title: A rate-limited sign-in tells the user their password is wrong
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from: LAI-078
status: done
started: 2026-08-25T02:40:46Z
finished: 2026-08-25T02:48:33Z
reviewed: 2026-08-26T06:45:00+05:30
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

- [x] A `429` on sign-in shows the server's own message, not the credential
      rejection, and does not put the email field in the invalid state.
- [x] A `401` still shows *"Email or password is wrong."* with the design's
      field treatment (LAI-078 AC1) — this must not regress while fixing it.
- [x] `SignInError` carries the HTTP status.
- [x] A test covers `401` and `429` separately and fails if they collapse again.
      Prove it can fail.
- [x] `5xx` and a network failure still say the instance is unreachable rather
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

---

## Verified on a running instance (builder-b, 2026-08-25T02:48:33Z)

`NODE_ENV=production`, the only environment where this is reachable.

| | shown | email field |
| --- | --- | --- |
| wrong password (`401`) | *"Email or password is wrong."* | invalid — LAI-078 AC1 intact |
| rate-limited, **correct** password (`429`) | *"Too many requests. Please try again later."* | not invalid |

The second row is the bug. Before this fix it read *"Email or password is
wrong."* with the field marked invalid, for a password that was correct.

## How the classification is done

On the **status**, carried on `SignInError`, not on the error class and not on
the message text. `isCredentialRejection` is `status === 401` and nothing else,
so a `429`, a `500` and a network failure each keep their own message. Deriving
it from the message would have meant matching prose that will be reworded.

`api/auth.ts` also lost its `WEB_NO_MIRROR_REQUIRED` exemption. The reason given
there was *"thin better-auth boundary"* — true while it only forwarded a
failure, untrue the moment a caller had to ask **why** it failed.

## Guard

`web/test/api/auth.test.ts`, with the real `401` and `429` bodies copied off the
instance. Proven able to fail by restoring the LAI-078 behaviour: three tests go
red, including one that exists only to pin the shape of the check — an
implementation testing the class, or the truthiness of `status`, passes every
other case and fails that one.

## Where this came from

Another session sent a correction saying LAI-219's premise was wrong — that
`429`s do fire. Checking it turned up something neither of us had said, and this
bug on the way. Both original measurements were correct, under different
`NODE_ENV`s; the corrected table is in LAI-219.

## Review — PM, 2026-08-26

**Accepted.** Reproduced the scenario through the real form on a production
build: six wrong passwords to trip the limiter, then the **correct** one —

```
says "password is wrong":  false
says "too many / try again": true
```

`isCredentialRejection` being `401` **and nothing else** is the right shape: it
fails closed. Any status the client has not thought about stops being read as
"your password is wrong", which is the one message that must never reach someone
whose password is right.

**Dropping `api/auth.ts` from `WEB_NO_MIRROR_REQUIRED` is the part I would have
missed.** *"Thin better-auth boundary"* was true while it only forwarded a
failure; it stopped being true the moment a caller had to ask **why** it failed.
An exemption whose justification quietly expired is exactly the shape this repo
keeps finding, and you caught it in your own file.

### Three things I got wrong, and one that matters more than the others

**1. I attributed the 429 to our limiter.** It is **better-auth's** —
`x-ratelimit-remaining: 595` shows ours had 595 of 600 tokens left and never
fired. Different body, different header (`x-retry-after` vs `Retry-After`).

**2. I called ours IP-based.** It is not, and `rate-limit.ts` says why: per-IP
needs a trusted-proxy config Laika does not have, so anonymous requests share one
bucket. I asserted a mechanism without reading the module that implements it.

**3. Neither of us said the brake only exists under `NODE_ENV=production`** —
which is the part a self-hoster actually needs, and which LAI-096's table already
contained. We both had the answer and neither connected it.

**And the one that matters: I accepted LAI-078 with this regression in it.**
My review measured what the *server* returned and never checked what the
*client* did with it. Testing an API and calling that a UI review is precisely
the gap that let a 429 render as a wrong password.
