---
id: LAI-460
title: 'Nothing notices when an endpoint is served and never called'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-441
status: backlog
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

- [ ] A check that derives **every endpoint the server mounts** — from
      `app.route(...)` prefixes and each router's `app.get/post/patch/delete/put`
      calls, not from a hand-written list — and **every path the client calls**,
      and reports the served ones with no caller.
- [ ] **An explicit, annotated exemption list**, in the
      `ACTIONS_WITHOUT_A_ROW` shape: each entry names **why** it has no browser
      caller. `POST /heartbeats` (the CLI), `/mcp` (agents), `GET /events`
      (consumed by a hook, not a fetch) are the honest ones. **A screen that
      simply has not been built yet is not an exemption — it is a task id.**
- [ ] **The list is proved to be load-bearing**: delete a client call site and
      watch it go red. Do it for one and say which in the log.
- [ ] **Both sides must be found non-empty before comparing.** If either parser
      returns nothing, **fail loudly** — two empty sets compare equal, and this
      check's whole job is to notice absence, so it is the check most likely to
      pass by finding nothing. LAI-419 hit exactly this.
- [ ] It must survive a route being **mounted at two prefixes** — `taskRoutes` and
      `projectTaskRoutes` both exist and a naive cross-product invents endpoints
      like `GET /activity/:slug/metrics` that are not served. **A false positive
      here is worse than no check**, because the exemption list absorbs it and
      then hides a real one.
- [ ] Run it and **report what it finds**. The three tasks above are known; if it
      surfaces a fourth, **file it** rather than adding it to the exemptions.
- [ ] Full gate green — **`EXIT 0`**, repo root.

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
