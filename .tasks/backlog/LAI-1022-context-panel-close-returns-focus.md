---
id: LAI-1022
title: 'Closing the Project context panel returns focus to the space''s Context button, not to the page body'
area: shell
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1018
status: backlog
---

## Why

Found on production (`8469099f`) by the LAI-1018 live keyboard walk, in all
four configs (dark and light, 1440 and 390 px). On `/projects`, press Enter
on the Laika space's "Context" button and Tab into the panel (`aside`
"Context document for Laika"). Its History, Compare and Delivered to all
work by keyboard, and Hide returns focus to "View r1". Then press the panel's
**Close**: the panel goes and `document.activeElement` is `<body>`.

A keyboard user loses their place in the space list (WCAG 2.4.3). The opener
is known: `ProjectsScreen.tsx` holds `contextFor`, and `SpaceActions`'s
"Context" button sets it. `ProjectContextPanel.tsx`'s `close()` calls
`onClose()` and nothing returns focus.

Evidence: `.polly/evidence/LAI-phase6/s5-*`; the record is
`docs/acceptance/LAI-1018-live-browser.md` § 5.

## Acceptance criteria

- [ ] Closing the panel (Close, and "Close without saving?" → yes) returns
      focus to the "Context" button of the space whose panel it was, in both
      themes, at desktop and 390 px.
- [ ] Cancelling "Close without saving?" leaves focus inside the panel, as now.
- [ ] A web test opens the panel by keyboard, closes it, and asserts the
      opener has focus. The test goes red when the restore is removed.
