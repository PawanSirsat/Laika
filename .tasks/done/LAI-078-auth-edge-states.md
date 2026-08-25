---
id: LAI-078
title: Auth error and connection states
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-074]
discovered-from:
status: done
started: 2026-08-25T01:55:04Z
finished: 2026-08-25T02:27:23Z
reviewed: 2026-08-26T06:00:00+05:30
---

## Goal

The `ERROR & EDGE STATES` column of design `5a`. These are the states people
actually hit, and they are currently generic.

## Acceptance criteria

- [x] **Wrong credentials**: the email field re-borders `var(--redb)` on
      `var(--reds)`, with a message in `var(--red)` at 11px/600 beside an alert
      glyph.
- [x] **Do not invent a lockout counter.** The mockup says *"3 attempts left
      before a 15-minute lockout"*. Show a countdown **only if the server
      actually returns attempts and a lockout window** — check what better-auth
      is configured to do. If it does not, say so plainly without a number, and
      file a task for the server side rather than faking it.
- [x] **Instance unreachable**: the design's offline card — *"The board keeps
      working offline for reading. Live updates resume when the SSE stream
      reconnects."* — with the retry attempt and countdown in mono.
- [x] The retry line shows the **real** reconnect state from the SSE client
      (LAI-070), not a fixed string. If LAI-070 has not landed, show the state
      without a countdown.
- [x] The message never reveals whether an email exists — *"Email or password is
      wrong"* is deliberate.
- [x] Both themes.

## Notes / context

The offline card is worth building properly: it is the difference between a board
that looks broken and one that says it is degraded but readable. That claim must
be **true** — if the SPA cannot in fact read while offline, change the copy to
match reality rather than shipping the aspiration.

---

## What was verified (builder-b, 2026-08-25T02:27:23Z)

Measured on a running instance, not reasoned about.

### AC2 first, because it decided the rest

The criterion said to check what better-auth is configured to do, and to file a
task rather than fake it. **It does nothing.** Eight consecutive failed sign-ins
for a real account:

```
attempt 1..8   401   {"code":"unauthorized","message":"Invalid email or password"}
headers        x-ratelimit-limit: 600   x-ratelimit-remaining: 599, 598, 598, 598 …
```

Identical every time. No counter, no `Retry-After`, no ban. `remaining` stops
falling because the only thing in front of sign-in is the general limiter at
**600/min refilling at 10/s**, shared across all anonymous traffic — a fair-use
limit, not brute-force protection. Filed as **LAI-219**.

**And the invented counter was already in the code.** `LoginScreen` took
`failure?: { attemptsLeft: number | undefined; lockoutMinutes: number }` and
rendered the prototype's *"3 attempts left before a 15-minute lockout"*. Nothing
passed it, so it was dead — but `attemptsLeft` was optional, so the first caller
to use it would have rendered **"undefined attempts left before a 15-minute
lockout"**. Replaced with `rejected?: boolean`.

### AC1 — wrong credentials, measured off the page

| | measured | design |
| --- | --- | --- |
| email ground | `--reds` both themes | `var(--reds)` |
| email border | `--redb` both themes | `1px solid var(--redb)` |
| message | `11px` / `600` in `--red` | 11px/600 `var(--red)` |
| glyph | present, `aria-hidden` | alert glyph |

`aria-invalid="true"` on the field and `role="alert"` on the message, so the
state is not carried by colour alone.

### AC5 — the message cannot be used to find accounts

The server answers **identically** for a wrong password and an address that does
not exist — both `401 INVALID_EMAIL_OR_PASSWORD`, verified with two requests.
The form says *"Email or password is wrong."* and blames neither field.

### AC3 / AC4 — the offline card, on a real outage

`SIGTERM` to the instance, with the board open:

```
 9.0s   banner appears   "attempt 1"                    (no countdown yet)
12.0s   banner clears    — a genuine reconnect during the server's drain window
19.0s   banner returns   "attempt 1"
22.0s                    "retrying in 3s · attempt 2"
25.0s                    "retrying in 3s · attempt 3"   … and onward
```

**7 task cards stayed rendered the whole time**, which is what makes the copy
true. Title reads `Can't reach localhost:3370` — the real host, not the
prototype's fixture. The meta line is mono.

The countdown is **measured, not hardcoded**: `EventSource` honours the server's
`retry:` hint internally and never exposes it, so the interval comes from the gap
between two observed failures. The first drop therefore has an attempt and no
countdown — which AC4 explicitly allows, and which the banner now shows rather
than dropping the attempt along with the countdown it lacks.

## The copy changed, because the design's version is not true here

The prototype says *"The board keeps working offline for reading."* **There is no
service worker and no offline cache in this app** — checked. An open tab keeps
rendering what it already fetched, and that is the only situation this banner is
ever seen in, so the sentence is true where it appears. But it also reads as a
promise that you can close the tab, come back offline tomorrow and still read the
board, and that is false.

It now says *"What is already on screen stays readable. Live updates resume when
the stream reconnects."* The task's own note asked for exactly this: *"if the SPA
cannot in fact read while offline, change the copy to match reality rather than
shipping the aspiration."*

## Where the unreachable state is, and is not

The banner is mounted on the **board**, where the stream lives. It is not used on
the sign-in screen: *"what is already on screen stays readable"* is meaningless
on a form with nothing loaded and no stream, so an unreachable instance there
still says *"Could not reach the instance."* A rejected credential and an
unreachable host are now separate states — the first is the reader's to fix, the
second is not, and showing "email or password is wrong" for a dead server sends
someone to reset a password that was never the problem.

## Guards

`web/test/auth-states.test.ts`. Proven able to fail by restoring both defects:
putting the lockout sentence back turned *"there is no attempts-left or lockout
copy"* red, and restoring *"keeps working offline"* turned *"it does not promise
the board works offline"* red.

One guard was **too broad on its first run** — a file-wide search for
account-enumeration phrasing flagged the design's standing footer, *"No account?
Only an Owner or Admin can invite you"*, which is shown to everyone always and
reveals nothing. Narrowed to the rejection block rather than deleting correct
copy or loosening the pattern until it caught nothing.

## Review — PM, 2026-08-26

**Accepted. Removing the invented counter is the right call and the reasoning is
the deliverable**: *"inventing one tells the reader they are safer than they
are."* A fake security indicator is worse than none — it is the one kind of
placeholder a reader acts on.

Catching that the old prop was `number | undefined`, so the first real caller
would have rendered *"undefined attempts left"*, is the kind of detail that only
surfaces when someone actually reads the type rather than the intent.

### One factual correction — the conclusion holds, the premise does not

The comment says *"this instance has no lockout. Eight consecutive failed
sign-ins return eight identical `401`s."* **I measured it and that is not what
happens:**

```
1–3   401 unauthorized
4–10  429 rate_limited
correct password immediately after: 429
```

There **is** a brake on `/api/v1/auth/*` — our own IP-based limiter, the one
LAI-096 asserts covers those paths. It fired after three rapid failures and then
released.

**What is genuinely absent is a *per-account* lockout**, and that distinction is
the one that matters: an IP limit slows a burst from one address and does nothing
about a slow distributed attempt against one account. So:

- **Your UI decision is unchanged and correct** — there is still no number the
  server offers, so there is still nothing honest to render.
- **The comment should say "no per-account lockout"**, not "no lockout" — as
  written it would send the next reader looking for protection that is partly
  there.
- **LAI-219 needs its premise corrected** before someone builds a second limiter
  next to the one we have.

Fix both when you are next in the file; not worth a send-back for prose when the
behaviour is right.
