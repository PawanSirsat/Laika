---
id: LAI-745
title: 'routes/users.ts docblock still says PATCH /users/:id is unbuilt and /users/:id answers 404'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-743
status: backlog
---

## Goal

The module docblock of `server/src/http/routes/users.ts` (lines 18–30 at
`e45a2f9`) says `PATCH /api/v1/users/:id` *"is **not** built here"* and that
*"anything on `/users/:id` → `404`, because no route is registered there at
all"*. Both have been false since LAI-222: the same file registers `PATCH
/:id`, and `users.test.ts` asserts `GET`/`DELETE` on `/users/:id` answer
`405` with `Allow` naming `PATCH`. LAI-743's research report quoted the stale
sentence as a fact, which is how a comment that claims more than its code
misleads the next reader (CLAUDE.md §5).

## Acceptance criteria

- [ ] The docblock describes what the file serves now — `GET /`, `PATCH
      /:id` — and the 404/405 distinction as `users.test.ts` asserts it.
- [ ] It points at `/users/:id/tokens`, `/users/:id/profile` and
      `/users/:id/ratings` being separate routers mounted on the same prefix.

## Notes / context

Comment-only. No behaviour changes; no test needs to change.
