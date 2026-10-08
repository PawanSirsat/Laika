---
id: LAI-717
title: 'UI polish, batch 1 — centre the List''s empty state, make the Filter popover easy to read and operate'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-08T10:28:16Z
finished: 2026-10-08T11:12:02Z
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
- `server/web/src/routes/screens/board/board.css` — only its `.list` margin rule
  (added with the owner's mid-task addition)
- `server/web/test/browser/filter-popover.test.ts` (new)
- `server/web/test/routes/screens/board/filter-chips.test.ts` (new)
- `server/web/test/browser/list-create-row.test.ts` (new)
- existing web tests only where a selector names markup this task changes

## Acceptance criteria

- [x] The List's filtered empty state is centred horizontally and vertically in
      the list area, measured in a real browser against the pane's box.
- [x] When filters are active and the List is empty, the empty state offers
      **Clear filters**, which removes every filter key and keeps the project.
- [x] The Filter popover has a header with a "Filters" title and a **Clear all**
      button that is disabled when nothing is active.
- [x] A field holding a non-default value is visibly marked as set, using design
      tokens only, and has its own reset control.
- [x] Ready only, Blocked only, Top-level only, Overdue and Agent-created only
      read as one "Quick filters" group of pill toggles.
- [x] The selects sit in a compact two-column grid; the open popover fits a
      1366×768 laptop viewport without scrolling.
- [x] With filters active and the popover closed, a row of removable chips sits
      under the toolbar, one per active filter (e.g. "Status: In progress ×"),
      with a Clear all link; removing one chip removes only that filter.
- [x] Escape and a click outside close the popover; focus moves into it on open
      and returns to the Filter button on close; every control is reachable by
      Tab and has an accessible name.
- [x] Filter logic is unchanged: same fields, same URL parameters, same
      semantics. The popover is shared by the Board and the List and both are
      verified.
- [x] **Added mid-task by the owner, same day:** the List's "+ Create task"
      row is pinned to the bottom of the table card. Few rows: its bottom edge
      is the card's, and any blank space sits above it. Many rows: it stays
      visible as a sticky footer of the scrolling area, on an opaque token
      background, without covering the last row, which stays reachable.
      Empty result: the centred empty state sits above it, not overlapping.
      Clicking it still creates a task; the pager stays outside and below
      the card. Excess bottom padding on a lone row, if a layout bug, fixed.
- [x] Both themes, light and dark, verified by screenshot.
- [x] Each new browser assertion fails against the unchanged code (checked by
      running it against a stash, restored in a trap).
- [x] The repo-root gate is green: `pnpm test`, `pnpm lint`, `pnpm format` each
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

## Builder's notes (2026-10-08T10:50:12Z)

- **Empty state:** the shared `EmptyState` was never wrong; `ListView` returned
  it bare into `.board-main`, a flex *row*, so it was sized to its content and
  pinned left. Fixed in the List's container; no shared component or style
  changed, so no other screen can have moved.
- **Escape and click-outside already closed the old popover.** What the old
  code failed in that test is the focus handling (in on open, back to Filter on
  close). Likewise the old popover already fit a 768px-tall window; the laptop
  test fails on the old code at its two-column-grid check, not on the height.
- **Chips cover what the badge counts**, search excluded, as the badge does.
  Removing the sprint chip sets `sprint=all`, the popover's "Any".
- **The lone row's "extra padding"** was `board.css` giving `.list` a 32px
  bottom margin from when the List scrolled the page (pre-LAI-621); `.list` is
  now the table inside its own card. Removed.
- **The empty List now renders its card** with the Create row pinned under the
  centred state, as the owner's addition asks. The pager is still not drawn
  for an empty List, as before.
- Discovered, not done: LAI-718 (View settings' sprint chip removes to the
  active-sprint default, not "Any"; its labels name no member or sprint),
  LAI-719 (the bulk bar floats over the pinned Create row while rows are
  selected).

## Review notes (round 1)

Sent back 2026-10-08, CHANGES REQUIRED. Gate on 051b067 confirmed green
(TEST 0 / LINT 0 / FMT 0) and filter logic traced unchanged. Unticked: 1
(centring proof), 6 (fit verified on the List only), 9 (Board not verified
with an active sprint).

Blocking
- **B1** The centring test measured against `.list-scroll`, so a card that
  shrank and pinned left would still pass. Measure against `.list-pane` /
  `.board-main`, assert `.list-scroll` fills `.list-pane`, and prove it fails
  when `.board-main > .list-pane { flex: 1 1 0 }` is removed.
- **B2** The Tab test computed the Shift+Tab target and never asserted it.
  Assert it is Clear all and inside `.bt-pop`.

Should-fix
1. Focus goes to `<body>` when a control removes itself: a field's Reset → its
   select; a chip's × → next chip, else previous, else Filter; the chip row's
   Clear all and the last chip → Filter; the empty state's Clear filters →
   something sensible. Tests.
2. Run the fit-at-1366×768 and focus tests on `/board` as well as `/list`.
3. Board with an active sprint (LAI-713): a test that the Sprint chip shows and
   its × writes `sprint=all`; keep the chip; light and dark screenshots.
4. The bulk bar covers the pinned Create row on short lists, and at the end of
   a long scroll — a regression of this task. Fix, test, and close LAI-719.
5. "Unknown member" / "Unknown sprint" chip labels while members and sprints
   load: a neutral placeholder until they arrive; unit test.

Nits
- Selects back on `--bg-column` (the owner rejected `--bg-input`).
- A set select's background must be opaque (translucent `--accent-bg` paints
  the native option list in dark mode on Windows/Linux).
