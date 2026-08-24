---
id: LAI-042
title: Add payload_too_large and method_not_allowed to the error vocabulary
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-022
status: backlog
---

## Goal

D-021 grew SPEC §6.3's closed vocabulary from eight codes to ten.
`server/src/http/errors.ts` still has eight.

## Acceptance criteria

- [ ] `ERROR_STATUS` gains `payload_too_large` → 413 and `method_not_allowed`
      → 405, and the `ApiError` code union grows with it.
- [ ] The `bodyLimit` middleware produces `payload_too_large`, not
      `bad_request` — §13.1 puts it on every route, so this is the documented
      behaviour of every endpoint rather than a corner case.
- [ ] A request over the body limit returns **413** with
      `{"error":{"code":"payload_too_large",…}}`, asserted through the app.
- [ ] A wrong method on an existing path returns **405** with
      `method_not_allowed`, asserted through the app.
- [ ] The §6.3 table and `ERROR_STATUS` agree — ten codes, ten statuses. If a
      test can assert that mechanically against the doc, better; if not, say so.

## Notes / context

D-021 and SPEC §6.3.

**Do not fold either into `bad_request`.** That was the decision, and the reason
is that clients branch on `code`: too-large means send less, wrong method means
call differently, malformed means fix the JSON. One code for three remedies is
one code too few.

405 depends on how Hono reports a method mismatch — if it does not distinguish
"no such path" from "wrong method for this path", say so in your log rather than
forcing it. A 404 where a 405 belongs is a smaller problem than a handler
guessing.

No new dependencies.
