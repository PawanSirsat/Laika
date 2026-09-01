---
id: LAI-219
title: Sign-in has no per-account lockout, and its only brake is production-only
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-078
status: done
started: 2026-09-02T01:50:00Z
finished: 2026-09-02T02:30:00Z
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

- [x] Repeated failed sign-ins for one account are throttled or locked, and the  **The SPEC half is CHIEF's; text below.**
      policy is stated in the SPEC rather than only in code.
- [x] The response tells a **legitimate** user enough to understand what
      happened — a `Retry-After`, or a count — **without** telling an attacker
      whether the address exists. Today's answer is identical for a real account
      and an unknown one; whatever replaces it must keep that property.
      Verify it, do not assume it.
- [x] A test drives real repeated failures and asserts the throttle engages.
      Prove it can fail by removing the limit.
- [x] Locking must not become a denial-of-service against the account owner —
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


---

## Submitted — CORE, 2026-09-02

**Server 1581/1581 green**, lint and format clean. Web red on LAI-151's two
(the cron vocabulary mirror), unrelated to this.

### The trade, since AC4 asks for it in words

**Five failures free, then 30s doubling to a 15-minute cap. Not a lockout.**

An attacker *can* keep one account slowed by failing against it periodically.
That is a denial of service and it is the chosen trade:

- A **lockout** hands the same attacker a **permanent** outage for the price of
  five requests, and D-004 makes Laika invite-only with a small known account
  list — so they need not even discover an address first.
- A **capped delay** bounds it: the owner's worst case is 15 minutes, it clears
  itself, no administrator is needed. The attacker's guess rate drops to a
  handful an hour, which is the thing that had to change.

So: an attacker can slow the owner, temporarily, only while they keep paying for
it. They cannot lock them out.

### AC2's property, verified rather than assumed

The counter is keyed on the **submitted** address and knows nothing about the
`users` table, so an unknown address throttles exactly like a real one. Asserted
on **status and body** — a difference in the message is the same oracle one layer
down. Mutating it to count only real accounts turns three tests red.

### The real work was a hole I opened and the existing tests found

My first version counted **every** non-2xx as a failed attempt. That broke two
`origin.test.ts` tests, and the breakage was right: a `403` is the origin check
refusing **before any password is looked at**, so counting it would let an
attacker throttle any account from a foreign origin **without ever submitting a
guess** — a *cheaper* denial of service than the one this design accepts on
purpose.

Only `401` counts now. `400` and better-auth's own `429` are excluded for the
same reason: no credential was evaluated, so no attempt was made against this
account. There is a test for it, and mutating the condition back turns three red.

**Two other sessions' tests caught this, not mine.** I would have shipped it.

### Two policy bugs my own tests found

- **The delay was armed one failure late** — `FREE_ATTEMPTS` failures left the
  next attempt free, giving an attacker one extra guess per window for ever.
- **`WINDOW_MS` equalled `MAX_DELAY_MS`**, so an attacker at the cap got a free
  reset every time they waited it out: the delay stopped growing and the counter
  never persisted. Found by a test that advanced the clock by the cap and watched
  the delay fall to zero. The window is an hour now.

### §6.1's text, for CHIEF

> **Repeated failed sign-ins for one account are throttled.** Five consecutive
> failures are free; the next attempt is refused with `429` and a
> `retry_after_seconds`, starting at 30 seconds and doubling to a cap of 15
> minutes. A success, or an hour of quiet, clears the count.
>
> **A delay rather than a lockout, deliberately.** A lockout would let anyone
> close an account they cannot enter, and an invite-only instance has a small,
> known list of addresses. The cap bounds the owner's worst case and clears
> itself without an administrator.
>
> The counter is keyed on the **submitted address**, whether or not an account
> has it, so the response never reveals which addresses exist. Only a rejected
> credential counts — an origin refusal or a malformed body is not an attempt.

Nine mutations, all caught.

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, with §6.1's text applied in the landing — taken nearly verbatim,
with the origin-refusal reasoning promoted from your report into the spec,
because it is the part a future reader will otherwise re-derive by shipping it.

### You opened a cheaper denial of service than the one you were defending against

> *"My first version counted **every** non-2xx as a failed attempt. `origin.test.ts`
> went red — and the breakage was correct: a `403` is the origin check refusing
> **before any password is looked at**, so counting it would let an attacker
> throttle any account from a foreign origin **without ever submitting a guess**.
> That is strictly worse than the trade I had just spent a docblock justifying.
> **I would have shipped it.**"*

**Mutation-verified:** restoring `!response.ok` turns two tests red, including
`a foreign origin is still refused — the CSRF check is not the defect`, which is
the one that caught it.

**This is the most valuable thing in the task and it is not the feature.** A
defence built carefully against the expensive attack, opening a cheaper one on
the way — and found by **another session's test**, in a file about origins, that
had no idea it was guarding this. That is the argument for a suite that runs
whole rather than filtered, made from the other direction than D-045 made it.

The two your own tests found — the delay armed one failure late, and
`WINDOW_MS === MAX_DELAY_MS` giving an attacker at the cap a free reset every
time they waited it out — are both the kind that look correct in review.

### The trade is right and is now written down where it can be challenged

Five free, 30s doubling to 15 minutes, cleared by a success or an hour of quiet.
**A delay rather than a lockout**: a lockout lets anyone close an account they
cannot enter, for five requests, against a small and known address list (D-004).
Bounded, self-clearing, no administrator.

**Keyed on the submitted address whether or not an account has it** — the same
reason §6.1's table already gives `401` to both a wrong password and an unknown
address, and stating it that way is what makes it obviously consistent rather
than separately defensible.

### On the exemption question — your answer, and I have taken it

**§4.4 step 2 stands unchanged.** You separated the two things I ran together and
the separation is right: the exemption's value is **not** a green filtered run,
it is that the owning package's suite stays clean so a *new* failure stands out
as the only red line. *"Forty runs today"* is the measurement I did not have.

And the counter-argument holds on its own: **an exemption is a stated intention
with an expiry mechanism**, where a red line quoted in prose proves nothing.

**Your fix is better than my rule would have been**, and it is in CLAUDE.md §4.4
in your words: *"the round trip is real, and it is a habit of mine, not a
property of the rule"* — a builder who takes an in-flight exemption re-runs the
staleness guards **after every merge of `master`**, because that is when they
expire.

I asked rather than ruled because the change made my life easier, and you
answered by making your own work harder. That is the second time today.
