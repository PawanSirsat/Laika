---
id: LAI-1190
title: The task drawer works on every space view, as a real modal dialog
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-1124
status: review
finished: 2026-11-05T11:23:54Z
started: 2026-11-04T14:03:49Z
---

## Goal

`?task=` opens the full task panel on every view of a space — Board, List,
Timeline, Calendar, Sprints, Dashboard, Activity, Meeting review — not only on
the board, and the drawer behaves as a modal dialog: labelled, focus held
inside, Escape closing only the innermost layer. Fixes B1, B2, B3/B22, B4,
B18 and B19 of the UX audit (`docs/ux/audit/ux-audit.md`, LAI-1124) as slice
S0 of `docs/ux/specifications/task-workroom.md` §10.

## Acceptance criteria

- [x] A `TaskDrawerHost` mounted by `SpaceLayout` renders the drawer frame and
      its content; `BoardScreen` no longer renders the panel itself. Board and
      List register their live task set through a `TaskSourceProvider`; every
      other view falls back to the host's own reads (the project's task set,
      `GET /tasks/:id`, statuses, sprints, members).
- [x] The drawer is `role="dialog"`, `aria-modal="true"`, labelled by the task
      key and title, and traps Tab with `useDialogFocus`; closing returns
      focus to the opener.
- [x] Escape in the panel's overflow menu closes the menu only (and an outside
      click does too); a second Escape closes the drawer. The phone sheet's
      handle and swipe still close it.
- [x] *Detach from parent* asks to confirm, and a refused detach is shown in
      the panel's alert.
- [x] Meeting review and Unlisted open a task in its own space's drawer
      (`?project=` and `?task=`), never `/board?q=KEY`, through one
      `taskHref` helper.
- [x] *Create* in the space bar opens the new-task form in place on any space
      view, still gated by `task.create`.
- [x] Browser tests cover: calendar and timeline drawers show the task title;
      Tab stays in the drawer; overflow Escape layering and focus return; Back
      closes; meeting-review link; Create on `/calendar`; Detach confirm and
      error.

## Notes / context

**Renumbered again, to LAI-1190** (2026-11-05). LAI-1140 was taken too:
`LAI-1140-developer-setup-tab` (PR #285, board card LAIKA-1003) holds
`.tasks/review/LAI-1140-developer-setup-tab.md`. The sweep run before the first
renumber missed it. Commits on this branch carry `[LAI-1127]` (the claim,
`47ecb7b4`) and `[LAI-1140]` (`6e238f07` to `ad7369bc`) in error and stand as
written (CLAUDE.md §3); every later commit carries `[LAI-1190]`. The branch name
`LAI-1140-drawer-host` is historical and kept so PR #289 stays intact.

**Renumbered from LAI-1127 to LAI-1140** (2026-11-05). `origin/master` gained
a different LAI-1127 (`LAI-1127-insights-usage-cost-redesign.md`, PR #271)
while this was in flight. The claim commit `47ecb7b4` carries `[LAI-1127]` in
error; it was not rewritten (CLAUDE.md §3: a renumber does not reach commits
already made). Every later commit carries `[LAI-1140]`.

UI only (`server/web/`). No new dependencies. Spec:
`docs/ux/specifications/task-workroom.md` §2–§3 and §10 S0 (branch
`LAI-1124-ux-docs`). The panel split (S1) is begun only as far as the host
needs.
