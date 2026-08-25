---
id: LAI-219
title: Sign-in has no lockout, no attempt limit and no per-account throttle
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-078
status: backlog
started:
finished:
---

## Goal

LAI-078 AC2 said not to invent a lockout counter, and to *"check what better-auth
is configured to do"* and file a task if it does nothing. It does nothing.

**Measured on a running instance** — eight consecutive failed sign-ins for a real
account:

```
attempt 1..8   401   {"code":"unauthorized","message":"Invalid email or password"}
headers        x-ratelimit-limit: 600   x-ratelimit-remaining: 599, 598, 598, 598 …
```

Identical every time. No attempt counter, no `Retry-After`, no ban, no delay.
`server/src/auth/auth.ts` configures no `rateLimit` and no lockout.

**The only thing in front of it is the general limiter**, and it does not fit
this job:

- The policy applied is `session` — **600 requests/minute**, refilling
  continuously at 10/second. `x-ratelimit-remaining` stops falling because the
  bucket refills as fast as a guesser spends it.
- Unauthenticated requests **share one bucket** (`http/middleware/rate-limit.ts`
  explains why: per-IP needs a trusted-proxy config Laika does not have yet). So
  the budget is not per-account and not per-attacker.

A shared 600/min with continuous refill is a fair-use limit on a working API. It
is not brute-force protection, and nothing else is.

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
  number. When the server has something true to say, that prop becomes the
  richer one — and a **new task** should do it, not this one.
- Its previous prop was `{ attemptsLeft: number | undefined; lockoutMinutes }`,
  rendering the prototype's *"3 attempts left before a 15-minute lockout"*.
  Nothing ever passed it. `attemptsLeft` was optional, so the first caller would
  have rendered *"undefined attempts left"*. Removed in LAI-078.
- Rate-limiting sign-in per-IP runs into the same trusted-proxy problem the
  middleware documents. Per-**account** throttling avoids it entirely, since the
  key is the submitted address rather than the caller.
