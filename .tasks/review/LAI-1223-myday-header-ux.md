---
id: LAI-1223
title: 'My day body UX pass: availability, toolbar, one nav row, Timeline'
area: web
assignee: shell
priority: p1
depends-on: []
status: review
started: 2026-11-16T16:00:00Z
finished: 2026-11-16T19:30:00Z
---

## Goal

The owner's screenshot of My day (Day view, empty day) shows a tooltip
covering the date line, a toolbar whose "Day confirmed" reads as a button,
four unlabelled icon buttons, navigation spread over two rows, unexplained
shading on the Timeline and an empty state floating over the grid. Fix the
page body. Base: local `LAI-1188` @ b9b2e8ab. Web only (`server/web/`), no
server changes, no new dependencies. The app shell (header, sidebar,
palette, notifications, shared page title, global shortcuts) is LAI-1221's;
Inbox/Insights are LAI-1222's.

## Acceptance criteria

- [x] The availability affordance is one control whose tooltip never covers
      the date line or other adjacent content.
- [x] "Day confirmed" is unambiguous: a state chip when nothing is left to
      confirm, the action "Confirm day" only when there is.
- [x] The day's tools (settings, who looked, beside, shortcuts) are one
      labelled group; each has a name and a tooltip, with its shortcut where
      it has one.
- [x] Date navigation, the Day/Week/Month/Year switch and zoom sit in one
      row; each week-strip day shows its total and status legibly.
- [x] The Timeline labels its shaded hours, draws a now line on today, and
      its empty state sits clear of the grid lines; one primary Start timer.
- [x] No total-vs-target (the API has no target); 390px layout clean; Week,
      Month and Year checked for the same consistency.
- [x] Existing behaviour and shortcuts kept (N, T, ?, G, J/K, ← →, Esc).
- [x] Browser tests for each of the above, each seen red once by a mutation;
      existing tests re-aimed honestly.
- [x] Gates: lint, format, web typecheck, web build, web unit tests, browser
      tests in 8 shards; screenshots before/after, dark + light, 1440 + 390
      in `.polly/screenshots/myday-v3/`.
