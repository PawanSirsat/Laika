---
id: LAI-1312
title: 'The Meetings page: list, attendance, transcript, Review with AI, Add to My day'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-1311]
status: backlog
---

## Goal

Plan `/Users/kvelld/.claude/plans/async-plotting-sketch.md` §B. Sidebar HOME:
My day · Meetings · Inbox (Alt+2; later shortcuts shift). Two panes: grouped
list with filters and search; detail with Attendance, Transcript (fetched on
open), Review tabs; actions toasted.

## Acceptance criteria

- [ ] Route, nav, icon, shortcut, chunk, screen registry, copy — pinned tests updated.
- [ ] List grouped Today/Yesterday/Earlier this week/Upcoming; filters All/Attended/With transcript; search.
- [ ] Detail: scheduled vs actual, organiser, space link picker; tabs Attendance, Transcript, Review.
- [ ] Actions with toasts: Review with AI (Open), Add to My day (Undo), Open in Teams.
- [ ] Hidden from nav unless SSO and meetings sync are on; empty state explains how.
- [ ] Type pairing, endpoint coverage; browser test; both themes; 390px.
