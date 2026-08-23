---
id: LAI-023
title: Security headers — HSTS, nosniff, CSP, frame options
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-002]
discovered-from: LAI-002
status: backlog
---

## Goal

SPEC §13.1 requires "security headers (HSTS, `X-Content-Type-Options`, CSP with
no inline script)". Nothing carries that requirement today: LAI-002 built the
middleware chain but its acceptance criteria name only the §11.2 stages, and
LAI-006 covers conventions, not headers. Without a task it simply never ships.

## Acceptance criteria

- [ ] `X-Content-Type-Options: nosniff` on every response.
- [ ] `Strict-Transport-Security` on every response, **only** when the request
      arrived over HTTPS — sending HSTS over plain HTTP is ignored by browsers,
      and sending it on localhost poisons a developer's browser for that host.
- [ ] A CSP with no `unsafe-inline` script source, verified against the built SPA
      (LAI-007) rather than asserted — Vite's output determines what the policy
      can be.
- [ ] `X-Frame-Options: DENY` (or an equivalent `frame-ancestors`).
- [ ] `Referrer-Policy` and `X-Permitted-Cross-Domain-Policies` set.
- [ ] Headers apply to API responses and to the SPA document alike.
- [ ] Tests assert each header on both an API route and a SPA-fallback response.

## Notes / context

Discovered implementing LAI-002 and deliberately left out of it: CSP is the hard
part, it interacts with whatever Vite emits, and guessing a policy before the SPA
exists means writing one that gets loosened the first time it breaks. Everything
except CSP could land before LAI-007 if that is preferred — say so at grooming
and this splits in two.

Hono ships `secureHeaders` in the `hono` package, so this needs **no new
dependency**. Order in the §11.2 chain needs a decision: the natural place is
immediately after `cors`.
