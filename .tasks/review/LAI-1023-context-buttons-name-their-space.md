---
id: LAI-1023
title: 'Each space''s "Context" button names its space for screen readers'
area: shell
assignee: shell/belka
priority: p3
depends-on: []
discovered-from: LAI-1018
status: review
started: 2026-11-01T13:03:17Z
finished: 2026-11-01T13:17:27Z
---

## Why

Found by the LAI-1018 live walk on production (`8469099f`). `/projects`
lists five spaces, and each row's button is named only "Context" (no
`aria-label`, no `aria-describedby`). The visible row gives the space, so the
purpose is clear in context (WCAG 2.4.4 passes). But a screen-reader user
browsing by buttons hears "Context, button" five times and cannot tell them
apart (2.4.9, AAA). The same holds for the row's "Members" button.

`server/web/src/routes/screens/projects/SpaceActions.tsx`.

## Acceptance criteria

- [x] Each space's "Context" button has an accessible name that includes the
      space, such as "Context for Laika". The visible text stays "Context".
- [x] The same for "Members", if it shares the pattern.
- [x] A web test asserts two spaces' Context buttons have different
      accessible names.

## Build notes (shell/belka)

- `SpaceActions`: `aria-label="Context for <space>"` and `"Members of <space>"`;
  visible text unchanged and the name starts with it (WCAG 2.5.3).
- Test: `test/browser/spaces-page.test.ts` "each space's buttons name it
  (LAI-1023)", grid and list views. Red with either label removed.
