---
id: LAI-1192
title: 'Global ⌘K command palette'
area: shell
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-11T10:00:00Z
finished: 2026-11-11T13:45:00Z
---

## Goal

A global command palette opened by ⌘K / Ctrl+K and by a visible trigger, per
the IA proposal (`.polly/proposal/ia-command-center-proactive.md` §1.2, and
`design-system-and-libraries.md`'s cmdk verdict: inline `Command` inside our
own modal shell, never `Command.Dialog`). `server/web/` only. No new endpoint,
no demo data.

## Acceptance criteria

- [x] ⌘K / Ctrl+K opens the palette from anywhere, including inside a text
      field; it is the only new global shortcut and collides with none of My
      Day's keys (test runs the handler against `SHORTCUT_GROUPS`).
- [x] A visible trigger with its shortcut hint opens the palette; Esc closes
      it and restores focus to whatever had it before.
- [x] Go to: every destination the sidebar shows, from the same
      permission-filtered nav data; nothing the sidebar hides.
- [x] Spaces: one entry per space the user can read; choosing one switches
      space.
- [x] Tasks: debounced search by key or title through the existing task API,
      showing key, title and status; loading, empty ("No results for …" with a
      suggestion) and error-with-retry states.
- [x] Actions: create task in the current space (only when permitted), toggle
      theme, open Appearance if present, sign out.
- [x] Keyboard-only use works (arrows, Enter, Esc); combobox/listbox roles and
      an announced result count.
- [x] Dark and light; 1440 and 390 (full-screen sheet); reduced motion; theme
      tokens only.
- [x] Lazy-loaded so the main bundle does not grow by cmdk; no CSP violations
      under the strict policy (Playwright test collects them).
- [x] Playwright and unit tests, each shown to fail against a mutation.
- [x] Gate: `pnpm lint`, `pnpm format`, and the new/changed test files exit 0.

## Notes

- New dependency permitted by this task: **`cmdk` 1.1.1** (exact pin, latest
  stable, published 2025-08-27), **MIT**. It pulls in `@radix-ui/react-dialog`,
  `-primitive`, `-id` and `-compose-refs`. Only the inline `Command` is used,
  never `Command.Dialog`, whose Radix scroll lock writes a `<style>` element
  under `style-src-elem 'self'`.
- **Gzipped size, measured** with `vite build` and `gzip -9` on the merged tree
  (base `8e6a2249`): the lazy `CommandPalette-*.js` chunk (cmdk, Radix bits and
  the palette) is **18,647 B gz** (55,941 B raw), fetched on first open only.
  The main `index-*.js` grows **+256 B gz** (584,832 → 585,088), which is the
  host, the trigger and the store. Main CSS grows **+635 B gz**
  (106,563 → 107,198).
- `pnpm-lock.yaml` (repo root) changes because adding the dependency writes it.
  The diff is additions only: cmdk and its Radix dependencies.
- **Open Appearance**: no Appearance screen exists on this base, so per the
  brief ("if present") there is no row. Theme is a palette action.
- **Task search**: `GET /tasks` has no text parameter and `GET /tasks/:id`
  takes an id, not a key (`services/tasks.ts` `getTask`). So the palette reads
  one slim page of `GET /tasks?limit=200` once per opening, when the first
  query of 2+ characters settles after a 200ms debounce, and matches key,
  outside id and title client-side. When more pages exist it says "In loaded
  results". A server search endpoint (proposal BE-5) would replace this.
- **Shortcut scope**: per the brief, ⌘K / Ctrl+K does not fire inside a text
  field or an editor (shared `components/typing-in.ts`). The proposal's "active
  even while typing" was overridden by the brief. Inside the palette's own field
  a second ⌘K closes it.
- **cmdk quirk**: on open, cmdk highlights the first row without setting
  `aria-activedescendant` (it reads the id from the DOM before the row is
  marked selected). `CommandPalette.tsx` fills it from the highlighted row;
  the browser test asserts it.
- Proposal's example "no Dashboard without `audit_log.export`" is stale: the
  route table no longer gates Dashboard. The tests instead assert that Go to
  equals `navRoutes(holds)` + `spaceTabs(holds)` for the same predicate.
- Updated an existing assertion with reason: `spaces-sidebar.test.ts` expected
  Tab from the rail toggle to land on My day; Search is now the first entry
  and shows its tooltip the same way.
