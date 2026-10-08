---
id: LAI-726
title: 'UI polish — a custom, scrollable, keyboard-accessible dropdown for the Filter popover and every select in the app'
area: web
assignee: ui-dropdown
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-08T12:35:36Z
---

## Goal

Made on the owner's direct instruction; UI polish. The builder is a single
agent working the way `docs/HANDOVER.md` §4 describes, on branch
`build-ui-dropdown` in worktree `Laika-ui-dropdown/`, cut from `master`
5adbfae. Nothing here is pushed; the owner releases it.

**The id.** The owner's brief named LAI-725. CLAUDE.md §3's two-part sweep,
run immediately before filing, found LAI-725 taken on `build-ui-polish`
(`.tasks/backlog/LAI-725-timeline-space-bar-filters-do-nothing.md`) and
LAI-724 on `build-perf-store`, so this is the next free id in the block.

From two production screenshots (Board, OnRoute, Filter popover open): the
popover's six selects — Status, Priority, Assignee, Label, Sprint, Updated
within — are native `<select>`s. Each opens the OS's own grey menu, which
ignores the app's design; the Label list (about 35 entries) becomes a tall OS
menu that overflows the popover, runs off the screen, and jumps to the top of
the window when the selected entry is further down.

When this is finished those six fields are one shared, token-styled combobox
(WAI-ARIA select-only combobox + listbox) with a scrollable panel that stays
inside the viewport, rich option content, search on long lists, and the full
keyboard model — and, at the owner's follow-up ("also add the custom dropdown
globally"), **every other native `<select>` in the web app uses the same
component**, except the Timeline's files, which another builder is rewriting.
**Filter logic does not change**: the same values, setters, URL parameters,
badge, chips and resets.

It also carries two LAI-717 round-2 follow-ups, moved here from the Timeline
builder: a measured bulk-bar room on the List, and a Board fit test that waits
for the sprint strip's chip before measuring.

## Scope — the exact files (CLAUDE.md §1)

New:
- `server/web/src/components/Dropdown.tsx`
- `server/web/src/components/dropdown.css`
- `server/web/src/components/dropdown-model.ts` (pure logic: filtering,
  highlighting, type-ahead, placement)
- `server/web/test/components/dropdown-model.test.ts`
- `server/web/test/browser/filter-dropdown.test.ts`
- `server/web/test/browser/dropdown-global.test.ts`
- `server/web/test/browser/dropdown.ts` (test helper: pick an option through
  the custom control, the replacement for `selectOption`)

Changed — the Filter popover and the follow-ups:
- `server/web/src/routes/screens/board/BoardToolbar.tsx`
- `server/web/src/routes/screens/board/board-toolbar.css`
- `server/web/src/routes/screens/BoardScreen.tsx` — **only** the `sprints=`
  prop mapping passed to `BoardToolbar` (key, name, active, dates already
  loaded); no data loading is touched
- `server/web/src/routes/screens/list/ListView.tsx`, `BulkBar.tsx`, `list.css`
  — the measured bulk-bar room
- `server/web/test/browser/filter-popover.test.ts`, `list-bulk.test.ts`

Changed — the app-wide rollout (each native `<select>` → `Dropdown`):
- `server/web/src/components/forms/Select.tsx`, `forms.css`
- `server/web/src/components/space/SpaceTopBar.tsx`
- `server/web/src/routes/screens/MembersScreen.tsx`
- `server/web/src/routes/screens/AddMemberForm.tsx`
- `server/web/src/routes/screens/organisation/OrganisationScreen.tsx`
- `server/web/src/routes/screens/board/AssignControl.tsx`,
  `ColumnComposer.tsx`, `ColumnDialog.tsx`, `LaneRow.tsx`,
  `NewColumnDialog.tsx`, `NewTaskForm.tsx`
- `server/web/src/routes/screens/task/TaskMeta.tsx`,
  `DependenciesSection.tsx`, `SubtasksSection.tsx`
- the CSS beside each of those that styled its `<select>`
- the browser tests that drove those selects with `selectOption`, updated to
  drive the new control without weakening an assertion

**Not touched:** `server/web/src/api/*`, the screens' data fetching, and
everything under `server/web/src/routes/screens/timeline/` (other builders'
work in flight).

## Acceptance criteria

The component
- [ ] `Dropdown` in `server/web/src/components/`, no new dependency, follows
      the WAI-ARIA select-only combobox pattern: trigger `role="combobox"` with
      `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` and
      `aria-activedescendant`; panel `role="listbox"`; options `role="option"`
      with `aria-selected`.
- [ ] Trigger keeps the field's height and `--bg-column` background, LAI-717's
      set-state marking (accent border, ring, dot) and reset, shows the current
      value with its icon or avatar, and a chevron.
- [ ] Panel opens below, flips above when there is no room, never leaves the
      viewport, is at least the trigger's width, has a ~18rem max-height with
      its own slim, themed scrollbar, and uses surface tokens, border, shadow
      and radius matching the popover — light and dark.
- [ ] "Any"/"Anyone" pinned first and separated; the selected option shows a
      check and is scrolled into view on open; hover and active highlight on
      tokens; long names truncate with a tooltip.
- [ ] Rich options: status dot, LAI-705 priority icons, member avatars,
      tag-styled label chips, sprint key + name with the active sprint marked
      and dates muted (from data already loaded), plain Updated within.
- [ ] Lists of more than 8 options get a search box pinned at the top: focus
      on open, case-insensitive filtering with the match highlighted, "No
      matches" when nothing fits.
- [ ] Keyboard: Up/Down, Home/End, Enter/Space select, type-ahead without a
      search box, Tab closes without selecting, Escape closes only the panel
      and returns focus to the trigger; a second Escape closes the popover.
- [ ] Mouse: an option click selects and closes; a click elsewhere in the
      popover closes only the panel; the popover's outside-click handler does
      not treat a click in the (portalled) panel as outside — tested.
- [ ] Touch: option rows at least 36px tall.

The Filter popover
- [ ] All six fields use it, on the Board and the List; each option click
      writes the same URL parameter as before, for every field.
- [ ] The closed popover still fits 1366×768; an open panel may leave the
      popover but never the viewport (1366×768 and 900px wide).

App-wide
- [ ] No native `<select>` remains under `server/web/src/` outside
      `routes/screens/timeline/`; a structural test asserts it.
- [ ] Each replaced control writes what it wrote before; the tests that drove
      them still assert the same outcomes.

LAI-717 follow-ups
- [ ] `--list-bulk-room` is measured from `.list-bulk` by a ResizeObserver;
      a test with a tall (wrapped) bar asserts `lastRow.bottom <= bulk.top` at
      the end of the scroll.
- [ ] The active-sprint Board fit test waits for `.strip-chip` and
      `sprint=s1` before measuring.

Verification
- [ ] Every new test fails on the old code (old files swapped in, restored in
      a trap); the log records how.
- [ ] Screenshots in `/tmp/laika-ui-dropdown-shots/`, light and dark: Label
      (search + scroll, 35 labels), Assignee, Sprint, Status, flip-above.
- [ ] Repo gate after the last edit: `TEST 0`, `LINT 0`, `FMT 0`.

## Notes / context

- CLAUDE.md §5.1: tokens only (`docs/design/README.md`), both themes, no
  hardcoded mockup data.
- The panel is portalled to `<body>`: the popover scrolls (`overflow-y: auto`)
  and is slid with `translate`, either of which would clip or re-anchor a
  panel drawn inside it.
