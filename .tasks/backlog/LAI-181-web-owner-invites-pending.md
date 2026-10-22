---
id: LAI-181
title: 'The client does not declare GET /org owner_invites_pending, and the owner cannot see old owner invites'
area: shell
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-982
status: backlog
---

## What is wrong

The release-2 review fixes (branch `release2-server-review-fixes`, LAI-982
review response) refuse a pending owner invite from before D-104 at
acceptance (`422 use_transfer`; it stays unaccepted) and report such invites to
the owner on `GET /org` as:

```
owner_invites_pending?: { id: string; email: string | null; expires_at: number }[]
```

Same gate as `extra_owners`: present only for the owner, signed in; absent,
not null. This is the web half (CLAUDE.md §4.4). Until it lands, the root gate
has one failure:

`server/web/test/api/view-type-drift.test.ts:740` — *"OrgView.owner_invites_pending
is served and Org does not declare it — add it, or list it in clientOmits with
a reason"*.

## Acceptance criteria

- [ ] `Org` in `server/web/src/api/org.ts` declares `owner_invites_pending`,
      optional, with the shape above.
- [ ] The Organisation screen shows them to the owner when there are any,
      beside *More than one owner*, each with a way to revoke it
      (`DELETE /api/v1/invites/:id`).
- [ ] `view-type-drift.test.ts` is green; the root gate exits 0.

## Notes

Filed from CORE's range: CHIEF's LAI-950–999 block has no free id (as LAI-177
to LAI-179 were).
