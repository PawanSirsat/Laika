---
id: LAI-1188
title: 'One app header on every screen, with a role-aware search bar and person view'
area: web
assignee: shell
priority: p1
depends-on: []
status: in-progress
started: 2026-11-16T09:00:00Z
---

## Goal

The owner, verbatim: "Work onto a consistency of the Headers into all the
screens and add the Search Bar into the Header, make it different for
organization, admin and member so that Organization Level & Admin: Can search
and toggle to the persons view as well."

Base: local `ui-round8-check` @ 1402fc82. Web only (`server/web/`), no server
changes, no new dependencies.

## Acceptance criteria

### Part A — one header everywhere

- [ ] Audit every top-level screen's header (My day, Inbox, Work, every space
      tab incl. the LAI-1198 space header, Spaces, Organisation,
      People/profile, Insights, Developer, Appearance, Workroom
      `/task/:key`, design pages); screenshots before, dark + light, 1440 and
      390, in `.polly/screenshots/header-search/before/`; a short inventory in
      `.polly/specs/header-consistency.md`.
- [ ] ONE shared app header, extending the existing shell header (no
      competing one): consistent height; left = page title / breadcrumb
      (space name + key on space screens); centre/right = search bar; right =
      page actions slot, then the existing global items. The LAI-1198 space
      header becomes the space-screen variant of it, not a second system.
- [ ] Phones: title + a search icon that opens a full-width field; actions
      fold where needed. Existing tokens and kit components only. Per-screen
      header copies that are replaced are deleted.

### Part B — header search, role-aware

- [ ] The header search IS the ⌘K command palette (LAI-1192) surfaced inline:
      clicking the field or ⌘K opens the same palette. No second search
      engine; the palette's sources are extended. The sidebar's *Search* row
      is reconciled with it (phone access kept).
- [ ] Scopes come only from server permissions already exposed to the client
      (`GET /permissions` through the existing gates), never a role name.
      Everyone: pages, spaces, tasks, allowed actions. Holders of the
      permission that gates `/people?user=` and the see-everyone views: also a
      **People** group, searched by name/email over the existing users
      endpoint.
- [ ] Person view for those holders: selecting a person offers Open profile
      (`/people?user=<id>`) and each screen that ALREADY shows another person
      (with that person selected). While a person view is active the header
      shows a dismissible *Viewing: <name>* chip with one click back to Me.
      Read-only viewing; no auth/session change, no new endpoint. A screen
      that cannot show another person is not offered.
- [ ] Members never see the People group or the person toggle (tested with a
      member fixture).
- [ ] Keyboard: ⌘K / `/` (the clash with the space search's `/` resolved and
      documented), arrows, Enter, Esc; screen-reader labels; dark, light and
      black; reduced motion.

### Tests and gates

- [ ] Browser tests: header presence/consistency per screen class, search
      open/close, member vs admin scopes, selecting a person routes to the
      right view and shows the Viewing chip, back to Me. Each key behaviour
      broken once and its test seen red, then restored.
- [ ] Every existing check stays green (tokens, z-index, motion, no `title=`,
      icon-button names, bundle budget).
- [ ] Gates, each its own exit code: `pnpm lint`, `pnpm format`, web
      typecheck, `pnpm --filter ./server/web build`, the web test suite
      (non-browser + all browser shards). Screenshots after in
      `.polly/screenshots/header-search/after/`.
