---
id: LAI-1221
title: 'App header v2: search bar, shared header actions with notifications, one title rule, sidebar shortcuts'
area: web
assignee: shell
priority: p1
depends-on: [LAI-1188]
status: review
started: 2026-11-16T16:30:00Z
finished: 2026-11-16T22:30:00Z
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

- [x] One rule app-wide, chosen and documented: either the header is the
      breadcrumb/context and the page keeps its H1, or the header carries the
      title and the page drops its H1. Applied through the shared component to
      every screen class, never per screen.

### Search bar

- [x] Prominent, centred or clearly anchored field, wider on desktop, with a
      scope hint (*Search tasks, spaces, people…*, *people* only for holders
      of `people.analytics.read`), the ⌘K hint, hover/focus/active states;
      icon-to-sheet on phones.
- [x] The palette, before typing: recent items (localStorage, non-sensitive
      ids only) and suggested actions; grouped results; highlighted matches;
      empty and error states. Still the one LAI-1192 palette.

### Shared header actions (every signed-in screen)

- [x] Notifications bell + popover, built honestly from data the client can
      already read, each source gated on its existing permission; live through
      the existing shared stores/stream (no new `EventSource`); unread against
      a per-device *last seen* where the server keeps no read state, said *on
      this device*; badge, grouped list, deep links, *Mark all as read*, *You're
      all caught up*, error with Retry.
- [x] Backlog task filed (area server, discovered-from LAI-1221) for real
      server-side notifications with read state.
- [x] + Create: quick create of a task in a space the reader may create in,
      through the existing Create task dialog; other create actions only if
      permitted.
- [x] Help (?) opening a keyboard-shortcuts sheet listing the app's shortcuts.
- [x] Theme and the person menu: one home each, no duplicate between the
      header and the sidebar footer. Icon + Tooltip, accessible names, keyboard,
      all themes, reduced motion. Notifications popover and shortcuts sheet
      lazy-loaded if the bundle budget needs it.

### Sidebar shortcuts

- [x] A shortcut per sidebar destination, in a scheme that cannot clash with
      My day's keys, the Review dialog's, `c`, `/`, `.` or ⌘K; never while
      typing; only for destinations the reader can see; shown in the sidebar
      tooltip, the palette and the shortcuts sheet.

### Proof

- [x] Browser tests: search bar states and recent items; the title rule on
      each screen class; notifications (count, unread after a new item via the
      store, mark all read, deep link, member vs admin gating, no extra
      EventSource); + Create; shortcuts sheet; each sidebar shortcut navigates,
      does not fire in inputs and does not clash. Each key behaviour broken once
      and its test seen red.
- [x] Gates, each its own exit code: lint, format, web typecheck, web build,
      web non-browser tests, browser tests in 8 shards. Screenshots before and
      after (dark + light, 1440 + 390) in `.polly/screenshots/header-v2/`.

## Notes for review

- **Owner's later additions, done on this branch:** `structure.test.ts` was red
  on the LAI-1188 base — `HeaderSlot.tsx` now exports a `HeaderSlot`
  component (`HeaderTitle` / `HeaderActions` are it, named) and
  `api/use-org-people.ts` has `test/api/use-org-people.test.ts`; no
  exemption added. The new web modules each have a mirror.
- **"No server person-notification endpoint" was not quite true:**
  `GET /me/notices` (D-134) has read state, and the bell uses it — marking
  read on the server. Everything else waiting on the reader has none; that
  is new against a per-device *last seen*, said *on this device*, and
  LAI-1225 is filed for real server-side read state (+ @mentions, which no
  endpoint addresses to a reader).
- **Filed:** LAI-1225 (server notifications, area server), LAI-1226
  (`host-restart.test.ts` times out on this machine; pre-existing on the base).
- **Known red, not this change:** `my-day-span.test.ts` "Day is a layer" (fails
  on Mondays; today is Monday, fails alone too); `host-restart.test.ts` 2 of 19
  time out at 5 s (LAI-1226).
- Expect LAI-1222's one-line `components/shell/screen-styles.ts` addition at
  merge (the kpi stylesheet); this branch does not touch that file.
