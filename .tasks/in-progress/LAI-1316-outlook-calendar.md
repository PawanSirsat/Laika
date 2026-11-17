---
id: LAI-1316
title: 'Outlook calendar: meetings read through Microsoft Graph and logged automatically as time on My day, switch ships off (D-157)'
area: server
assignee: chief
priority: p1
depends-on: []
status: in-progress
started: 2026-11-17T19:34:12Z
---

## Goal

Owner, 2026-11-18: "get all data from Outlook calendar, like the meetings, into Ksage … and log
that in My day, the timing". His choices:
- **Access:** an admin grants the Entra app **"KSage"** (client `ae9ce6ed-ef7a-45ff-9a05-6db164d947bd`,
  tenant `5abd4f6b-f235-4d86-a90c-08f2e5f56fbb`) the Graph **application** permission
  `Calendars.Read`, once.
- **Logging:** meetings are **logged automatically**.

Consent is pending: the app has no granted roles yet. So this ships **fully built and off**, and is
switched on later.

It goes to **master**: it needs a migration, and the Ksage line (`integration-ksage`) allows none.
It is inert on AWS with no credentials, and reaches Ksage through the master → `integration-ksage`
merge.

## Acceptance criteria

- [ ] **Graph client.** `server/src/services/microsoft-graph.ts`, copying
      `services/clan-client.ts`:
      - no SDK, injectable `fetchImpl`, sleep and clock;
      - AbortController timeout cleared in `finally`;
      - one retry on 429/503 honouring `Retry-After`;
      - an app-only token from `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
        (`client_credentials`, scope `https://graph.microsoft.com/.default`), cached until near
        expiry;
      - `@odata.nextLink` paging followed only on the Graph host, with a page cap;
      - code-only errors that never echo Microsoft's body.

      Tests use `test/helpers/fake-graph.ts`, modelled on `fake-clan.ts`.
- [ ] **Settings.**
      - A new table `org_calendar_source`, modelled on `org_hr_source` (`schema.ts:1496-1551`):
        tenant id, client id, the secret encrypted under a new `secrets.ts` purpose (write-only,
        last 4 shown), `enabled` **default false**, last sync status and time, and mapping rules
        (JSON: Teams channel or title keyword → project).
      - Routes in Organisation → Integrations, with action `org.calendar.configure` for owners and
        admins (session only).
      - A "Test connection" that gets a token and reports the `roles` claim, saying whether
        `Calendars.Read` is granted. It works while the switch is off.
- [ ] **Source enum and migration.** Add `calendar` to `TIME_ENTRY_SOURCES` (`enums.ts:641`).
      - The migration **rebuilds `time_entries`** for its CHECK (`0041_time_my_day.sql:87`), via
        `pnpm run db:generate`. Read the generated `INSERT … SELECT`.
      - `runMigrations` keeps FKs off (`migrate.ts:633-670`), and `ensureActivityTriggers`
        recreates the triggers.
      - Add a `test/db/migrate.test.ts` preservation test: rows, revisions, the
        `time_entries_no_replace` trigger, the three-year trigger, and FK integrity all survive.
- [ ] **Link table.** `calendar_events` (`user_id`, `event_id` unique per user, `ical_uid`,
      `entry_id`, `entry_revision_synced`, `last_seen_at`), modelled on
      `solidtime_entries.entry_revision` (`schema.ts:4362`).
- [ ] **Sync job.** `calendar.sync` in `jobs/scheduler.ts`: every 15 min, async, not `atStart`,
      `assertCan(SYSTEM, 'system.calendar.sync')` (new SYSTEM_ACTIONS entry and §3.4 row), and a
      run-join so runs never overlap (the `runHrSync` pattern). It does nothing unless configured
      **and** enabled.
      - For each active member, matched by lowercased email: read
        `/users/{email}/calendarView?startDateTime&endDateTime` for yesterday through tomorrow in
        the person's zone (`zonesFor`, `services/availability.ts:128-148`).
      - **Include:** accepted, or organiser (`responseStatus.response` in
        `accepted|organizer`).
      - **Skip:** tentative, declined, `isCancelled`, `showAs=free`, `isAllDay`.
      - **Entry:** `insertEntry` / `syncEntry` (`services/time-entries.ts:314`, `:830`) with
        `changedBy` = the member, `source='calendar'`, `source_ref` = the event id,
        `kind='meeting'`, and title = the subject, or **"Busy"** when `sensitivity` is
        `private`/`confidential`. **Never store join links, bodies or attendee addresses.**
      - **Project:** by the mapping rules, else none. `day_full` is handled as in
        `time-solidtime.ts:987`.
      - **Updates:** a changed meeting updates its entry. A cancelled or vanished one in the window
        is retired with `retireEntry`.
      - **A person's edit wins:** if the entry's current revision is past `entry_revision_synced`,
        the sync never touches it again.
- [ ] **Web.**
      - `api/time.ts` `EntrySource` gains `calendar`.
      - A "From Outlook" source pill and wording wherever `import` has a branch: `EntryRow.tsx`,
        `Inspector.tsx`, `revision-words.ts`, `timeline-derive.ts`, `Timeline.tsx`,
        `TimelineMobile.tsx`, `WeekView.tsx`, `overview-derive.ts` and `summary-derive.ts` (count
        as meeting time).
      - The Integrations card follows `HrSourceSection.tsx`: credentials, test connection, mapping
        rules, the switch (default off), last sync.
      - Both themes, phone width, tokens only.
- [ ] **Decisions.**
      - `calendar` entries are **not** pushed to the Solidtime outbox (`time-solidtime.ts:418,429,
        536`). They are editable and deletable by the person like manual entries.
      - **D-157**: calendar meetings are logged automatically. It amends D-088 items 2 and 4 (subject
        only, never links or bodies) and D-108 (kind `meeting` is set by the sync), and adds a new
        outbound destination to §13.4.
      - SPEC: §4.48 `source` row (`SPEC.md:2335`), §3.1, §3.4, §4 new tables, §6.4, §11.6, §13.4.
- [ ] CI gate green on the PR into master: test, lint and format each exit 0.

## Notes / context

- Research pointers (2026-11-18):
  - `time_entry_revisions.changed_by` must be a real user (`schema.ts:3925`).
  - The unique index is `(user_id, source, source_ref)` (`:3887`).
  - The `time_entries_no_replace` trigger refuses re-inserting a deleted `source_ref`; revive it
    with `syncEntry`.
  - Overlaps are allowed (D-113).
  - A web `EntrySource` change is unguarded by drift tests, but `EntryRow.tsx`'s Record makes
    typecheck flag missing branches.
- PR #354 (Ksage line only) has its own app-only token helper in `microsoft-directory.ts`. **Do not
  depend on it.** This feature reads its credentials from `org_calendar_source`, so it works on
  master.
- Reserved decision numbers: D-152 icons, D-153 email, D-154 Teams, D-155 email-to-task,
  D-156 Ksage line, D-157 this, D-158 SSO.
