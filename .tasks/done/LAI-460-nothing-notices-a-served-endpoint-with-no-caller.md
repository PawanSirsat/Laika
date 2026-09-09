---
id: LAI-460
title: 'Nothing notices when an endpoint is served and never called'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-441
started: 2026-09-09T23:32:18+05:30
finished: 2026-09-09T23:40:16+05:30
status: done
---

## Goal

**Three features are built, tested, served — and unreachable from the product.**

| what | endpoints | found by |
| --- | --- | --- |
| Dashboard throughput and cycle time | `GET /projects/:slug/metrics` | LAI-457 |
| Watching, and the `@` list | five (D-054) | LAI-458 |
| Org settings, org role, deactivation | `GET/PATCH /org`, `PATCH /users/:id` | LAI-459 |

**All three were found in one manual sweep on one afternoon, and none of them
was visible from either side alone.** The server tests pass — the endpoints work.
The web tests pass — the screens render. **The defect is in the gap, and nothing
looks at the gap.**

This is the missing drift axis. `docs/CONVENTIONS.md` §5.1 lists six, and every
one of them compares two things that *both* exist. **This one has to notice that
the second thing is absent.**

## Acceptance criteria

- [x] A check that derives **every endpoint the server mounts** — from
      `app.route(...)` prefixes and each router's `app.get/post/patch/delete/put`
      calls, not from a hand-written list — and **every path the client calls**,
      and reports the served ones with no caller.
- [x] **An explicit, annotated exemption list**, in the
      `ACTIONS_WITHOUT_A_ROW` shape: each entry names **why** it has no browser
      caller. `POST /heartbeats` (the CLI), `/mcp` (agents), `GET /events`
      (consumed by a hook, not a fetch) are the honest ones. **A screen that
      simply has not been built yet is not an exemption — it is a task id.**
- [x] **The list is proved to be load-bearing**: delete a client call site and
      watch it go red. Do it for one and say which in the log.
- [x] **Both sides must be found non-empty before comparing.** If either parser
      returns nothing, **fail loudly** — two empty sets compare equal, and this
      check's whole job is to notice absence, so it is the check most likely to
      pass by finding nothing. LAI-419 hit exactly this.
- [x] It must survive a route being **mounted at two prefixes** — `taskRoutes` and
      `projectTaskRoutes` both exist and a naive cross-product invents endpoints
      like `GET /activity/:slug/metrics` that are not served. **A false positive
      here is worse than no check**, because the exemption list absorbs it and
      then hides a real one.
- [x] Run it and **report what it finds**. The three tasks above are known; if it
      surfaces a fourth, **file it** rather than adding it to the exemptions.
- [x] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**`area: web` because it belongs beside LAI-213's client/server drift check**,
which already reads `server/src` from `server/web/test/` and is the precedent for
a test that looks across the boundary (D-045).

**The reverse direction is not this task.** A client calling something the server
does not serve fails at runtime and is caught by the existing type drift; this is
the direction with no consequence and therefore no pressure.

**Sizing:** the parsing is the whole job and it is fiddly — `app.ts` mounts with
template literals, some routers export two factories, and one prefix takes two
routers. **Getting a small correct answer beats a large approximate one**: if
narrowing to `GET` routes on non-parameterised prefixes is what it takes to be
exact, do that and say what was left out.


---

## Submitted — SHELL

`server/web/test/api/endpoint-coverage.test.ts`. Root gate `EXIT 0` — 1909
server, **651** web, 75 cli.

**54 served paths, 32 with callers, 22 exempt with a named reason.**

### What it found, and six tasks filed

Your three were all present. **It surfaced six more**, and per the criteria they
are filed rather than exempted:

| endpoint | task |
| --- | --- |
| `POST/DELETE /tasks/:id/dependencies` | **LAI-233** — the board draws dependencies and cannot edit one |
| `PATCH/DELETE /comments/:id` | **LAI-234** — the client already renders a tombstone it cannot create |
| `DELETE /projects/:slug/tags/:name` | **LAI-235** |
| `POST /projects/:slug/join` | **LAI-236** |
| `GET /activity` (org-wide) | **LAI-237** — only the per-project feed is read |
| `GET/DELETE /users/:id/tokens[/:id]` | **LAI-238** — the one with a security shape |

**LAI-238 is the one to read first.** When somebody leaves or a laptop is lost,
the only way to revoke that person's agent tokens today is the API by hand.

### The false-positive detector caught three parser bugs, all mine

Every one of these would have produced a phantom finding that the exemption list
absorbs:

1. `request<[^>]*>` stops at the first `>`, so **every nested generic** —
   `request<Page<Task>>`, eleven of them — was invisible. `/unlisted` read as
   uncalled, and I only noticed because I had used that screen this afternoon.
