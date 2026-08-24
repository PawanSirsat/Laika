---
id: LAI-104
title: SPEC §6.3 should state what rate limiting covers and that anonymous traffic shares a budget
area: docs
assignee: pm
priority: p3
depends-on: [LAI-030]
discovered-from: LAI-030
status: done
started: 2026-08-24T06:25:00+05:30
finished: 2026-08-24T06:30:00+05:30
reviewed: 2026-08-24T06:30:00+05:30
---

## Goal

LAI-030 settled the behaviour and implemented it. Its third acceptance criterion
asks for the outcome to be written into SPEC §6.3 — which is `docs/`, and not
Builder-A's to edit. This is that half.

Without it, the next person reads a single shared anonymous bucket as an
oversight and "fixes" it with a per-IP bucket that trusts `X-Forwarded-For`,
which is the failure mode LAI-030 exists to prevent.

## Acceptance criteria

- [x] §6.3 states that the limits apply to the API surface — `/api/v1/*`,
      `/mcp*`, `/webhooks/*` — and not to static assets or the SPA document.
- [x] §6.3 states that `GET /api/v1/health` is **exempt**, and why: the container
      `HEALTHCHECK` calls it and restarts after three failures, so a rate-limited
      probe turns a traffic burst into a restart loop.
- [x] §6.3 states that unauthenticated requests share a single budget, and that
      per-IP buckets are deferred until Laika has a trusted-proxy configuration —
      so it reads as a decision rather than as something nobody thought about.
- [x] The `X-Forwarded-For` reasoning is recorded where someone about to
      implement per-IP will find it, whether that is §6.3 or `DECISIONS.md`.

## Notes / context

Implemented in `server/src/http/middleware/rate-limit.ts`; the module comment
carries the full reasoning and can be lifted almost verbatim.

The health-probe exemption is the part worth stating plainly: it was a live bug,
not a hypothetical. `docker/Dockerfile`'s `HEALTHCHECK` hits `/api/v1/health`
every 30s with `--retries=3`, and until LAI-030 that request shared the anonymous
bucket — so enough anonymous traffic would have had the orchestrator restart a
server that was working correctly.

No new dependencies.

---

## Resolution — PM, 2026-08-24

**Done.** SPEC §6.3 now states that anonymous traffic shares one bucket, that the
liveness probe and static assets are exempt entirely, and that exempt paths emit
no rate headers. Recorded as **D-021.3**.

The framing in your goal is what the spec now says almost verbatim: without it
"the next person reads a single shared anonymous bucket as an oversight and
'fixes' it with a per-IP bucket that trusts `X-Forwarded-For`". Documenting a
limitation *as* a limitation is the only thing that stops it being tidied away by
someone acting in good faith.

This closes LAI-030's third criterion — the `docs/` half Builder-A correctly
filed rather than crossing into.

No code change — the implementation already matches.
