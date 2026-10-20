---
id: LAI-793
title: 'SPEC §11.4.2 and §11.4.2.1 have no row for My day or the Organisation Time setting'
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-787]
discovered-from: LAI-787
status: backlog
---

## Goal

The screen → endpoint map and the must-have elements per screen name My day
(`/my-day`, under the person in the sidebar footer) and the Time row on
Organisation.

## What LAI-787 found

LAI-787 named the SPEC sections it may edit (§1.1, §3.1, §4, §6.4, §7.1,
§13.4) and §11.4.2 was not among them, so the screen shipped without its row.
My day calls `GET /me/time`, `GET/PUT /me/time-settings`, the draft and entry
writes of §6.4; Organisation's Time row calls `PUT /org/time`.

## Acceptance criteria

- [ ] §11.4.2 rows for My day and the Time setting, with their endpoints.
- [ ] §11.4.2.1's must-have elements for My day, from LAI-787's criteria.
