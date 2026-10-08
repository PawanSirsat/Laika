---
id: LAI-726
title: 'UI polish — a custom, scrollable, keyboard-accessible dropdown for the Filter popover and every select in the app'
area: web
assignee: ui-dropdown
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-08T12:35:36Z
finished: 2026-10-08T13:23:13Z
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
- [x] `Dropdown` in `server/web/src/components/`, no new dependency, follows
      the WAI-ARIA select-only combobox pattern: trigger `role="combobox"` with
      `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` and
      `aria-activedescendant`; panel `role="listbox"`; options `role="option"`
      with `aria-selected`.
- [x] Trigger keeps the field's height and `--bg-column` background, LAI-717's
      set-state marking (accent border, ring, dot) and reset, shows the current
      value with its icon or avatar, and a chevron.
- [x] Panel opens below, flips above when there is no room, never leaves the
      viewport, is at least the trigger's width, has a ~18rem max-height with
      its own slim, themed scrollbar, and uses surface tokens, border, shadow
      and radius matching the popover — light and dark.
- [x] "Any"/"Anyone" pinned first and separated; the selected option shows a
      check and is scrolled into view on open; hover and active highlight on
      tokens; long names truncate with a tooltip.
- [x] Rich options: status dot, LAI-705 priority icons, member avatars,
      tag-styled label chips, sprint key + name with the active sprint marked
      and dates muted (from data already loaded), plain Updated within.
- [x] Lists of more than 8 options get a search box pinned at the top: focus
      on open, case-insensitive filtering with the match highlighted, "No
      matches" when nothing fits.
- [x] Keyboard: Up/Down, Home/End, Enter/Space select, type-ahead without a
      search box, Tab closes without selecting, Escape closes only the panel
      and returns focus to the trigger; a second Escape closes the popover.
- [x] Mouse: an option click selects and closes; a click elsewhere in the
      popover closes only the panel; the popover's outside-click handler does
      not treat a click in the (portalled) panel as outside — tested.
- [x] Touch: option rows at least 36px tall.

The Filter popover
- [x] All six fields use it, on the Board and the List; each option click
      writes the same URL parameter as before, for every field.
- [x] The closed popover still fits 1366×768; an open panel may leave the
      popover but never the viewport (1366×768 and 900px wide).

App-wide
- [x] No native `<select>` remains under `server/web/src/` outside
      `routes/screens/timeline/`; a structural test asserts it.
- [x] Each replaced control writes what it wrote before; the tests that drove
      them still assert the same outcomes.

LAI-717 follow-ups
- [x] `--list-bulk-room` is measured from `.list-bulk` by a ResizeObserver;
      a test with a tall (wrapped) bar asserts `lastRow.bottom <= bulk.top` at
      the end of the scroll.
- [x] The active-sprint Board fit test waits for `.strip-chip` and
      `sprint=s1` before measuring.

Verification
- [x] Every new test fails on the old code (old files swapped in, restored in
      a trap); the log records how.
- [x] Screenshots in `/tmp/laika-ui-dropdown-shots/`, light and dark: Label
      (search + scroll, 35 labels), Assignee, Sprint, Status, flip-above.
- [x] Repo gate after the last edit: `TEST 0`, `LINT 0`, `FMT 0`.

## Notes / context

- CLAUDE.md §5.1: tokens only (`docs/design/README.md`), both themes, no
  hardcoded mockup data.
- The panel is portalled to `<body>`: the popover scrolls (`overflow-y: auto`)
  and is slid with `translate`, either of which would clip or re-anchor a
  panel drawn inside it.

## As built (2026-10-08, for the reviewer)

**Scope, against the list above.** `ListView.tsx` and `list-bulk.test.ts` were
not needed: the observer lives in `BulkBar.tsx`, and the wrapped-bar test sits
with the existing bulk-bar geometry tests in `list-create-row.test.ts`. Added,
each for a stated reason:
- `board/TaskDetailPanel.tsx` — one line, the status ref's type
  (`HTMLSelectElement` → `HTMLButtonElement`).
- `test/components/no-native-select.test.ts` — the "no native select" scan is a
  source test, so it is not under `browser/`.
- `test/routes/screens/board/new-column-dialog.test.ts`,
  `test/routes/screens/task/sprint-control.test.ts` — source tests that
  grepped `{STATUSES.map(` and `<option value="">No sprint</option>`; they now
  assert the same of the `Dropdown` options.
- CSS that styled a site's `<select>`: `forms.css`, `space.css`,
  `members.css`, `organisation.css`, `board.css`, `column-composer.css`,
  `assign.css`, `task-detail.css`, `task-panel.css`.

**Deviations from the brief, and why.**
- **Space selects only when there is no search box.** In a search box a space
  is part of the search; Enter chooses there.
- **Sprint "Any" writes `sprint=all` on both screens** — `BoardScreen` maps
  it for the List too, as before (the brief's test idea assumed the List
  wrote nothing; the code never did).
- **The panel is portalled to `<body>`.** `useDismiss` asks
  `isInDropdownPanel()` before treating a click as outside, and ignores an
  Escape a dropdown already used; a targeted mutation of the first goes red.

**Tests that changed, none weakened:** `filter-popover`, `list-view`,
`space-bar`, `board-refresh`, `column-reorder`, `organisation-roles`,
`task-panel`, `subtasks`, `priority-icons`, `task-drawer` drive the control
with `pick()` / `optionsOf()` / `valueOf()` instead of `selectOption()`,
`option` reads and `inputValue()`.

**Noticed, not changed:** on the real server, choosing a Label narrows the
loaded tasks, and the popover offers only labels in use on them, so after
`?tag=warehouse` the Label list holds that task's labels, not all 35. This
predates LAI-726 (`BoardScreen` derives `knownTags` from loaded tasks); the
stubbed tests do not see it because the stub ignores `tag`.


## Review notes (round 1)

**APPROVED, no blocking issues.** All 29 call sites keep the same values and
write the same things.

**The reviewer's gate on ec1281a:** LINT 0, FMT 0. TEST failed only on
`server/test/tooling/build.test.ts` boot timeouts under load average ~60;
that file passed 15/15 run on its own.

**Should-fix before release** (follow-up commits on `build-ui-dropdown`):
1. The panel follows its trigger off-screen on scroll (top −234px measured in
   the drawer). Close it on a scroll outside the panel, as a native select
   does; test in the task drawer.
2. The panel is portalled to `<body>`, outside `aria-modal="true"` dialogs, so
   a screen reader hides it. Portal into the nearest `[aria-modal="true"]`;
   test its parent and its position.
3. The search box is `role="searchbox"` with `aria-activedescendant`; make it
   `role="combobox"` with `aria-autocomplete="list"`, `aria-expanded="true"`,
   `aria-controls`.
4. Sprint options' accessible label and type-ahead drop the key (it sits in an
   `aria-hidden` icon); label them "S1 · Foundations".
5. Safari: closing a searchable dropdown by clicking its trigger likely
   reopens it (blur has no `relatedTarget`, then click calls `show()`). Mark
   the trigger's pointerdown and ignore that blur; test in Safari's event
   order.

**Nits:** closed-trigger type-ahead starts from the previous session's active
option, and the buffer is not reset on close; `options.indexOf()` inside maps;
extend the no-native-select guard to `createElement('select'|'option')`; skip
search autofocus on `(pointer: coarse)` and place with `visualViewport`; CSS
clean-up (escaped backticks in a `task-panel.css` comment, dead
`.panel-control`, `.bar-control select`, `.board-filter select` rules).
