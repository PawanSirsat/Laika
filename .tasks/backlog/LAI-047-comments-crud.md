---
id: LAI-047
title: Comments — create, list, edit, soft-delete
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-011]
discovered-from:
status: backlog
---

## Goal

Comments on tasks, through the service layer, with the ownership rules §3.2
already defines. This is what `add_comment` (§7.1) will wrap in M3, so the
service is the contract, not the route.

## Acceptance criteria

- [ ] `GET /api/v1/tasks/:id/comments` — cursor-paginated (§6.3), oldest first,
      `updated_since` supported with tombstones for soft-deleted rows.
- [ ] `POST /api/v1/tasks/:id/comments` — `body_md`, `created_via` set from how
      the request arrived (`web` for a cookie, `api` for a token).
- [ ] `PATCH /api/v1/comments/:id` and `DELETE /api/v1/comments/:id`, enforcing
      §3.2: a `member` edits and deletes **their own**; a project `lead` and org
      Admin/Owner may delete any. Tested per role, allowed *and* denied.
- [ ] Delete is **soft** — `deleted_at` set, row retained. A deleted comment
      appears in `updated_since` as a tombstone and nowhere else.
- [ ] Every mutation writes exactly one `comment.added` activity row; edits and
      deletes are recorded too. No mutation path skips `assertCan`.
- [ ] Logic lives in `server/src/services/`; the route is transport only
      (CONVENTIONS §2). `no-restricted-imports` will fail the build otherwise.

## Notes / context

SPEC §4.7, §6.4, §3.2. `comments` already exists in the schema (LAI-003).

**Editing is not free.** §4.7 has `edited_at` — set it, and make sure the API
exposes enough for a UI to say "edited" without guessing from timestamps.

**The activity vocabulary is closed** (§4.8). There is `comment.added` and
nothing for edit or delete. Either those reuse `comment.added` with a payload
that distinguishes them, or the vocabulary needs a new type — which is a schema
change and therefore a task, not a decision to take mid-implementation. **Say
which you chose in your log**; if you think the vocabulary needs to grow, file it
and use `comment.added` meanwhile.

No new dependencies.
