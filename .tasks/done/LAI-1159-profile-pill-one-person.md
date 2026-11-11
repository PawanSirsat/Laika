---
id: LAI-1159
title: 'Profile pill: an analytics reader reads one person, never the list that logs everyone'
area: web
assignee: shell/belka
priority: p1
depends-on: []
discovered-from: LAI-1153
status: done
started: 2026-11-06T11:53:15+05:30
finished: 2026-11-06T11:53:15+05:30
---

## Goal

LAI-1152 (merged, 3d8f2562, deploy cancelled before production) drew someone
else's availability pill from their row of `GET /people/availability`. For a
holder of *See everyone's analytics* — every owner — the server writes a `time`
look at **every person that list contains** (`listPeopleAvailability`,
`server/src/services/people-load.ts`), so opening one profile told the whole
organisation they had been looked at, filling every *Who looked* with false
looks. Found by LAI-1153's builder; the deploy of 3d8f2562 was cancelled so it
never reached production.

## Acceptance criteria

- [x] For a reader with *See everyone's analytics*, someone else's pill reads
      only `GET /people/:id/load` for that person — its one `time` look (day
      null) is the one opening the profile already writes (D-139 item 4), so
      D-135's dedupe adds no row — and **never** `GET /people/availability`.
- [x] A reader with profiles but without that grant keeps their row of the
      list, which the server narrows and does not log for them; they never read
      the load.
- [x] Browser tests assert the list is never read by an analytics reader on any
      tab, the load once, and the list once for a non-analytics reader; a
      mutation back to the list turns them red.
- [x] SPEC §11.4.2's Member profile row says which read the head card makes.

## Notes / context

p1: `master` holds the leak undeployed; nothing else merges until this does.
