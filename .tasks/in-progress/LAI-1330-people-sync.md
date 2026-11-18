---
id: LAI-1330
title: 'People sync from Microsoft: stored profile photos, job title, department and manager, and leavers deactivated automatically behind guards; the switches ship off (D-161)'
area: server
assignee: chief
priority: p1
depends-on: []
status: in-progress
started: 2026-11-18T15:45:00Z
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

- [ ] Tests with a fake Graph and a fake store:
  - [ ] an unchanged ETag means no fetch;
  - [ ] a removed photo is deleted;
  - [ ] a mismatched type is refused;
  - [ ] every leaver guard, including the breaker and the dry run;
  - [ ] a per-person 403 or 404 skips only that person;
  - [ ] the photo route's privacy and caching.
- [ ] Screenshots in light and dark, at 1440 and 390: People with photos and titles,
  Capacity, and the Microsoft 365 card with the dry-run list.
- [ ] CI green on the PR, and an independent review.
