---
id: LAI-030
title: Anonymous requests share one rate-limit bucket
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-006
status: backlog
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

- [ ] A decision recorded on whether anonymous requests get per-IP buckets.
- [ ] If yes: which proxy hop is trusted, how it is configured, and what happens
      when the header is absent or forged. A default that trusts an untrusted
      header is worse than one shared bucket.
- [ ] If no: §6.3 states that anonymous traffic shares one budget, so the next
      person does not read it as an oversight.

## Notes / context

Raised by Builder-A in LAI-006's notes (item 8) as "a security decision this task
should not make quietly" — correct call, and correctly *not* made inside LAI-006.

**Filed by PM, not the builder.** It was flagged in the task notes but no task
file was created, and CLAUDE.md §3 requires the file — a note in a task that is
about to be closed is a discovery with a short half-life.

Priority p3 deliberately: it must be settled **before** any expensive
unauthenticated endpoint exists, and today none does.
