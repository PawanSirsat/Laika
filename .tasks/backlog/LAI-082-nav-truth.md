---
id: LAI-082
title: Ship only nav that works, and register the four real screens
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

**Seven of eight sidebar destinations are empty placeholders.** The owner opened
the app and found dead links everywhere. Fix that tonight, and unblock Builder-A
to build screens in parallel (D-028).

## Acceptance criteria

- [ ] **Hide `Tokens`, `Capacity` and `Meeting review`.** No API exists behind
      any of them (M3, M5, M6). Do not delete the routes — hide them from the
      sidebar, so a direct URL still renders the placeholder.
- [ ] **The rule is data-driven, not a hand-kept list.** A route declares whether
      it ships; the sidebar renders only those. The next screen must not need
      anyone to remember to unhide it — that is how seven dead links happened.
- [ ] A test asserts **every visible nav item resolves to a real screen**, and
      fails if a placeholder is exposed. Break it on purpose and watch it go red.
- [ ] **Register routes and empty screen shells for `sprints`, `timeline` and
      `dashboard`** at `routes/screens/sprints/`, `.../timeline/`,
      `.../dashboard/` — one component file each, rendering the existing loading
      state. **Builder-A fills them in (D-028) and must never edit
      `route-table.ts` or `Sidebar.tsx`.** This step is what lets them start.
- [ ] `Projects` appears in the sidebar. It works today and is unreachable except
      by typing the URL.
- [ ] Both themes.

## Notes / context

After this the sidebar is **Board · Sprints · Timeline · Projects · Dashboard ·
Organisation** — six, four of which work immediately and two arriving behind
them. That is an honest sidebar.

Do this first and commit it on its own. Builder-A is blocked until the shells and
routes exist.
