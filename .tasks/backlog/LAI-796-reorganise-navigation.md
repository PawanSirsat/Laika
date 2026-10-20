---
id: LAI-796
title: 'Reorganise the app: a simpler sidebar that collapses to icons, Inbox, Insights and Developer access as merged pages, a user menu, and a calmer My day'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

Owner direct instruction (2026-10-20), with a reference mock at
`/tmp/laika-ref/app.html` (served at http://127.0.0.1:8765/app.html while it
runs; the extracted markup is `/tmp/laika-ref/template.html`). The mock is a
reference for layout and grouping, not a spec and not markup to copy, and its
numbers are invented.

Fewer top-level places, related screens merged behind tabs, and a sidebar
that can be minimised to an icon rail.

## Acceptance criteria

- [ ] Sidebar order: My day and Inbox at the top; Spaces (coloured letter
      badge per space, + to add, More spaces); Organisation group with
      Insights, Organisation and Developer access. The user block at the
      bottom opens a menu: My profile, Switch to dark/light, Developer access,
      Sign out. No other top-level entries.
- [ ] The sidebar collapses to an icon rail (toggle in the sidebar, remembered
      per browser), with tooltips and the same badges and counts; it
      collapses automatically below a narrow width. Keyboard reachable.
- [ ] Inbox = tabs Review and Unlisted work, each with its count; the sidebar
      count is their sum.
- [ ] Insights = tabs Capacity and Usage & cost (the existing screens), with
      the period selector in the page header where the screens support it.
- [ ] Developer access = connecting an agent plus the tokens table on one
      page. The existing Connect wizard stays fully reachable from it; no
      setup step is lost.
- [ ] Organisation = tabs Overview, People, Integrations, Security, grouping
      the existing settings (presence, developer insights, time, AI provider,
      GitHub webhook, members and invites). Only real data; anything the mock
      shows that Laika has no data for is left out, not faked (CLAUDE.md 5.1).
- [ ] Space header: tabs grouped Board, List, Timeline, Calendar | Sprints,
      Dashboard, Activity, Meeting review; Agents chip and Create on the right.
- [ ] My day follows the mock's layout: the week strip, a day timeline bar of
      confirmed and drafted blocks, drafted then confirmed lists, Add time,
      and a right column with On your plate (in progress, waiting on review,
      blocked), Agent minutes and the Draft my time switch.
- [ ] Every old address redirects to its new home (capacity, usage, review,
      unlisted, connect, tokens), so bookmarks and agent links keep working.
- [ ] Light and dark, laptop and phone, both sidebar states.
- [ ] Gate: test, lint, format exit 0.

## Notes / context

- Reference only for layout; take tokens from docs/design/README.md.
- Do not change what any screen can do; this is navigation and layout.
- No new dependency.
