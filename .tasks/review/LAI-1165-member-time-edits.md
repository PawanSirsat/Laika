---
id: LAI-1165
title: Owners and admins change a member's confirmed time
area: server
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-06T17:20:00+05:30
finished: 2026-11-06T17:47:29+05:30
---

## Goal

Owner, 2026-11-06: an owner or admin reading a member's Day tab could see a
wrong entry and only ask the member to fix it. Let them correct it there, with
the member told and the editor on the record (D-143, amending D-102 rule 4 and
D-088 items 2 and 6). Board card LAIKA-1028.

Named crossings (D-033): `docs/SPEC.md` §3.1 (one row and its paragraph),
§4.49 (`changed_by`), §4.87 (`kind`, `task_id`, `subject`), §6.4 (four
routes and the revisions note), §11.4.2 (Member profile row); `docs/DECISIONS.md`
(D-143 appended); `server/web/` for the client half.

## Acceptance criteria

- [x] `time_entries.write_member` in `ORG_ACTIONS` and `SESSION_ONLY_ACTIONS`;
      `can()`: owner any other user, admin any other user but the owner, member
      and viewer no, yourself no, an absent target role no. Every census updated
      (matrix, permissions, policy-spec drift, agent-sessions route census).
- [x] `POST /people/:id/time-entries`, `PATCH`/`DELETE
      /people/:id/time-entries/:entryId`, `GET …/:entryId/revisions`, bodies as
      `/me/time-entries`'; each calls `can()` in the service.
- [x] Refusals: yourself `422 use_own_time`; admin on the owner `403
      not_for_owner`; a closed day `403 closed_period`; another person's entry
      id `404`; a token `403 session_required`.
- [x] Imports (owner, 2026-11-06): an owner or admin may change or delete a
      member's imported entry on this path; the person's own path still
      refuses it `403 imported_entry`. A Solidtime re-pull after such an edit
      or delete does not fail: unchanged keeps the edit, a Solidtime change
      puts its version back (both in the history), a delete retires once.
- [x] Every change a `time_entry_revisions` row with `changed_by` the editor;
      revisions carry `changed_by_name`; no Undo on this path.
- [x] A `time_changed` member notice per change (`<change> <day> <±min>`,
      the card as `task_id`); migration 0080 rebuilds the CHECK; every
      `migrationsFolder` test run.
- [x] `importAllSolidtime` records the puller as `changed_by`.
- [x] Web: `addEntry`/`updateEntry`/`deleteEntry`/`getRevisions` take a
      subject → `/people/:id/…`; My day splits `notOwn` from `canEdit`;
      confirmed entries editable for an allowed editor, drafts/timer/breaks not;
      imports included for an editor (Inspector and Timeline);
      Inspector history for the editor naming who changed what; banner reads
      "Changes you make are shown to <first>"; notice wording on For you.
- [x] Tests: policy matrix, service, route, migration, web API URLs, notice
      wording, browser (owner lengthens → PATCH to `/people/u2/…`, history
      names the owner; an import is editable too; a member sees no control),
      the history's words. Mutations of the policy guard, the admin-on-owner
      refusal, the import-all `changed_by` and the client subject each turn
      their test red.
- [x] SPEC §3.1, §4.49, §4.87, §6.4, §11.4.2 and D-143 written.
