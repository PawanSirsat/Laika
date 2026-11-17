---
id: LAI-1231
title: 'Top bar: the gear and the person menu both list Appearance and Developer access'
area: web
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-17T10:05:00Z
finished: 2026-11-17T10:40:00Z
---

## Goal

The owner, with two screenshots of the top bar's gear menu (Appearance,
Organisation settings, Developer access): the header has duplicate options
across the settings and the profile menus. Since LAI-1227 the person menu
(`PersonMenu`) carried **Appearance** and **Developer access**, and the gear
(`HeaderSettings`) beside it carried both too.

Keep them in the gear, which is the settings menu, and take them out of the
person menu, which keeps My profile, the quick theme switch and Sign out.

Base: local `ui-round9` @ bb825910. Web only (`server/web/`), no server
changes, no new dependencies. Local commits only, not pushed.

## Acceptance criteria

- [x] The person menu lists My profile (when granted), Switch to dark/light
      and Sign out, and no Appearance or Developer access.
- [x] The gear is unchanged: Appearance for everyone, then Organisation
      settings and Developer access exactly when the rail draws them.
      `/developer` carries no permission in `ROUTES`, so every reader who had
      it in the person menu still has it under the gear.
- [x] Tests that asserted the person menu's five items assert three, and
      assert Appearance and Developer access are absent from it; the
      Appearance page test reaches the page through the gear.
- [x] Comments that named the person menu as the way to Appearance say the
      gear (`route-table.ts`, `HeaderActionsCluster.tsx`, `reachable.test.ts`).
- [x] Web typecheck, eslint and prettier on the changed files, the route
      unit tests and the affected browser tests exit 0.
