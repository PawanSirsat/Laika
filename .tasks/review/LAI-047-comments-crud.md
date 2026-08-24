---
id: LAI-047
title: Comments — create, list, edit, soft-delete
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011]
discovered-from:
status: review
started: 2026-08-24T09:26:27+05:30
finished: 2026-08-24T09:30:44+05:30
---

## Goal

Comments on tasks, through the service layer, with the ownership rules §3.2
already defines. This is what `add_comment` (§7.1) will wrap in M3, so the
service is the contract, not the route.

## Acceptance criteria

- [x] `GET /api/v1/tasks/:id/comments` — cursor-paginated (§6.3), oldest first,
      `updated_since` supported with tombstones for soft-deleted rows.
- [x] `POST /api/v1/tasks/:id/comments` — `body_md`, `created_via` set from how
      the request arrived (`web` for a cookie, `api` for a token).
- [x] `PATCH /api/v1/comments/:id` and `DELETE /api/v1/comments/:id`, enforcing
      §3.2: a `member` edits and deletes **their own**; a project `lead` and org
      Admin/Owner may delete any. Tested per role, allowed *and* denied.
- [x] Delete is **soft** — `deleted_at` set, row retained. A deleted comment
      appears in `updated_since` as a tombstone and nowhere else.
- [x] Every mutation writes exactly one `comment.added` activity row; edits and
      deletes are recorded too. No mutation path skips `assertCan`.
- [x] Logic lives in `server/src/services/`; the route is transport only
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

---

## Notes at review — builder-a

**506 tests** (29 new); format, lint and typecheck clean. Verified against the
**built** server:

```
create     → created_via "web", edited_at null
edit       → body updated, edited_at stamped
delete     → 204;  plain list → []  ;  ?updated_since=0 → [{id, deleted:true}]
re-delete  → 409
activity   → comment.added/created, comment.added/edited, comment.added/deleted
```

**1. On the vocabulary question you posed — I used `comment.added` for all three
and filed the growth as LAI-110.** Your note said adding types is a schema change
and therefore a task rather than a mid-implementation decision, and after doing it
three times in a row (LAI-044, LAI-010, LAI-011) that line seems right to hold.

But it is worth being plain that the interim is wrong in a specific way: the audit
trail now says "added" about a deletion, and filtering `activity` by `type` — the
obvious thing to do, and what the indexes on that table exist for — gives the
wrong answer. The payload distinguishes them, so nothing is lost, but a reader has
to know to look.

**This is the fifth instance of the same pattern.** LAI-110 says so and argues the
mechanical `enums.ts` ↔ §4.8 check LAI-107 proposed is now clearly worth building
— ideally one that reports, per mutating service function, whether a verb exists.
Worth settling before M3, since the MCP tools mutate through these same services.

**2. Soft delete works because §4.7 gave comments a `deleted_at`.** Worth
contrasting with LAI-010: membership rows are hard-deleted, so `updated_since` can
never report a removal there. Here it can, and the tombstone is tested both ways —
absent from a plain read, present with a watermark.

**3. `created_via` branches on the credential, not the route.** `web` for a cookie,
`api` for a token. Tokens are M3, so today every request is `web` — but the branch
is written and unit-tested against a synthetic token actor, so M3 does not have to
find this.

**4. Editing a deleted comment is `conflict`, not `not_found`.** The row exists and
the caller may well be able to see it in a catch-up response; refusing with 404
would suggest they had the wrong id.

**5. `DELETE` returns 204.** There is no representation worth returning, and the
resource is gone from every ordinary view.

**6. Ownership is enforced through `can()` with `ownerId`**, which LAI-004 already
implemented for the `own + any` / `own` cells of §3.2 — no new policy logic. Tested
per role in both directions: member on own, member on another's, lead on any, org
admin on any, viewer refused, non-member refused.
