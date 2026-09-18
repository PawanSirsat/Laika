---
id: LAI-250
title: 'AppShell decomposes: SessionGate, ScreenOutlet, and a screen registry'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-248]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase A2 of the owner-approved prototype rebuild (2026-09-18). `AppShell.tsx`
is ~560 lines dispatching sixteen routes through a nested ternary chain while
also owning session, setup-gate, invite, theme and error handling. Every later
rebuild task lands on top of it, so it decomposes **first, as a pure refactor
with zero visual change**:

- `src/components/AppShell.tsx` — composition only, ≤ ~120 lines.
- `src/components/shell/SessionGate.tsx` — loading / error / setup-required /
  anonymous gating and redirects.
- `src/components/shell/ScreenOutlet.tsx` — one registry lookup, no ternaries.
- `src/routes/screen-registry.tsx` — `path → { Component, layout: 'space' |
  'plain' | 'own-chrome' }`; the single place a route gains a screen.
- Sign-in, setup and invite handlers move into their screens (`LoginScreen`,
  `FirstBootScreen`, `InviteScreen` own their flows).

## Acceptance criteria

- [ ] Zero visual change, asserted: the existing browser suite passes without
      screen-level edits, and a before/after screenshot pair of `/board` and
      `/login` is byte-compared or pixel-compared in the task's verification
      (state the method in the log).
- [ ] A registry test asserts the **bijection**: every `ROUTES` path has
      exactly one registry entry and every registry entry names a `ROUTES`
      path. A route without a screen, or a screen without a route, is red.
- [ ] `AppShell.tsx` contains no route-name ternary chain and is ≤ ~120 lines.
- [ ] The sign-in, first-boot and invite flows live in their screens; the shell
      passes no flow callbacks down.
- [ ] `visually-hidden` content cannot widen a scroller: the base rule pins
      absolutely-positioned placement so any future scroll container clips it
      (closes LAI-245 — note for CHIEF's dedupe; the LAI-244 log records the
      mechanism).
- [ ] Structure-map (`WEB_*`) entries updated for the new files; old
      mirror-map entries removed with the files they described.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Pure refactor: no design change rides along. `route-table.ts` stays the single
source for what routes exist; the registry maps them to screens. No new
dependencies.

Absorbed backlog id, for CHIEF to close against this: **LAI-245.**
