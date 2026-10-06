---
id: LAI-494
title: 'The task popup takes the shape of a Jira issue view'
area: web
assignee: chief
priority: p1
depends-on: [LAI-493]
discovered-from: LAI-290
status: done
started: 2026-10-06T08:46:57Z
finished: 2026-10-06T09:07:27Z
---

## Goal

The owner's screenshots of a Jira issue: breadcrumb and plain icon actions in
the header; title, Description, Subtasks, Linked tasks and Activity down the
left; a **Details** card on the right with Assignee, Priority, Parent, Due
date, Labels, Start date, Reporter, then Created/Updated at the foot of the
rail. Everything we already show keeps a place; nothing that is not ours
(attachments, Team, Automation) is drawn.

## Acceptance criteria

- [x] Client `Task` declares `parent_task_id`, `due_on`, `planned_start`,
      `branch`, `external_ref`; `view-type-drift.test.ts` is green with no
      `clientOmits` entry. `TaskEdit` carries the three writable fields,
      `CreateTaskInput` carries `parent_task_id`, `TaskFilter` carries `parent`.
      Every `Task` fixture in `server/web/test/` carries the five fields.
- [x] Header: `↳ PARENT-KEY / KEY` when the task has a parent (the parent key
      opens the parent), the key alone otherwise; right side is an eye with the
      watcher count that toggles watching, a share button that copies the
      link, `⋯` (Copy key, Detach from parent when a child, the existing
      items) and `×`. No status or priority pills in the header.
- [x] Main column, in order: title; collapsible Description; Acceptance when
      set; a Subtasks slot (filled by LAI-495); **Linked tasks** (today's
      Dependencies, retitled, `+ Add linked task`); **Activity** with tabs
      All / Comments / History / Changes and the composer at the top with the
      viewer's avatar. The byline and the tag picker no longer sit here.
- [x] Rail, in order: the status control styled as a coloured button; a line
      "n subtasks still open" under it when the task is `done` with open
      children; a collapsible **Details** card with Assignee, Priority,
      **Parent** (`Add parent` picker of top-level open tasks, `KEY · title`
      with `×` to detach; absent when the task has children), **Due date**
      (date input, `×` clears, red ⚠ chip when overdue and open), **Labels**
      (the tag picker), Sprint, **Start date**, **Reporter** (`created_by`),
      Created via, Watchers, Discovered from (key opens it); a collapsed
      **Development** card with branch, external ref and the Changes count,
      absent when all are empty; and `Created <full date>` / `Updated <full
      date>` at the foot.
- [x] Due and start dates round-trip as UTC-midnight unix-ms through one
      shared date-only helper with its own test; `isOverdue` is false for
      `done`/`cancelled`.
- [x] Browser tests cover: breadcrumb opens the parent; eye count and toggle;
      share copies; due date set and clear PATCH the right bodies; the overdue
      chip only when past and open; parent picker PATCHes; Reporter names
      `created_by`; the rail foot's two dates; Development absent when empty.
- [x] Both themes through the real toggle; the gate exits 0 on all three.

## Notes / context

D-066. `TaskDetailPanel.tsx`, `TaskMeta.tsx`, `task-panel.css`; `BoardScreen`
passes `onOpen={openTaskInUrl}`. Reuse `timeLabel(...).full` for the rail
foot and the sprint screen's date helpers (moved to a shared module and
re-exported). No new dependency. The demo-only "Hand to my agent" block goes
if it is still demo-fed (D-032). Deviation from §2 step 1: claimed against
LAI-493 while that sat accepted-and-held in review, on CHIEF's accept note.

## Built — CHIEF, 2026-10-06

**Landed in two halves on `master`.** The client types and the fixture ripple
went first (so `master` could be green and pushed with LAI-493's server half,
§4.4 step 5); the view itself is this commit. The push carried an in-progress
claim, which is the ordinary state of a task on `master`.

**Measured.** Web `1177 pass, 0 fail` after the one `endpoint-coverage` hit
below; `task-panel` and `list-view` suites `44/44`; lint, format and `tsc`
exit 0. Five mutations against the browser and unit tests, each restored by
name: `isOverdue` ignoring the status, overdue on the due day itself, the
breadcrumb not opening the parent, the due date sent a millisecond off, the
parent picker offering a subtask — **5/5 red**.

**Seen in a real instance** on port `3191` with its own database: a parent
with a past due date and a planned start, two subtasks (one done), a comment.
Light and dark through the real toggle. That pass found two things the
tests had not: the tag picker's own heading under the *Labels* label, and the
*Linked tasks* heading still in the old mono uppercase beside the new
sentence-case ones. Both fixed and re-seen.

**Two guards worth knowing about.** `endpoint-coverage` reads the word
*request* followed by `<` as a client call site — the Development card's
*Pull request* label tripped it, and so did the comment explaining why.
The label is *PR*. And a hidden `tabpanel` still holds its rows: the first
cut kept all four tabs mounted and the thread's comments existed twice for
anything that counted them; only the showing tab is in the DOM now.

**Not done here, by design:** the Subtasks section, the card and list
markers and the `top` filter are LAI-495. The demo-only *Hand to my agent*
button stays under its D-032 flag (it is already absent from a production
build, which `task-panel.test` proves) rather than being deleted from a task
about layout.

## Review — CHIEF, 2026-10-06

Accepted. Read against the diff: the Details rows are in the stated order
and the test asserts them by name; the breadcrumb, eye, dates, parent picker,
reporter, foot and Development card each have a request- or text-level
assertion; `view-type-drift` is green with no `clientOmits`; `sprint-control`'s
source scans still match; the date helpers have one home. The two things the
real-instance pass found are fixed in the same task. Gate on `master` runs
before the push, as always.
