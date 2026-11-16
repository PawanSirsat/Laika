---
id: LAI-1221
title: 'App header v2: search bar, shared header actions with notifications, one title rule, sidebar shortcuts'
area: web
assignee: shell
priority: p1
depends-on: [LAI-1188]
status: in-progress
started: 2026-11-16T16:30:00Z
---

## Goal

The owner's feedback on the LAI-1188 header (screenshots of Inbox, My day,
Insights): the header's small page title repeats the page's big H1; the search
field is small and jammed right; the header should carry options shared across
every page, such as notifications; the sidebar's destinations want keyboard
shortcuts.

Base: local `LAI-1188` @ b9b2e8ab (LAI-1188 is in review and not yet on
`master`; dispatched to stack on it). Web only (`server/web/`), no server
changes, no new dependencies. LAI-1222 (Inbox + Insights bodies) and LAI-1223
(My day body) run in parallel on the same base; this task owns the shell —
header, sidebar, palette, shared header components and the shared page-title
component — and touches no page body beyond the title rule.

## Acceptance criteria

### Title rule

- [ ] One rule app-wide, chosen and documented: either the header is the
      breadcrumb/context and the page keeps its H1, or the header carries the
      title and the page drops its H1. Applied through the shared component to
      every screen class, never per screen.

### Search bar

- [ ] Prominent, centred or clearly anchored field, wider on desktop, with a
      scope hint (*Search tasks, spaces, people…*, *people* only for holders
      of `people.analytics.read`), the ⌘K hint, hover/focus/active states;
      icon-to-sheet on phones.
- [ ] The palette, before typing: recent items (localStorage, non-sensitive
      ids only) and suggested actions; grouped results; highlighted matches;
      empty and error states. Still the one LAI-1192 palette.

### Shared header actions (every signed-in screen)

- [ ] Notifications bell + popover, built honestly from data the client can
      already read, each source gated on its existing permission; live through
      the existing shared stores/stream (no new `EventSource`); unread against
      a per-device *last seen* where the server keeps no read state, said *on
      this device*; badge, grouped list, deep links, *Mark all as read*, *You're
      all caught up*, error with Retry.
- [ ] Backlog task filed (area server, discovered-from LAI-1221) for real
      server-side notifications with read state.
- [ ] + Create: quick create of a task in a space the reader may create in,
      through the existing Create task dialog; other create actions only if
      permitted.
- [ ] Help (?) opening a keyboard-shortcuts sheet listing the app's shortcuts.
- [ ] Theme and the person menu: one home each, no duplicate between the
      header and the sidebar footer. Icon + Tooltip, accessible names, keyboard,
      all themes, reduced motion. Notifications popover and shortcuts sheet
      lazy-loaded if the bundle budget needs it.

### Sidebar shortcuts

- [ ] A shortcut per sidebar destination, in a scheme that cannot clash with
      My day's keys, the Review dialog's, `c`, `/`, `.` or ⌘K; never while
      typing; only for destinations the reader can see; shown in the sidebar
      tooltip, the palette and the shortcuts sheet.

### Proof

- [ ] Browser tests: search bar states and recent items; the title rule on
      each screen class; notifications (count, unread after a new item via the
      store, mark all read, deep link, member vs admin gating, no extra
      EventSource); + Create; shortcuts sheet; each sidebar shortcut navigates,
      does not fire in inputs and does not clash. Each key behaviour broken once
      and its test seen red.
- [ ] Gates, each its own exit code: lint, format, web typecheck, web build,
      web non-browser tests, browser tests in 8 shards. Screenshots before and
      after (dark + light, 1440 + 390) in `.polly/screenshots/header-v2/`.
