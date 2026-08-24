---
id: LAI-090
title: Reaching the instance on a different host says "Email or password is wrong"
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from:
finished: 2026-08-24T20:23:39Z
started: 2026-08-24T20:09:48Z
status: review
---

## Goal

**The owner hit this and could not sign in to their own instance.**

`LAIKA_PUBLIC_URL` is `http://localhost:3000`. Opening the same instance at
`http://127.0.0.1:3000` and signing in with correct credentials returns **403**,
and the UI renders **"Email or password is wrong."**

Measured against the running container, same account, same password:

```
Origin: http://localhost:3000   -> 200
Origin: http://127.0.0.1:3000   -> 403
curl with no Origin header      -> 200 (token issued)
```

The credentials were never wrong. better-auth is refusing an untrusted origin and
the failure is being reported as a credential failure.

**This is a self-hosting product.** Reaching the box by IP, by LAN hostname, by
`127.0.0.1`, or through a reverse proxy that rewrites `Origin` are all ordinary.
Every one of them currently tells the operator their password is wrong — the one
message guaranteed to send them looking in the wrong place.

## Acceptance criteria

- [x] **An origin rejection never presents as a credential failure.** It must say
      what actually happened and name the configured `LAIKA_PUBLIC_URL`, so the
      operator can see the mismatch rather than guess it.
- [ ] Decide and document whether **loopback equivalents** (`localhost`,
      `127.0.0.1`, `::1`) are trusted together. My view: they are the same host,
      the distinction is an accident of how someone typed it, and treating them
      as different is a footgun with no security benefit — but it is a decision,
      so record it in `docs/DECISIONS.md` with the reasoning either way.
- [x] Do **not** blanket-trust every origin to make this go away. The check
      exists for CSRF; the defect is the *message*, not the check.
- [x] A test asserts the distinct outcomes: right credentials + untrusted origin,
      wrong credentials + trusted origin, and right + right. **All three must be
      distinguishable**, and the first must not read like the second.
- [ ] SPEC §6.1 states the origin rule and what a mismatch returns.
- [ ] `docker/README.md` says what `LAIKA_PUBLIC_URL` must match, and what breaks
      if it does not. **The env var is already required (D-018) — nothing says
      it must equal the URL people actually type.**

## Notes / context

**Check whether the same rejection can affect the SSE stream** (LAI-048) and
plain API calls, not only sign-in. If a proxy rewrites `Origin`, a board that
signs in and then silently stops receiving events would be far harder to diagnose
than this was.

Related but distinct: **LAI-087**, where a 409 from the setup gate hangs the UI
in a skeleton. Both share a shape — **the server knows exactly what is wrong and
the UI shows something misleading instead.**


---

## Builder-A notes (2026-08-25)

### The bug had two halves, and the second one is worse

**Half one, the reported symptom.** `trustedOrigins` was `[LAIKA_PUBLIC_URL]`, so
`localhost` and `127.0.0.1` were different origins. Now they are one host — see
`src/auth/trusted-origins.ts` for the reasoning and, more importantly, for what
it deliberately does **not** widen.

**Half two, why it reached the owner as a password error.**
`/api/v1/auth/*` is handed to better-auth's own handler, so its responses never
pass through `createErrorHandler`. They arrived as `{ message, code }` rather
than the §6.3 envelope; the client's parser looks for `error`, finds nothing, and
`api/auth.ts`'s `signIn` falls back to the literal string *"Email or password is
wrong."* — for **every** auth failure, not just this one. Fixed by translating
better-auth's failures into the envelope in `src/http/auth-errors.ts`.

### And a third thing, which is the one I would want reviewed hardest

**better-auth turns the origin check off under `NODE_ENV=test`:**

```js
skipOriginCheck: options.advanced?.disableOriginCheck !== undefined
  ? options.advanced.disableOriginCheck
  : isTest() ? true : false
```

So the suite has been running with a **weaker security posture than production**,
and **no test at any level could have caught this bug** — every request was
accepted regardless of `Origin`. I found it because my first attempt at the
acceptance test returned `200` for `https://evil.example`, which I could not
explain; the harness disagreed with the running container, and the difference was
not the socket after all, it was `NODE_ENV`.

`disableOriginCheck: false` is now set explicitly. That is what makes AC4's test
mean anything, and it is a guard that could not previously fail.

### Verified against the built server, and through the real UI

Configured `LAIKA_PUBLIC_URL=http://localhost:8795`, knocked on `127.0.0.1:8795`:

| Case | Before | After |
| --- | --- | --- |
| right password, other loopback spelling | `403` "Email or password is wrong." | **`200`, signed in** |
| right password, foreign origin | `403` "Email or password is wrong." | `403` naming both addresses |
| wrong password, trusted origin | `403` "Email or password is wrong." | `401` "Invalid email or password" |

Driven through the actual login form in a browser, not only by curl. From
`127.0.0.1` it now signs in and lands on `/board`. With the public URL pointed at
a host the instance is not reachable at, the form shows:

> This instance is configured for `http://laika.example.com` and the request came
> from `http://127.0.0.1:8796`. Open it at the configured address, or set
> `LAIKA_PUBLIC_URL` to the address you use.

### The Notes' question: no, the SSE stream is not affected

Only `/api/v1/auth/*` is origin-checked. The REST routes and `GET /api/v1/events`
are not, and their CSRF story is the `SameSite=Lax` cookie (§6.1). So a proxy that
rewrites `Origin` breaks **sign-in and nothing else** — asserted in
`test/auth/origin.test.ts` rather than reasoned about, because the reverse (sign
in fine, then silently stop receiving events) would have been far harder to
diagnose than this was.

### Three ACs travelled, because they are in other people's files

- **AC2** (`docs/DECISIONS.md`), **AC5** (SPEC §6.1) and **AC6**
  (`docker/README.md`) → **LAI-127**. The full reasoning for the loopback
  decision is written into that task so PM can lift it rather than reconstruct it.
- **LAI-125** — `api/auth.ts` reads `details.message` rather than
  `error.message`. To make this fix reach the screen without editing a file this
  task does not own, `toApiError` repeats the message in `details`; LAI-125
  removes the repetition and the client half **must land with it** or the
  regression returns.
- **LAI-126** — `tasks.started_at` / `completed_at` are on the table and in no
  view. Raised by the UI session; filed with a warning that they are *actuals*
  and using them for task bars is a D-014 decision, not a UI one.

### Verification

10 break-probes, all 10 fail when broken — including *"blanket-trust every
origin"* and *"disable the origin check again under test"*, which are the two
wrong fixes this task warns against. 847 server tests pass.
