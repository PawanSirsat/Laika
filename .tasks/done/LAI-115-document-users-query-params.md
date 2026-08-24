---
id: LAI-115
title: '§6.4 does not document `GET /users`’s query parameters'
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-060]
discovered-from: LAI-060
status: done
---

## Goal

§6.4 line 517 already lists `GET /api/v1/users`, so LAI-060 needed no new endpoint
line. What it does not say is what the endpoint takes — and one of those
parameters changes which rows come back, so a client cannot use it correctly by
guessing.

§6.4 documents parameters for the endpoints where they matter
(`/projects/:slug/tasks ?status=&assignee=&priority=&ready=&sprint=&updated_since=&cursor=`),
so this is filling in an established pattern rather than inventing one.

## Acceptance criteria

- [ ] §6.4's `GET /api/v1/users` line gains its parameters. Suggested text,
      matching the tasks line's style:

      ```
      GET    /api/v1/users            ?include_inactive=&updated_since=&cursor=&limit=
      ```

- [ ] A sentence records the two behaviours a client cannot guess:
      - deactivated people are **excluded by default** — the first caller is a
        member picker and offering someone who cannot sign in is a defect —
        and `?include_inactive=true` returns them with `is_active: false`;
      - an `updated_since` catch-up **always** includes them, flagged rather than
        tombstoned, because §4.1 keeps the row so history keeps its author. A
        `{ id, deleted: true }` tombstone would be false here, unlike the
        soft-deleted comments of §4.7.
- [ ] It records that the ordering is **alphabetical by `name`**, so the cursor is
      `(name, id)` and not the `(updated_at, id)` used by projects and tasks.

## Notes / context

`area: docs` because §6.4 is the file that is incomplete. The behaviour is built,
tested (23 tests across `test/services/users.test.ts` and
`test/http/routes/users.test.ts`) and verified against the built server, so the
text can be checked against the tests rather than against opinion.

Filed rather than edited: `docs/` is PM's under CLAUDE.md §1, and LAI-060's own
AC5 was written on the belief that the endpoint was missing from §6.4 entirely —
worth PM re-reading line 517 before deciding what, if anything, this needs.

Same class as LAI-112 (the SSE wire format): under D-011 the spec is
authoritative, so API surface it does not describe is not yet authoritative.
p3 because nothing is blocked — the parameters are discoverable from the tests.

## Done — PM, 2026-08-25

§6.4 now lists it, read off the mounted routes rather than the roadmap. `/users`
carries `limit`, `cursor`, `updated_since` and `include_inactive`, with a note
that the cursor is `(name, id)` — a directory reads alphabetically, and a client
paging it needs to know the order is not creation time.
