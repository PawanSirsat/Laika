---
id: LAI-1330
title: 'People sync from Microsoft: stored profile photos, job title, department and manager, and leavers deactivated automatically behind guards; the switches ship off (D-161)'
area: server
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-18T15:45:00Z
finished: 2026-11-18T21:30:00Z
---

## Goal

Board card LAIKA-1136, dispatched by CHIEF to builder session laika-c4 (Belka). The plan is
`~/.claude/plans/now-you-have-very-validated-perlis.md`, Step 3.

A Global Admin has granted the KSage Entra app `Calendars.Read`, `Calendars.Read.All`,
`User.Read` and `User.Read.All`. The owner wants:

- people's profile photos synced and **stored on our side**, so Microsoft is never asked on a
  view;
- job title, department and manager shown;
- leavers deactivated automatically.

This lands on master **switched off**. AWS has no Microsoft connection and no store, so it stays
inert there.

## Contract

- **One job, `people.sync`.** It runs hourly under `system.people.sync` and joins a run already
  going. It reads Microsoft through the calendar's connection (`org_calendar_source`, §4.101).
  The connection's card is renamed **Microsoft 365**, with separate switches: Calendar, Photos
  and profile, and Leavers.
- **Storage (migration 0090).**
  - `user_directory`, keyed by user: entra_oid, job_title, department, manager_user_id,
    account_enabled, seen_at, missing_since, photo_key, photo_type, photo_etag and
    photo_updated_at.
  - `org_people_sync`: the two new switches and the last run.
- **Photos.**
  - `GET /users/{oid}/photos/240x240` gives the ETag, and `…/$value` is fetched only when it
    changed.
  - The first bytes must be png, jpeg or webp, at most 1 MiB.
  - `store.put` stores it under `u/<userId>/photo/<id>`, and the old object is deleted.
  - A 404 in Microsoft removes the stored one.
  - It is served by `GET /users/:id/photo?v=` with `private, immutable` caching (D-152's
    pattern), readable by whoever may see the person (`member_list.read`).
- **The web.**
  - One read, `GET /people/directory`, feeds a looks-style store.
  - The shared Avatar resolves the photo, and the visible surfaces converge on it.
  - Title, department and manager appear on the profile, People and Capacity, and Capacity
    gains a "My team" filter.
- **Leavers, behind guards.**
  - Only `accountEnabled=false`, or a 404 on two runs at least an hour apart for someone the
    directory had answered for before.
  - Never an owner, and never the last admin.
  - The breaker: more than 3, or more than 10% of members, holds everyone and lists them.
  - Deactivation goes through the existing service.
  - The switch is its own and defaults off. While it is off the card shows a dry run.
- **Docs.** D-161 is drafted for CHIEF. SPEC §3.4, §4.108, §4.109, §6.4, §11.6 and §13.4.

## Acceptance criteria

- [x] Tests with a fake Graph and a fake store:
  - [x] an unchanged ETag means no fetch;
  - [x] a removed photo is deleted;
  - [x] a mismatched type is refused;
  - [x] every leaver guard, including the breaker and the dry run;
  - [x] a per-person 403 or 404 skips only that person;
  - [x] the photo route's privacy and caching.
- [x] Screenshots in light and dark, at 1440 and 390: People with photos and titles,
  Capacity, and the Microsoft 365 card with the dry-run list.
- [ ] CI green on the PR, and an independent review.

## Delivered (2026-11-18)

- **Server.**
  - `people.sync`, `services/people-sync.ts`.
  - `services/people-sync-settings.ts` serves the card.
  - `services/people-directory.ts` serves the directory and the photo.
  - Graph client reads: `user` (with the `mail` fallback), `manager`, `photoTag`, and `photo`
    through `readBinary`.
  - `deactivateLeaver` and `leaverProtection` in `users.ts`. The offboarding steps now take
    §3.4's principal.
  - Migration 0090. Routes `/org/people-sync`, `/people/directory` and `/users/:id/photo`.
- **Web.**
  - `api/people-directory.ts`, a look-store, and its hooks.
  - `api/people-sync.ts`.
  - The card is renamed Microsoft 365, and `PeopleSyncPanel` adds the switches and the dry-run
    list.
  - `PersonFacts` on People, the profile and Capacity, and Capacity's *My team*
    (`?team=mine`).
  - Avatar draws the synced photo by user id. It gains sizes 28, 36 and 60 and a solid tone.
- **Converged onto `Avatar`:**
  - the header's own person;
  - My day's bar and *Who looked*;
  - the task panel's assignee and reporter, its comments, and the composer;
  - People rows and the profile head;
  - Capacity's cards and list;
  - the board rail's activity feed and the presence chip.

  Task cards already used it.
- **Where this differs from the plan:**
  - **A 404 counts toward the leaver rule only for someone the directory had before** (an
    Entra id on the row). Otherwise two runs would deactivate anyone outside the tenant.
  - **Directory entries also carry `manager_name`,** so "Reports to" needs no second read.
  - **"My team" is a People dropdown on Capacity,** shown only to someone with reports, rather
    than an eighth KPI tile.

## Follow-up: initials still drawn by hand

These go to a separate task: KanbanView's swimlanes, ListView (`initialsOf`), the timeline,
BoardToolbar's dropdown and member stack, MembersPopover, SpaceToolbar, SubtasksSection (×3),
DependenciesSection, ManageMemberPanel, ProfileWhoLooked, TimeReport's own Avatar, the
dashboard's Contributors, TimeLoggingView, SpaceActions, space settings' MembersTab (×2),
MembersScreen, AddMemberForm and InviteScreen.
