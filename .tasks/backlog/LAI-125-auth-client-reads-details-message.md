---
id: LAI-125
title: The sign-in client reads the message out of details instead of the envelope
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-090]
discovered-from: LAI-090
status: backlog
---

## Goal

`server/web/src/api/auth.ts`'s `signIn` reads the failure message from
`error.details.message`:

```ts
const failure = (cause as { details?: AuthFailure }).details ?? {};
throw new SignInError(failure.message ?? 'Email or password is wrong.', failure.code);
```

It was written against better-auth's raw body (`{ message, code }`), which is
effectively what `details` used to carry. But before LAI-090 the auth endpoints
did not speak the §6.3 envelope at all, so `details` was **always `null`** and
the fallback string fired for **every** failure — which is how an origin
rejection reached the owner as *"Email or password is wrong."*

LAI-090 fixed the server. To make the fix reach the screen without editing this
file, `toApiError` in `http/auth-errors.ts` now repeats the message inside
`details` as well as in the envelope's own `message`. **That repetition is the
thing to remove**, not the client.

## Acceptance criteria

- [ ] `signIn` reads `error.message` — the envelope's own field, which is where
      §6.3 puts the human message and where every other screen already looks.
- [ ] The `message` duplication comes out of `toApiError`'s `details` in
      `server/src/http/auth-errors.ts`, and the test asserting it goes with it.
      `details` keeps `reason`, `configured_url`, `origin` and `auth_code` —
      those are structured facts, not prose.
- [ ] The origin-mismatch message still reaches the login screen. Check it in a
      browser, not only in a unit test: point `LAIKA_PUBLIC_URL` at a host the
      instance is not reachable at and sign in.

## Notes / context

**Both halves must land together or the owner's bug comes back.** Removing the
duplication without changing the client returns every auth failure to *"Email or
password is wrong."* — the exact regression LAI-090 exists to prevent. There is a
test in `test/auth/origin.test.ts` (*"carries the message where the web client
actually reads it"*) that fails if the server half goes first; keep it until the
client half lands, then update it to assert `error.message` instead.

`LoginScreen.tsx` also has a `failure` branch rendering *"Email or password is
wrong. {attemptsLeft} attempts left before a {lockoutMinutes}-minute lockout."*
**`AppShell` never passes `failure`, so it never renders** — and there is no
lockout in Laika and no endpoint returning an attempt count, so the numbers are
fixtures. Worth deleting while in here, or filing separately.
