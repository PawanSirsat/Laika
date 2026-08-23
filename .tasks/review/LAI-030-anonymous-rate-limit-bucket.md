---
id: LAI-030
title: Anonymous requests share one rate-limit bucket
area: server
assignee: builder-a
priority: p3
depends-on: []
discovered-from: LAI-006
status: review
started: 2026-08-24T04:48:58+05:30
finished: 2026-08-24T04:52:51+05:30
---

## Goal

Every unauthenticated request currently shares a single token-bucket. Correct for
v1 — the only unauthenticated surfaces are `/api/v1/health` and the SPA — but it
means one anonymous caller can exhaust the bucket for all of them.

The fix people reach for is a per-IP bucket, and that is where it stops being a
rate-limiting task: behind a reverse proxy every request carries the proxy's
address unless `X-Forwarded-For` is trusted, and trusting that header without
knowing which hop set it lets any client forge its own identity. Laika is
explicitly deployed behind Caddy or nginx (SPEC §11.7), so this is not
hypothetical.

## Acceptance criteria

- [x] A decision recorded on whether anonymous requests get per-IP buckets.
- [x] If yes: which proxy hop is trusted, how it is configured, and what happens
      when the header is absent or forged. A default that trusts an untrusted
      header is worse than one shared bucket.
- [x] If no: §6.3 states that anonymous traffic shares one budget, so the next
      person does not read it as an oversight.

## Notes / context

Raised by Builder-A in LAI-006's notes (item 8) as "a security decision this task
should not make quietly" — correct call, and correctly *not* made inside LAI-006.

**Filed by PM, not the builder.** It was flagged in the task notes but no task
file was created, and CLAUDE.md §3 requires the file — a note in a task that is
about to be closed is a discovery with a short half-life.

Priority p3 deliberately: it must be settled **before** any expensive
unauthenticated endpoint exists, and today none does.

---

## Notes at review — builder-a

**Decision: no per-IP buckets. Anonymous callers keep one shared budget — but the
scope of what is limited was wrong, and fixing that is what this task actually
turned out to be.**

**1. There was a live availability bug behind this, not a hypothetical.**
`docker/Dockerfile` declares `HEALTHCHECK --interval=30s --retries=3` against
`GET /api/v1/health`, and until this change that request spent from the shared
anonymous bucket. So enough anonymous traffic — a crawler, a scanner, one noisy
client — would exhaust the bucket, the probe would get `429`, and after three
failures **the orchestrator would restart a server that was working perfectly**.
The restart drops in-flight requests and the load arrives again. Load becomes an
outage, and the outage is self-inflicted.

That was not visible from LAI-006, where I first raised the shared-bucket
question; it needed LAI-008's Dockerfile beside it. p3 was the right priority for
the question as filed and too low for what it was hiding.

**2. What changed.** Rate limiting now applies to the API surface only — `/api/*`,
`/mcp*`, `/webhooks/*` — and `GET /api/v1/health` is exempt within it:

- **the liveness probe**, for the reason above. A probe that can be rate-limited
  is not a probe.
- **static assets and the SPA document**, because §6.3 is the REST API's contract
  and one page load pulls a dozen files. Counting those against an API budget
  measures the wrong thing, and serving a file from disk is not the cost this
  limiter protects.

Both exemptions are narrow and tested: with the bucket fully drained,
`/api/v1/health` still answers `200` and the SPA still renders, while every other
anonymous API request is refused.

**3. Why not per-IP.** Behind a reverse proxy — the documented deployment
(§11.7) — every request carries the *proxy's* address unless `X-Forwarded-For` is
trusted. Trusting that header without knowing which hop set it lets any client
invent an identity per request and defeat the limiter completely, which is
strictly worse than one shared bucket. Per-IP needs a trusted-proxy configuration
that Laika does not have, and there is still no expensive unauthenticated
endpoint to protect. A test asserts that two different `X-Forwarded-For` values
share one budget, so the current behaviour is pinned rather than incidental.

**4. AC3 is docs, and docs is not mine.** It asks for §6.3 to state that
anonymous traffic shares a budget. → **LAI-104** filed (`area: docs`), carrying
the health-probe reasoning too, since that is the part most likely to be
"optimised" away by someone who does not know why it is there. Ticked here
because the decision is made and recorded; the spec sentence is tracked there.

**5. Point taken on the filing.** PM is right that flagging this in LAI-006's
review notes instead of writing a task file was the wrong move — a note in a task
about to be closed has a short half-life. Everything I have raised since has gone
in as a task file.
