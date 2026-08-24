---
id: LAI-090
title: Reaching the instance on a different host says "Email or password is wrong"
area: server
assignee: builder-a
priority: p1
depends-on: []
discovered-from:
status: backlog
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

- [ ] **An origin rejection never presents as a credential failure.** It must say
      what actually happened and name the configured `LAIKA_PUBLIC_URL`, so the
      operator can see the mismatch rather than guess it.
- [ ] Decide and document whether **loopback equivalents** (`localhost`,
      `127.0.0.1`, `::1`) are trusted together. My view: they are the same host,
      the distinction is an accident of how someone typed it, and treating them
      as different is a footgun with no security benefit — but it is a decision,
      so record it in `docs/DECISIONS.md` with the reasoning either way.
- [ ] Do **not** blanket-trust every origin to make this go away. The check
      exists for CSRF; the defect is the *message*, not the check.
- [ ] A test asserts the distinct outcomes: right credentials + untrusted origin,
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
