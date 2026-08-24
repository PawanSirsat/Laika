---
id: LAI-022
title: SPEC §6.3 error codes have no entry for 413 or 405
area: docs
assignee: pm
priority: p3
depends-on: []
discovered-from: LAI-002
status: done
started: 2026-08-24T06:25:00+05:30
finished: 2026-08-24T06:30:00+05:30
reviewed: 2026-08-24T06:30:00+05:30
---

## Goal

SPEC §6.3 defines a closed set of error codes and pairs each with one status:
`bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404,
`conflict` 409, `unprocessable` 422, `rate_limited` 429, `internal` 500.

Two statuses the server actually produces are missing from it:

- **413 Payload Too Large.** §13.1 requires `bodyLimit` on every route, so this
  is not hypothetical — it is the documented behaviour of every endpoint.
- **405 Method Not Allowed**, once routes declare methods.

Decide whether the vocabulary grows or whether these collapse into an existing
code, so the mapping is a spec decision rather than a handler's judgement call.

## Acceptance criteria

- [x] §6.3 states which code a 413 carries, and which a 405 carries.
- [x] If the vocabulary grows, the new codes and their statuses are listed in
      §6.3 alongside the existing eight.
- [x] The rule for any status not in the table is stated, rather than left to
      each handler.
- [x] `server/src/http/errors.ts` and `error-handler.ts` are updated to match,
      and the comment naming this task is removed.

## Notes / context

Discovered implementing LAI-002. Current behaviour, chosen so nothing is blocked:
the **accurate HTTP status is preserved** on the response and the nearest §6.3
code is reported next to it — 413 → `unprocessable`, and any other unmapped 4xx →
`bad_request` rather than `internal`. Covered by tests in
`server/test/http/middleware.test.ts`.

That means code and status do not always pair the way §6.3's table implies. It is
the least-bad option available without changing the spec: forcing the status to
match the code would report a 405 as a 422, and collapsing unmapped statuses to
`internal` would report client mistakes as server failures.

No new dependencies.

---

## Resolution — PM, 2026-08-24

**Decided: the vocabulary grows.** `payload_too_large` → 413 and
`method_not_allowed` → 405 are their own codes, not folded into `bad_request`.
Recorded as **D-021.1**; SPEC §6.3 now carries a ten-row table.

Your framing decided it — "so the mapping is a spec decision rather than a
handler's judgement call" is exactly the risk. Clients branch on `code`, and
too-large / wrong-method / malformed have three different remedies; one code for
all three is one code too few.

You were also right that 413 is not hypothetical: §13.1 puts `bodyLimit` on every
route, so it is the documented behaviour of every endpoint.

Implementation: **LAI-042**.
