---
id: LAI-1167
title: 'One Create task dialog for a space: + Create, c and the List row (D-145)'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-11-09T16:20:00Z
finished: 2026-11-09T18:50:46Z
---

## Goal

The space bar's **+ Create** does nothing today: `SpaceLayout.tsx` navigates
to `/board?…&new=task` and no code reads `new=task`. Every way of making a
task from the browser takes a title and a priority, while
`POST /projects/:slug/tasks` already accepts the description, acceptance,
deliverables, tags, assignee, agent, dates, effort, outside id and parent.
The owner decided (2026-11-09, D-145): one centred **Create task** modal for
the space, opened from *+ Create*, the `c` key and the List's *Create task*
row, with every field; the sprint and the blockers set after the create.
Board card LAIKA-1030 (`external_ref: LAI-1167`).

## Acceptance criteria

- [x] `server/web/src/components/create-task/` holds `CreateTaskProvider.tsx`
      (open/close state, the `c` key, the `?new=task` reader, the toast),
      `use-create-task.ts`, `CreateTaskDialog.tsx`, `CreateTaskFields.tsx`,
      `create-task-form.ts` (pure), `CreatedToast.tsx`, `created-toast.css`,
      `create-task.css`. `SpaceLayout` mounts the provider for every view.
- [x] Always shown: Title, Description (rich), Status, Priority, Assignee,
      Agent, Sprint, Due date, Labels. Under *More*: Acceptance (rich), What
      this delivers (ships / solves / unlocks), Planned start, Effort, Parent,
      Blocked by, Outside id.
- [x] *+ Create* in the space bar, the List's *Create task* row and `c` each
      open the same `[data-dialog="create-task"]`; a lane's *Add task* keeps
      its inline composer; `NewTaskForm.tsx` and its `.new-task*` CSS are gone.
- [x] `c` does nothing while typing (`typingIn`, moved to
      `components/typing-in.ts`; `my-day/shortcuts.ts` re-exports it), with a
      modifier, while another `[aria-modal="true"]` is open, or for a reader
      without `task.create`. `?new=task` is honoured once the permissions have
      settled and then removed from the address with a replace.
- [x] `toCreateBody` omits empties, sends `status_id` and never `status`,
      maps dates through `dateInputToMs`, lines through `linesOf`, drops
      blank deliverables, normalises and dedupes tags, and carries no sprint
      or blocker key. `CreateTaskInput` / `createTask` take the full body.
- [x] Submit order: create → `addTasksToSprint` → `addDependency` per blocker
      → `reloadProjectTasks`. A refused create lays `errorsByField` on the
      fields (zod `issues` paths and service `details.field`; `status` and
      `status_id` both land on Status), keeps the form, focuses the first
      invalid control (after the render that marks it: a control first, else
      the editor through its handle), shows no toast. A failed step after the create closes
      the dialog as on success and the toast is `role="alert"`: *LC-7 created,
      but could not add it to Sprint 4*, the server's sentence under it, with
      *Open*. Success: `role="status"` *LC-7 created · Open*, gone in 6 s.
      *Open* sets `?task=<id>` with a history entry.
- [x] *Create another* keeps status, priority, sprint and assignee, clears the
      rest, remounts both editors, puts focus back on the Title, and the next
      create carries the kept four.
- [x] Keyboard: focus starts on the Title; Tab and Shift+Tab stay inside
      (`useDialogFocus`, which leaves Tab inside a Dropdown's portaled panel
      to the Dropdown); Enter in the Title creates and in no other one-line
      field, nor on the *Create another* box; ⌘/Ctrl+Enter creates from
      anywhere, the editors included; Escape, the scrim, × and Cancel close —
      asking *Discard this task?* first when a title, description or
      acceptance has been typed, at once otherwise — from inside the
      ProseMirror document too; focus returns to the opener, falling back to
      `.space-create`.
- [x] Review round 1: the editor's link popover is no longer a `<form>`
      (nested in the dialog's form it submitted the page as a GET); Enter in
      its address applies the link and the dialog's Enter guard exempts inputs
      inside `.rich-editor`; a change of space closes the dialog; Description,
      Acceptance, Labels, Agent and the Ships rows carry `aria-labelledby` /
      `aria-describedby` / `aria-invalid`; the Labels control stays drawn,
      locked, during the POST.
- [x] Shape: `.ct-scrim` z 60, `.ct-dialog` z 61 at
      `width: min(42.5rem, calc(100vw - 2rem))`, `top: 8vh`,
      `max-height: 84vh`, scrolling body, pinned footer; `≤900px` a full sheet
      (`inset 0`, `100dvh`). Tokens only; both themes; `tokens`, `states` and
      `type-floor` guards green. Screenshots at 1440 and 390, light and dark,
      top and fold, read back.
- [x] Editors: `TagPicker` gains a controlled props union (`value`-less
      `tags` + `onChange`, `known`, `heading: false`), the saved mode
      unchanged; `assigneeOptions()` extracted to `board/assignee-options.ts`
      and used by `AssignControl`; `RichEditor` gains `mode: 'embedded'` with
      `handle.read()` / `focus()` and `onEscape`, no footer, no caret steal on
      mount; `LazyRichEditor` carries the props union and tolerates no
      `onClose` in its load-failure boundary; `AgentPicker` used as is.
- [x] Tests: `test/browser/create-task-dialog.test.ts` (ways in, gate, Tab
      trap, Escape from the editor and the scrim with the discard question, a
      change of space, phone sheet, both themes, shots),
      `test/browser/create-task-submit.test.ts` (body deep-equal, call order,
      task-list GET after the POST, toast and Open, zod and service 422s with
      focus on the first refused control, partial failure, a link applied via
      Enter and via Apply with no navigation, Create another and Enter on its
      box), `test/browser/create-task-fixtures.ts`;
      unit `test/components/create-task/create-task-form.test.ts`,
      `test/components/typing-in.test.ts`,
      `test/routes/screens/board/assignee-options.test.ts`;
      `list-create-row.test.ts` updated to the dialog; `column-create.test.ts`
      still green.
- [x] Mutation-checked: removing the `typingIn` guard reddens the `c` key
      test; removing the `mayCreate` gate reddens the member test; sending
      `status` beside `status_id` reddens the body-shape unit tests and both
      submit-body assertions; the link popover as a nested `<form>` again
      reddens both link tests. Each restored byte-for-byte.
- [x] Docs (named edits, D-033): `docs/SPEC.md` — a *Creating a task is one
      dialog* bullet in the Board section after *A new task lands at the
      bottom of its lane*, and the §11.4.2.1 **Board** bullet; `docs/DECISIONS.md`
      — D-145 appended. `server/test/tooling/structure.test.ts` — one
      `WEB_NO_MIRROR_REQUIRED` entry for `components/create-task/use-create-task.ts`
      (the `WEB_*` maps are SHELL's, D-026).

## Notes

- Deviation from the plan, stated: the Sprint field is drawn disabled while
  the sprints load rather than hidden, so the layout does not jump when they
  arrive (no *Loading…* label: the loading sweep forbids the swap, CI round
  1). The Escape path needed an `onEscape` the plan did not
  foresee: ProseMirror `preventDefault`s every Escape it is handed
  (`captureKeyDown`), so a form that respects a consumed Escape never sees the
  editor's; the embedded editor reports it instead.
- The plan's RichEditor embedded mode landed; the Markdown-textarea fallback was
  not needed.
- The `created` toast is its own component beside My day's, as the plan and
  D-145 say; unifying them is a later task.
- Gate on Belka, single files only; CI runs the whole gate on the PR.
