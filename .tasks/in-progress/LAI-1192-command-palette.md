---
id: LAI-1192
title: 'Global ⌘K command palette'
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T10:00:00Z
---

## Goal

A global command palette opened by ⌘K / Ctrl+K and by a visible trigger, per
the IA proposal (`.polly/proposal/ia-command-center-proactive.md` §1.2, and
`design-system-and-libraries.md`'s cmdk verdict: inline `Command` inside our
own modal shell, never `Command.Dialog`). `server/web/` only. No new endpoint,
no demo data.

## Acceptance criteria

- [ ] ⌘K / Ctrl+K opens the palette from anywhere, including inside a text
      field; it is the only new global shortcut and collides with none of My
      Day's keys (test runs the handler against `SHORTCUT_GROUPS`).
- [ ] A visible trigger with its shortcut hint opens the palette; Esc closes
      it and restores focus to whatever had it before.
- [ ] Go to: every destination the sidebar shows, from the same
      permission-filtered nav data; nothing the sidebar hides.
- [ ] Spaces: one entry per space the user can read; choosing one switches
      space.
- [ ] Tasks: debounced search by key or title through the existing task API,
      showing key, title and status; loading, empty ("No results for …" with a
      suggestion) and error-with-retry states.
- [ ] Actions: create task in the current space (only when permitted), toggle
      theme, open Appearance if present, sign out.
- [ ] Keyboard-only use works (arrows, Enter, Esc); combobox/listbox roles and
      an announced result count.
- [ ] Dark and light; 1440 and 390 (full-screen sheet); reduced motion; theme
      tokens only.
- [ ] Lazy-loaded so the main bundle does not grow by cmdk; no CSP violations
      under the strict policy (Playwright test collects them).
- [ ] Playwright and unit tests, each shown to fail against a mutation.
- [ ] Gate: `pnpm lint`, `pnpm format`, and the new/changed test files exit 0.

## Notes

- New dependency permitted by this task: `cmdk` (exact version, licence and
  gzipped size recorded below when added).
