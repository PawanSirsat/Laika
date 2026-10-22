---
id: LAI-987
title: 'Organisation → People is hard to operate: no search or filters, no confirmations, invites are clumsy, no transfer'
area: web
assignee: shell
priority: p1
depends-on: [LAI-981, LAI-982, LAI-984, LAI-970]
discovered-from:
status: review
finished: 2026-10-23T12:30:00Z
started: 2026-10-23T09:00:00Z
---

## Acceptance criteria (audit A4, B3, B5, B6, B7, B8)

- [x] People: search, chips for role / active–deactivated / space, counts,
      last sign-in column; same design language as the Spaces page (LAI-978).
- [x] Role picker without *Owner*; owner sees **Transfer ownership** (typed
      confirmation). Confirmations on role change, invite revoke, deactivate
      (with offboarding dialog from LAI-988 when present) and Undo where safe.
- [x] Invite form: space + space-role picker; **bulk** (paste emails, per-row
      result); expiry choice; **Copy link**; **Re-issue** on expired/lost.
- [x] Organisation name editable on Overview (holders only).
- [x] Every gate from the server's permissions (LAI-970). Light/dark,
      1440/390, browser tests. Gate exit 0 with servers merged.

## Claim note (SHELL, 2026-10-23)

`depends-on` names LAI-981, LAI-982, LAI-984 and LAI-970, none in `done/` on
`master`. Claimed on CHIEF's dispatch against base `63690059` — LAI-993's
integration of the release-2 server work (976, 981–986, 974) plus LAI-977's
branch, which carries LAI-970's `useGates()`. Recorded as the §2 step 1
deviation; the PR targets `integration-owner-visibility-2026-10-22`.

## Submission note (SHELL, 2026-10-23)

**Red on this branch, by design (§4.4 step 1) — other builders' halves only.**
`pnpm test` exits 1 on two assertions in `server/web`, and on nothing of
this task's:

- `test/api/endpoint-coverage.test.ts` *"no endpoint is served, uncalled and
  unexplained"* — `api/v1/org/overview` (LAI-989),
  `api/v1/password-resets/consume`, `api/v1/users/*/memberships`,
  `api/v1/users/*/reset-link`, `api/v1/users/*/sign-out` (LAI-988),
  `api/v1/tasks/summary` (LAI-975). `invites/*/reissue` and
  `org/transfer-ownership` left that list here.
- `test/api/view-type-drift.test.ts` *"no server field is missing from its
  client type"* — `CapabilityView.description is served and Capability does
  not declare it` (LAI-989). `UserView.last_seen_at` and `OrgView.extra_owners`
  left it here.

The verbs `user.signed_out` and `org.ownership_transferred` now have wording,
a stream subscription and dashboard wording (three checks green).
`pnpm lint` 0, `pnpm format` 0.

**Decisions.**
- Owner rows are text for everyone; an extra owner (D-104 item 2) is
  reported to the owner in its own card with *Make admin*, never silently.
- Role picker and Transfer follow the role (`me.org_role === 'owner'`) as
  D-104 item 2 directs; every other control follows `useGates()`; the org
  name follows `org.settings.edit`.
- Deactivation's dialog asks the open-task question (unassign pre-selected,
  or reassign) because the server refuses a deactivation without it (`409
  open_tasks`). LAI-988's fuller offboarding dialog replaces it when it lands.
- Undo is offered for a role change only. Deactivation ends sessions and
  tokens and reactivation restores neither, and a revoked invite's link is
  gone — neither is safely undoable.
- Expired invites are deleted by the cron and excluded from the listing, so
  *Re-issue* is offered on every pending invite (the lost-link case).
- The space filter reads `GET /projects/:slug/members`; `users/*/memberships`
  is LAI-988's caller to build.
- `useOrganisation` keeps the loaded list on screen during a re-read (it
  used to drop to the skeleton, unmounting People and its Undo).
