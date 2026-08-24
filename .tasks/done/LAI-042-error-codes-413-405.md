---
id: LAI-042
title: Add payload_too_large and method_not_allowed to the error vocabulary
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-022
status: done
started: 2026-08-24T06:46:26+05:30
finished: 2026-08-24T06:52:29+05:30
reviewed: 2026-08-24T08:05:00+05:30
---

## Goal

D-021 grew SPEC §6.3's closed vocabulary from eight codes to ten.
`server/src/http/errors.ts` still has eight.

## Acceptance criteria

- [x] `ERROR_STATUS` gains `payload_too_large` → 413 and `method_not_allowed`
      → 405, and the `ApiError` code union grows with it.
- [x] The `bodyLimit` middleware produces `payload_too_large`, not
      `bad_request` — §13.1 puts it on every route, so this is the documented
      behaviour of every endpoint rather than a corner case.
- [x] A request over the body limit returns **413** with
      `{"error":{"code":"payload_too_large",…}}`, asserted through the app.
- [x] A wrong method on an existing path returns **405** with
      `method_not_allowed`, asserted through the app.
- [x] The §6.3 table and `ERROR_STATUS` agree — ten codes, ten statuses. If a
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

---

## Notes at review — builder-a

**317 tests**; format, lint and typecheck clean. Verified over a real socket:

```
DELETE /api/v1/health  → 405  Allow: GET
                         {"code":"method_not_allowed","message":"DELETE is not allowed on /api/v1/health",
                          "details":{"allowed":["GET"]}}
DELETE /api/v1/nope    → 404  {"code":"not_found",…}
POST 1.1 MB body       → 413  {"code":"payload_too_large","message":"Request body is too large"}
```

**1. On the 405 question — Hono cannot distinguish it, but its router can.**
Probed first: `POST` to a GET-only path and `GET` to an unknown path both return
**404**, so a client cannot tell "wrong method" from "no such endpoint" and
`method_not_allowed` would be a code nothing could produce.

`app.router.match(method, path)` does know. Chain-wide middleware matches every
method equally, so any method whose handler chain is *longer* than the shortest
has a route of its own. Comparing across methods for one path means the number of
registered middleware is irrelevant — there is a test that a bare app and one
with six middleware give identical answers.

That is the router answering, not a handler guessing, so I implemented it rather
than reporting it as impossible. If you would rather not depend on
`app.router.match`, the fallback is to accept 404s where 405s belong and say so
in §6.3 — but the `Allow` header is worth something and this gets it for free.

**2. `payload_too_large` is not a corner case, and the fix exposed a second
bug.** §13.1 puts `bodyLimit` on every route, and Hono throws a **bare** 413 with
no message — so the envelope was going out as `"message": ""`, which tells a
client nothing. Added a per-code default message for framework exceptions that
carry none, with its own test.

**3. AC5's mechanical check is possible, and it is in.** `test/errors.test.ts`
parses §6.3's markdown table out of `docs/SPEC.md` and asserts it equals
`ERROR_STATUS` exactly — ten codes, ten statuses, both directions. It reads
`docs/` and never writes it.

One caveat worth knowing: it depends on the table's markdown shape
(`| `code` | 405 |`). If PM reformats it the test fails, which is the right
direction to be wrong in — but it fails loudly with "Could not find the §6.3
error table in docs/SPEC.md — has its format changed?" rather than passing
vacuously on zero matched rows, which is the trap this kind of test usually falls
into.

**4. Two existing assertions changed, both correctly.** `413` mapped to
`unprocessable` and `405` to `bad_request` before D-021; both now have their own
code. That is the behaviour change the decision asked for, not a regression.

**5. `Allow` header included** on every 405, and the permitted methods repeated in
`details.allowed` so a JSON client does not have to read headers to know what to
call instead.

## Review — PM, 2026-08-24

**Accepted.** Gate green: lint clean, **317 server tests** (up from 303) and 90
web. Ten codes, ten statuses, `payload_too_large` → 413 and
`method_not_allowed` → 405 both present and both asserted through the app.

### The layering rule earned its keep here

`errors.ts` moved from `server/src/http/` to `server/src/`, and that was not
tidying — it was forced. Services throw `ApiError` (CONVENTIONS §2) and services
may never import `http/`, so the error vocabulary could not stay in the transport
layer once anything below it needed to raise one.

**A rule added yesterday caught a design flaw today.** The vocabulary was in the
wrong place from the start; nothing surfaced it until an import was actually
illegal. That is the difference between a documented convention and an enforced
one.

### Tests I did not ask for and would have missed

- **`answers a wrong method on a real path with 405 and an Allow header`.**
  RFC 9110 *requires* `Allow` on a 405, and a 405 without it is a spec violation
  that no client complains about. Not in my criteria.
- **`still answers an unknown path with 404, not 405`** — the distinction I
  flagged as a risk in the task notes, resolved properly rather than forced.
- **`does not turn a wrong method on a SPA route into a 405`** — the SPA fallback
  matches everything, so the naive implementation 405s on every unmatched path
  and breaks the whole frontend. This is the bug that would have shipped.
- **`reports the methods a path actually has routes for`** and **`handles a
  path-scoped middleware without inventing methods`** — `Allow` is derived from
  the router rather than hardcoded, and middleware registered with `use('*')`
  does not count as a method. Both are the kind of detail that makes `Allow`
  wrong in a way nobody notices for a year.

**Boundaries clean.** The move of `errors.ts` is within `server/`, and CONVENTIONS
§1 has been updated by PM to list it alongside the other cross-layer modules.
