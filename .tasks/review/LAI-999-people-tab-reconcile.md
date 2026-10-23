---
id: LAI-999
title: 'Release 2''s People-tab features (LAI-987) collide with the People tab master already shipped (LAI-893)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-998]
discovered-from: LAI-998
status: review
finished: 2026-10-23T15:30:00Z
started: 2026-10-23T13:00:00Z
---

## Goal

D-107: keep LAI-893's released People tab as the layout and port every
LAI-987 feature it lacks into it, on top of LAI-998's merged tree.

## Acceptance criteria

- [x] Start from LAI-998's branch head (everything else merged). Do not merge
      `origin/LAI-987-people-tab-overhaul` wholesale; port from it.
- [x] In LAI-893's components (`PeopleTab.tsx`, `InviteDialog.tsx`,
      `people-derive.ts`): last sign-in column; confirmations (role change with
      Undo, deactivate → LAI-988's offboarding dialog, revoke invite);
      **Transfer ownership** (owner only, typed email) and the extra-owners
      card; role picker without Owner; invite: optional space + space role,
      lifetime 1/7/30 days, Copy link, Re-issue on pending; bulk invite if the
      dialog lacks it; search/chips only where LAI-893 lacks an equivalent.
- [x] Organisation name editable on Overview (LAI-987's `OrgNameFact`).
- [x] Every gate from the server permissions store (`user.invite`,
      `user.deactivate`, `token.list_any`, …), never `canManage`/role, except
      D-104 item 2. LAI-893's existing tests keep passing or are updated with
      a stated reason; LAI-987's tests ported to the merged screen.
- [x] Light/dark 1440/390; screenshots.
- [x] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Claim note (SHELL, 2026-10-23)

`depends-on: [LAI-998]` is not in `done/` on `master`. Claimed on CHIEF's
dispatch against base `d748fcb1` (LAI-998's release-2 integration, gate green);
recorded as the §2 step 1 deviation. PR targets
`integration-owner-visibility-2026-10-22`.

## Submission note (SHELL, 2026-10-23)

Gate at the repo root, foreground, stdin closed: `pnpm test` **0**
(server 3851 passed / 10 skipped; server/web 3199/3199; cli 606 tests, 0
failed), `pnpm lint` **0**, `pnpm format` **0**.

**Kept from LAI-893** (D-107 item 1): the table and its columns, the role
filters with counts, search, sort, the bulk bar, the Pending list and the
invite dialog, presence-based *Last active*, the seat line.

**Ported from LAI-987** into those components: *Last sign-in* column
(`last_seen_at`); *Deactivated* filter and a space filter (from
`GET /capacity`'s spaces — no extra request); role picker without Owner and
owner rows as text; role change behind a confirmation with Undo; bulk role
change and bulk deactivate behind confirmations (bulk deactivate unassigns
open tasks, D-104 item 5's pre-selected answer); single deactivate through
LAI-988's `OffboardingDialog`; Revoke behind a confirmation; Re-issue on each
pending invite with the new link and Copy; *into Space as role* on pending
invites; invite dialog with optional space + space role, lifetime 1/7/30 days,
an answer per address (a refused address no longer stops the rest), Copy link
per link and named non-addresses; Transfer ownership (owner only, typed
email); the extra-owners card; `OrgNameFact` on Overview.

**Tests updated, with reasons**: `organisation-people.test.ts` (893) —
filter list gains *Deactivated 1*; bulk Make Admin now confirms first.
`organisation-roles.test.ts` — no Owner in the picker (D-104 item 2); role
change confirms and offers Undo; deactivation goes through the offboarding
dialog; the refusal test drives a member's row (owner rows have no picker).
`people-derive.test.ts` — `roleCounts` gains `off`.

**Integration resolution (named in CHIEF's dispatch):** paired
`OwnershipTransferView` ↔ `OwnershipTransfer` in `view-type-drift.test.ts`
and removed its `UNPAIRED` row from `server/test/tooling/response-type-coverage.test.ts`
(CORE's file) in the same commit, `a1167ef6`.

**Found:** LAI-893's dialog said link invites expire after 2 days; the
server gives every invite `expires_in_days` (default 7). The lifetime
choice replaces that sentence.