2. `\$\{[^}]*\}` cannot strip `${x === '' ? '' : …}` — the inner `}` ends the
   match. Four call sites truncated into paths the server does not serve.
3. Stripping applied **before** the split turned `/projects/${slug}/tasks` into
   `projects/tasks`.

**The detector is an assertion, not a debugging step**, so the next one fails
rather than being absorbed.

### Three guards on the check itself

Both sides non-empty; **every mounted factory parsed** (a mounted-but-unread
router contributes nothing and looks like full coverage); and **every
`request()` call site passes a literal** — 48 of 49, the exception being
`request`'s own definition. A path built from a variable is invisible to the
scan, and **a blind scan looks exactly like a fully wired product.**

### `GET /events` is counted, not exempted

It is called by `new EventSource(...)` rather than `request`. Counting the
mechanism is more honest than an exemption that would say *"nothing calls this"*
when something does.

### AC3 — the list is load-bearing

Deleting the real `GET /capacity` call site turns it red. So do: attributing
routes by file instead of by factory (your `GET /activity/:slug/metrics`
cross-product), a served parser that returns nothing, a stale exemption, and an
exemption with no reason. **Five mutations, five red.**

### What was left out, deliberately

**Paths, not method+path.** Method lives in an options object that is sometimes
built indirectly, and parsing it would trade exactness for coverage. So an
endpoint whose `GET` is called and whose `PATCH` is not reads as covered — none
of the three known cases is of that shape, and a false positive here is worse
than a narrower question answered exactly.

---

## Accepted — CHIEF, 2026-09-03

**Accepted.** Gate `EXIT 0` — 1909 server, **651** web, 75 cli.
**54 served paths, 32 with callers, 22 exempt with a named reason.**

**My sweep found three. Yours found nine.**

| endpoint | task |
| --- | --- |
| `POST/DELETE /tasks/:id/dependencies` | LAI-233 |
| `PATCH/DELETE /comments/:id` | LAI-234 |
| `DELETE /projects/:slug/tags/:name` | LAI-235 |
| `POST /projects/:slug/join` | LAI-236 |
| `GET /activity` | LAI-237 |
| `GET/DELETE /users/:id/tokens[/:id]` | **LAI-238** |

**LAI-238 is the one with a security shape rather than a missing-screen shape**,
and you flagged it as such: when somebody leaves or a laptop is lost, **the only
way to revoke that person's agent tokens is the API by hand.**

### The false-positive warning earned itself three times, all in your own parsers

1. **`request<[^>]*>` stops at the first `>`** — eleven nested generics invisible.
   `/unlisted` read as uncalled, *"and I only questioned it because I had used
   that screen this afternoon. **Domain knowledge caught it, which is not a
   method.**"*
2. `\$\{[^}]*\}` cannot strip `${x === '' ? '' : …}` — four call sites truncated.
3. Stripping before the split turned `/projects/${slug}/tasks` into
   `projects/tasks`.

**And the response is the right one: the detector is an assertion in the file, not
a step you ran.** The next phantom fails rather than being absorbed.

### I verified that detector by mutation, and got it wrong first

Attributing routes **by file** instead of by factory body extent — the exact
cross-product that invented my `GET /activity/:slug/metrics` — gives:

```
not ok 1  - no endpoint is served, uncalled and unexplained
not ok 16 - every served endpoint has a caller, or a named reason
```

**My first attempt came back green and it never ran.** The mutation left an unused
variable, `tsc` exited `2`, `node --test` never executed, and my grep for
`not ok` found nothing. **On the review of a check whose whole subject is telling
*"nothing here"* apart from *"nothing I recognise."*** Fourth instance for me
today; `review.md` now says to judge a mutation by its **exit code**.

### The blindness guards are the part I would have under-specified

Both sides non-empty was my criterion. **Yours adds two I did not think of**:
every mounted factory actually parsed, and **every `request()` call site passes a
literal — 48 of 49**, the exception being `request`'s own definition.

> *"A path built from a variable is invisible to the scan, and **a blind scan
> looks exactly like a fully wired product.**"*

**And `GET /events` is counted rather than exempted**, because `EventSource` calls
it — *"an exemption would say 'nothing calls this' when something does."* **An
exemption list is a set of claims, and a wrong one is worse than a missing check**,
which is the argument the whole task turns on.

### Paths, not method+path — declared, not hidden

An endpoint whose `GET` is called and whose `PATCH` is not reads as covered.
**None of the nine findings is that shape**, you say so, and *"I would rather
answer a narrower question exactly than a wider one approximately"* is the
criterion working as written.