- Hover on an unset select must not look set: a neutral hover border.
- The Quick filters `<legend>` sits on the `border-top` divider.
- Popover slide: `left - 8` can go negative; clamp, and recompute on resize.
- The orphaned comment in `board.css`: delete or move beside `list.css`.
- `ready=false` counts and gets a chip, but the popover does not show it.
- LAI-718: add the review's two notes (× writes `sprint=all`, Clear all deletes
  the key; no `?sprint=` means the active sprint only on re-entry or reload).
- `list-create-row.test.ts`: the opaque-background assertion already passed on
  the old code; say so, do not claim it as a regression catch.

## Round 1 — what changed (2026-10-08T11:12:02Z)

- **B1** `filter-popover.test.ts` "sits in the middle…": at 1440×900, asserts
  `.list-pane` fills `.board-main` and `.list-scroll` fills the pane's content
  box (±1px), and centres the state on `.board-main` across. Removing
  `.board-main > .list-pane { flex: 1 1 0 }` fails it: "the pane does not fill
  the list area: 259 of 1192px".
- **B2** the Tab test asserts Shift+Tab from the first field lands on a
  `Clear all` button inside `.bt-pop`; taking Clear all out of the tab order
  fails it.
- **1** Focus: reset → its select (`BoardToolbar.tsx` `FilterField`); chip × →
  next, else previous, else Filter (`FilterChips.tsx`); chips' Clear all and
  the empty List's Clear filters → Filter (`BoardScreen.tsx`
  `filterButtonRef`). Tested on /list and /board; all fail on 051b067.
- **2** Fit at 1366×768 and the Escape/focus test run on /list and /board.
- **3** Board with an active sprint: the "Sprint: S1 · …" chip shows, the
  badge reads 1, and × writes `sprint=all`. Making `removeFilter` delete the
  key fails it.
- **4** Bulk bar: in `.list-card`, `--list-create-h` + gap above its foot.
  Tested short and scrolled, at 1440×900 and 900 wide; all four fail on
  051b067. LAI-719 closed as fixed here.
- **5** Chip names say `…` until members/sprints load (`filter-chips.ts`);
  unit test; forcing "Unknown member" fails it.
- Nits: `--bg-column` selects; set = accent border + ring + dot (opaque
  background, asserted); neutral hover (asserted); legend floated off the
  divider (asserted); slide clamped and recomputed on resize (asserted);
  orphaned `board.css` comment removed; `ready=false` → on "Not ready" pill
  (asserted); LAI-718 notes added; the opaque-background Create-row assertion
  is labelled as not a regression catch.
- Note: `2c69a45` carries LAI-719's move to `done/` as a pure rename (the
  `git mv` was staged before that commit); its edits are the next commit.

