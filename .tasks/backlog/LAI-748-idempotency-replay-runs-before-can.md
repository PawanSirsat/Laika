---
id: LAI-748
title: 'Idempotency replays a stored POST response before can(), keyed by user rather than credential'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-743
status: backlog
---

## Goal

`http/middleware/idempotency.ts` answers a keyed `POST` from
`idempotency_keys` **before the route runs**, so before `can()`, and the key
is `actor.userId` + `Idempotency-Key`. Any credential of the same person — a
`read_only` token, a token pinned to other projects — that sends the same key
and body is handed the stored `2xx`, the original response body included,
without being asked whether it may.

LAI-746 closed this for `POST /users/:id/ratings` alone (session-only, and the
body was a private note) by taking that route out of the store. Every other
`POST` still behaves this way.

## Acceptance criteria

- [ ] A keyed `POST` replayed by a credential that could not have made it is
      refused as the original route would refuse it — for example a session's
      `POST /projects/:slug/tasks` replayed by the same user's `read_only` token
      answers `403`, not the stored `201`. Shown red first.
- [ ] Decide and record which fix: scope the stored key by credential (token
      id, or the session), or check permission before a replay. Either way, a
      replay never widens what a credential could do.

## Notes / context

Found in LAI-743's review (item 1). §6.3 says keys are scoped *"per actor"*;
the question is whether a token and a session of one person are one actor for
this purpose. `KEYED_BY_THE_ROUTE` in the middleware is LAI-746's narrower
fix and can stay or go with this one.
