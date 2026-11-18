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
- **Storage (migration 0091; LAI-1331 took 0090 first).**
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
  - Migration 0091. Routes `/org/people-sync`, `/people/directory` and `/users/:id/photo`.
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

## Review round 1 (review-1317, 2026-11-18)

Asked by CHIEF on PR #391. What changed, one item each:

- **M1.** Once a row holds an Entra id the person is read by it (`/users/{entra_oid}`); the
  address is used only for the first match. An id answered with another account, or a `404`
  whose address now answers with another id, saves nothing, makes no leaver and is listed as
  *Microsoft account changed: check* (`changed` on the run and on the review).
- **M2.** `disabled_since` is kept only for a read by the id the row already held, and the
  verdict needs it at least an hour old: a first match never deactivates anyone.
- **F1.** The breaker counts the sync's own `user.deactivated` rows (`via:
  'microsoft_directory'`) over a rolling 24 hours, plus this run's.
- **F2.** Another tenant or client id saved, or a disconnect, forgets every Entra id,
  `missing_since` and `disabled_since`, and turns *Leavers* off. **Found while testing it:** a
  run still reading the old tenant would have written its ids back, leaving those people
  *changed* for ever. Each write now asks whether the connection is still the one the run read
  with, and the run stops, recording nothing, when it is not.
- **F3.** A deactivated leaver's photo object and directory row are deleted.
- **F4.** A `404` on the 240px photo asks for the default size (`/photo`).
- **F5.** An empty `2xx` body is skipped: nothing removed, nothing counted refused.
- **F6.** Each leaver is deactivated on their own; one that throws is marked `failed`, and the
  rest still go.
- **F7.** Viewers and read-only tokens get photos only from `/people/directory`.
- **F8.** The browser harness answers the directory and the people sync only when a test asks.
- **F9.** A directory read that fails on the network, a `5xx` or a `429` is tried again,
  waiting 2 s and doubling to a minute, six times at most.
- **Renumbered** to `0091_people_directory` after #390 took 0090, regenerated for a newer
  journal time; SPEC §4.108 and §4.109 kept.


## Review round 2 (review-1317, 2026-11-18)

- **M2 (required).** `disabled_since` now starts only on a change the sync saw: a read by the
  row's own id that says disabled, when the read before had the account enabled. An account
  disabled since its first match is never a leaver. It is listed to check, with reason
  `disabled_at_match`.
- **Two members at one Microsoft account (required).** When an Entra id is already pinned to
  another member's row, the next first match is not saved. It is listed to check as
  `shared_account`, so only the member holding the id can ever go.
- **The check list says why.** `changed[]` items carry
  `reason: account_changed | shared_account | disabled_at_match`, and the card words each one.
- **F2 residual.** The photo writes (stored, removed) and the failure record now ask whether
  the connection is still the one the run read with. A photo put as another tenant is saved
  has its object deleted again.
- **F3 residual.** A deactivated person's photo answers the same `404`, and the directory names
  no `photo_v` for them.
- **Web.** A directory read that began before a change of user is dropped when it answers (a
  generation counter).
