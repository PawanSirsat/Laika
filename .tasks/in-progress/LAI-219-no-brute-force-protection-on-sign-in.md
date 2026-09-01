---
id: LAI-219
title: Sign-in has no per-account lockout, and its only brake is production-only
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-078
status: in-progress
started: 2026-09-02T01:50:00Z
started:
finished:
---

## Goal

**Corrected 2026-08-25** after another session measured `429`s where this task
claimed there were none. Both measurements were right; they were taken under
different `NODE_ENV`s. The correction below is what I then measured myself, and
it changes the premise without changing the conclusion.

There is **no per-account lockout**. There *is* a brake, and it is not ours:

| | fires after | keyed on | development | production | test |
| --- | --- | --- | --- | --- | --- |
| **better-auth's limiter** | 3 rapid failures, `429` for ~10s | the caller | **off** | **on** | **off** |
| our `rateLimitMiddleware` | 600/min, refills at 10/s | one shared anonymous bucket | on | on | on |

Measured in `NODE_ENV=production` — attempts 1–3 `401`, 4–8 `429` — and the
`429` carried `x-ratelimit-remaining: 595`, so **our** limiter had not fired and
does not fire here in practice. The body is better-auth's
(`"Too many requests. Please try again later."`, `x-retry-after: 10`), not ours
(`"Too many requests"` with `retry_after_seconds`).

In `NODE_ENV=development` there is no brake at all: eight consecutive failures
return eight identical `401`s. That is the environment a self-hosted operator
gets by **omitting** `NODE_ENV`, which is worth stating plainly.

### What is actually missing

1. **A per-account lockout.** better-auth's limiter is keyed on the caller, so it
   slows a burst from one address and does nothing about a slow attempt spread
   across many against one account.
2. **A brake that does not depend on `NODE_ENV`.** The only protection on this
   path today evaporates if the operator does not set it.

**Do not build a second limiter beside the one that already exists** — that was
the risk in this task's original wording. `rateLimitMiddleware` is fine at what
it does; it is simply not brute-force protection and was never meant to be.

## Why it matters here specifically

Laika is **self-hosted and invite-only** (D-004). There is no public sign-up, so
the account list is small and known — which makes guessing *more* attractive, not
less, because the attacker does not have to find a valid address first. And
`POST /invites/accept` sets `password: z.string().min(12)`, but nothing stops an
existing owner having chosen something weaker before that rule existed.

## Acceptance criteria

- [ ] Repeated failed sign-ins for one account are throttled or locked, and the
      policy is stated in the SPEC rather than only in code.
- [ ] The response tells a **legitimate** user enough to understand what
      happened — a `Retry-After`, or a count — **without** telling an attacker
      whether the address exists. Today's answer is identical for a real account
      and an unknown one; whatever replaces it must keep that property.
      Verify it, do not assume it.
- [ ] A test drives real repeated failures and asserts the throttle engages.
      Prove it can fail by removing the limit.
- [ ] Locking must not become a denial-of-service against the account owner —
      an attacker who can lock any account at will has taken the board down.
      Say which trade was chosen and why.

## Notes

- **The UI is ready for whichever shape this takes.** `LoginScreen` takes
  `rejected?: boolean` and renders *"Email or password is wrong."* with no
  number. It now distinguishes `401` from `429` (LAI-220) — before that fix a
  rate-limited user was told their password was wrong. When the server has something true to say, that prop becomes the
  richer one — and a **new task** should do it, not this one.
- Its previous prop was `{ attemptsLeft: number | undefined; lockoutMinutes }`,
  rendering the prototype's *"3 attempts left before a 15-minute lockout"*.
  Nothing ever passed it. `attemptsLeft` was optional, so the first caller would
  have rendered *"undefined attempts left"*. Removed in LAI-078.
- Rate-limiting sign-in per-IP runs into the same trusted-proxy problem the
  middleware documents. Per-**account** throttling avoids it entirely, since the
  key is the submitted address rather than the caller.
