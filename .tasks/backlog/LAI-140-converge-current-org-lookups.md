---
id: LAI-140
title: Two services still answer "which org" privately
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-405
status: backlog
---

## Goal

`db/orgs.ts` now holds `requireOrgId`, added in LAI-405 when `unlisted.ts` was
about to become the **third** private copy of the same three-line query. The
first two are still private:

- `server/src/services/invites.ts` — `currentOrg(db)`, returns `{ id, name }`
- `server/src/services/tokens.ts` — `currentOrgId(db)`

Laika is single-org (§4.2), so this is a lookup with exactly one answer. Three
copies is three chances to disagree about the one case that differs: **what
happens when there is no org yet**, which first boot hits and which each copy
currently decides for itself. `tokens.ts` throws a `not_found` `ApiError`,
`db/orgs.ts` throws a plain `Error`, and `invites.ts` does something else again.

Not urgent and not a bug today. It is three declarations of one fact, which is
the shape that eventually drifts.

## Acceptance criteria

- [ ] `invites.ts` and `tokens.ts` use `db/orgs.ts` rather than their own copies,
      or the task explains why one of them genuinely needs different behaviour.
- [ ] **The no-org case answers the same way everywhere**, and the log says what
      that answer is. Today the three disagree; picking one is the point of the
      task, and `ApiError('not_found')` versus a plain `Error` is a real
      difference — one becomes a 404, the other a 500.
- [ ] `invites.ts` needs the org **name** as well as the id. Either `db/orgs.ts`
      grows a second function with a caller, or `invites.ts` reads the name where
      it needs it — do not add an unused shape.
- [ ] A test asserts the shared lookup behaves identically for the callers that
      switch to it, so this is a refactor and not a quiet behaviour change.
- [ ] Full gate green.

## Notes / context

No new dependencies.

`db/orgs.ts` deliberately exports only the throwing form, because that is the
only shape with a caller. If a converged version needs a non-throwing one, add
it **with** its caller rather than ahead of it.
