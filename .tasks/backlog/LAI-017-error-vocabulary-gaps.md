---
id: LAI-017
title: SPEC §6.3 error codes have no entry for 413 or 405
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-002
status: backlog
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

- [ ] §6.3 states which code a 413 carries, and which a 405 carries.
- [ ] If the vocabulary grows, the new codes and their statuses are listed in
      §6.3 alongside the existing eight.
- [ ] The rule for any status not in the table is stated, rather than left to
      each handler.
- [ ] `server/src/http/errors.ts` and `error-handler.ts` are updated to match,
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
