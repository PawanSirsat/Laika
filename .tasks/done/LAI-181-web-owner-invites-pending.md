---
id: LAI-181
title: 'The client does not declare GET /org owner_invites_pending, and the owner cannot see old owner invites'
area: shell
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-982
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-22T21:46:44Z
started: 2026-10-22T21:41:46Z
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

- [x] `Org` in `server/web/src/api/org.ts` declares `owner_invites_pending`,
      optional, with the shape above.
- [x] The Organisation screen shows them to the owner when there are any,
      beside *More than one owner*, each with a way to revoke it
      (`DELETE /api/v1/invites/:id`).
- [x] `view-type-drift.test.ts` is green; the root gate exits 0.

## Notes

Filed from CORE's range: CHIEF's LAI-950–999 block has no free id (as LAI-177
to LAI-179 were).

## Submission (SHELL, 2026-10-23)

Branch `LAI-181-web-owner-invites-pending` from `f06905b4`.

- `server/web/src/api/org.ts`: `Org.owner_invites_pending?` (optional, absent
  for anyone but the owner) and `OrgOwnerInvite { id, email | null,
  expires_at }`.
- `server/web/src/routes/screens/organisation/OwnerInvites.tsx` (new):
  *Pending owner invites*, shown on People right after *More than one
  owner*. Each row shows the email (or *A link with no address*) and its
  expiry, using the same `expiryLabel` as the invite list, plus **Revoke**.
  Revoke opens `ConfirmDialog` (danger), then `DELETE /api/v1/invites/:id`.
  A refusal stays in the dialog in the server's words; on success the row
  goes and the People data reloads.
- `OrganisationScreen.tsx`: the card renders when `GET /org` carries the
  field, so the server's owner-only gate is the only gate.
- Tests: `test/browser/organisation-people-admin.test.ts` gains 7.
  - The owner sees both rows with their expiry; Revoke asks first, then
    sends exactly one `DELETE /api/v1/invites/oi1`, and the row goes.
  - A refused revoke shows its reason in the dialog, and both rows stay.
  - An admin is never shown the card, watched from page load.
  - Light/dark at 1440/390: no sideways scroll, and the card stays inside
    the viewport.
- Red first: without the source change 6 of the 7 fail (the admin test
  passes either way by design), and `view-type-drift` fails with
  *"OrgView.owner_invites_pending is served and Org does not declare it"*.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #93.
