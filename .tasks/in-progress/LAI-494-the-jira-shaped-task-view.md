---
id: LAI-494
title: 'The task popup takes the shape of a Jira issue view'
area: web
assignee: chief
priority: p1
depends-on: [LAI-493]
discovered-from: LAI-290
status: in-progress
started: 2026-10-06T08:46:57Z
---

## Goal

The owner's screenshots of a Jira issue: breadcrumb and plain icon actions in
the header; title, Description, Subtasks, Linked tasks and Activity down the
left; a **Details** card on the right with Assignee, Priority, Parent, Due
date, Labels, Start date, Reporter, then Created/Updated at the foot of the
rail. Everything we already show keeps a place; nothing that is not ours
(attachments, Team, Automation) is drawn.

## Acceptance criteria

- [ ] Client `Task` declares `parent_task_id`, `due_on`, `planned_start`,
      `branch`, `external_ref`; `view-type-drift.test.ts` is green with no
      `clientOmits` entry. `TaskEdit` carries the three writable fields,
      `CreateTaskInput` carries `parent_task_id`, `TaskFilter` carries `parent`.
      Every `Task` fixture in `server/web/test/` carries the five fields.
- [ ] Header: `↳ PARENT-KEY / KEY` when the task has a parent (the parent key
      opens the parent), the key alone otherwise; right side is an eye with the
      watcher count that toggles watching, a share button that copies the
      link, `⋯` (Copy key, Detach from parent when a child, the existing
      items) and `×`. No status or priority pills in the header.
- [ ] Main column, in order: title; collapsible Description; Acceptance when
      set; a Subtasks slot (filled by LAI-495); **Linked tasks** (today's
      Dependencies, retitled, `+ Add linked task`); **Activity** with tabs
      All / Comments / History / Changes and the composer at the top with the
      viewer's avatar. The byline and the tag picker no longer sit here.
- [ ] Rail, in order: the status control styled as a coloured button; a line
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
- [ ] Due and start dates round-trip as UTC-midnight unix-ms through one
      shared date-only helper with its own test; `isOverdue` is false for
      `done`/`cancelled`.
- [ ] Browser tests cover: breadcrumb opens the parent; eye count and toggle;
      share copies; due date set and clear PATCH the right bodies; the overdue
      chip only when past and open; parent picker PATCHes; Reporter names
      `created_by`; the rail foot's two dates; Development absent when empty.
- [ ] Both themes through the real toggle; the gate exits 0 on all three.

## Notes / context

D-066. `TaskDetailPanel.tsx`, `TaskMeta.tsx`, `task-panel.css`; `BoardScreen`
passes `onOpen={openTaskInUrl}`. Reuse `timeLabel(...).full` for the rail
foot and the sprint screen's date helpers (moved to a shared module and
re-exported). No new dependency. The demo-only "Hand to my agent" block goes
if it is still demo-fed (D-032). Deviation from §2 step 1: claimed against
LAI-493 while that sat accepted-and-held in review, on CHIEF's accept note.
