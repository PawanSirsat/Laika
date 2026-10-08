---
id: LAI-717
title: 'UI polish, batch 1 — centre the List''s empty state, make the Filter popover easy to read and operate'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-08T12:00:00Z
---

## Goal

Made on the owner's direct instruction, batch 1 of a UI polish series. The
builder is a single agent working the way `docs/HANDOVER.md` §4 describes
("If you are one agent doing all of it"), on branch `build-ui-polish`; the
owner releases the batch in one push, so nothing here is pushed.

From two screenshots of production (OnRoute, List tab, "Filter 1"): the List's
empty state sat in the bottom-left of a large blank area, nothing said which
filter was hiding everything, and the Filter popover was one tall column of
native selects and loose checkboxes that overlapped the table and, once closed,
gave no clue what was active.

When this is finished the empty state is centred in the list area and offers
to clear the filters, and the popover reads at a glance — a header with *Clear
all*, set fields marked and individually resettable, the yes/no options as one
group of toggles, a compact grid — with a row of removable chips under the
toolbar whenever a filter is active and the popover is closed. **Presentation
only**: the same fields, the same URL parameters, the same semantics.

## Scope — the exact files (CLAUDE.md §1)

- `server/web/src/routes/screens/list/ListView.tsx`
- `server/web/src/routes/screens/list/list.css`
- `server/web/src/routes/screens/board/BoardToolbar.tsx`
- `server/web/src/routes/screens/board/board-toolbar.css`
- `server/web/src/routes/screens/board/FilterChips.tsx` (new)
- `server/web/src/routes/screens/board/filter-chips.ts` (new)
- `server/web/src/routes/screens/BoardScreen.tsx`
- `server/web/test/browser/filter-popover.test.ts` (new)
- `server/web/test/routes/screens/board/filter-chips.test.ts` (new)
- existing web tests only where a selector names markup this task changes

## Acceptance criteria

- [ ] The List's filtered empty state is centred horizontally and vertically in
      the list area, measured in a real browser against the pane's box.
- [ ] When filters are active and the List is empty, the empty state offers
      **Clear filters**, which removes every filter key and keeps the project.
- [ ] The Filter popover has a header with a "Filters" title and a **Clear all**
      button that is disabled when nothing is active.
- [ ] A field holding a non-default value is visibly marked as set, using design
      tokens only, and has its own reset control.
- [ ] Ready only, Blocked only, Top-level only, Overdue and Agent-created only
      read as one "Quick filters" group of pill toggles.
- [ ] The selects sit in a compact two-column grid; the open popover fits a
      1366×768 laptop viewport without scrolling.
- [ ] With filters active and the popover closed, a row of removable chips sits
      under the toolbar, one per active filter (e.g. "Status: In progress ×"),
      with a Clear all link; removing one chip removes only that filter.
- [ ] Escape and a click outside close the popover; focus moves into it on open
      and returns to the Filter button on close; every control is reachable by
      Tab and has an accessible name.
- [ ] Filter logic is unchanged: same fields, same URL parameters, same
      semantics. The popover is shared by the Board and the List and both are
      verified.
- [ ] Both themes, light and dark, verified by screenshot.
- [ ] Each new browser assertion fails against the unchanged code (checked by
      running it against a stash, restored in a trap).
- [ ] The repo-root gate is green: `pnpm test`, `pnpm lint`, `pnpm format` each
      exit 0, run after the last edit.

## Notes / context

- `EmptyState` (`components/EmptyState.tsx`, `states.css`) already centres its
  own content. Whether the misalignment is the shared component or the List's
  container is to be found out, and fixed at the source.
- `BoardToolbar` is mounted only by `BoardScreen`, which serves both `/board`
  and `/list`.
- The chips read `activeFilters` (`filter-keys.ts`), the one filter list
  (LAI-487); a removal goes through the same handler the popover's "Any" uses.
- No new dependencies.
