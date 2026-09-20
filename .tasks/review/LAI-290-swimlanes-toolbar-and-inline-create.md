---
id: LAI-290
title: 'Swimlanes, the board toolbar, and a create that lands in the column you clicked'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-266
status: review
started: 2026-09-19T11:45:47Z
finished: 2026-09-19T13:07:55Z
---

## Goal

LAI-266 made columns configurable; the owner's Jira screenshots show the board's
*shape* is still wrong in five ways. **Web only — no schema, so this does not
wait on LAI-289.**

### 1. Grouping replaces the columns. It should nest them.

`group-lanes.ts` returns one synthetic lane per assignee, so the status columns
**vanish** when grouped. Jira keeps the whole column board and repeats it inside
a collapsible **swimlane** per group — `Pawan Sirsat (14)` expands to
Backlog · To Do · In Progress · Testing.

This is the biggest correction and the reason the task exists.

### 2. View settings is the wrong shape

Radio groups today. Jira's is **Show fields**: a search over available fields,
then **Selected fields** — one row each, icon + name + `×`.

### 3. There is no toolbar

Jira has Search · member avatars **as filters** · **Filter** · **Group** on the
left, and four icons on the right. Ours has no Filter or Group button, and the
avatars are decoration — `SpaceTopBar.tsx:120` renders them as `<span>` with
`aria-hidden="true"`.

### 4. `+` creates in the wrong column — a live bug

`KanbanView.tsx:31` types it `readonly onAdd?: (() => void)` — **no arguments**
— and `BoardScreen` handles it as `setCreating(true)`, opening one banner above
the board that posts no status. **So clicking `+` on *Done* creates a task in
`backlog`.** Independent of any layout question.

### 5. The add-column control is too loud

A full-height dashed lane; Jira's is a small square `+` tile.

## What is wanted

**Swimlanes.** `group-lanes.ts` returns rows, not columns:

```ts
interface Swimlane {
  readonly key: string;          // '' for Unassigned / No sprint
  readonly name: string;
  readonly avatarId?: string;
  readonly count: number;
  readonly lanes: readonly Lane[];   // groupByColumn(itsTasks, columns)
}
```

`KanbanView` splits — today's `.kanban` row becomes `<LaneRow>`, and the view
renders one `LaneRow` ungrouped or N swimlanes each with a header and its own
`LaneRow`. **The project's real columns in every row**; only the tasks differ.
Collapsed keys persist per project in the existing `laika.board-view` key.

**Toolbar.** Filter and Group as named buttons; the avatar cluster becomes
buttons toggling `?assignee=`, which the board already reads. Reuse `cluster()`
(`top-bar-derive.ts:28`) and `avatarColor()` — only the element and a handler
change. Right-hand icons via the `SpaceBarSlot` portal LAI-266 added: insights
over `getMetrics()`, sliders for View settings, refresh, and `⋯`.

**Inline create.** `onAdd` becomes `onAdd(status)` and the composer opens *in
that column*, creating into its `primary_status`.

## Acceptance criteria

- [x] Grouping renders **n groups × the same columns**, not n columns. A test
      asserts the column count inside a swimlane equals the project's column
      count — the assertion today's code fails.
- [x] A swimlane collapses and stays collapsed across a reload.
- [x] Ungrouped, the board renders exactly one lane row and no swimlane chrome.
- [x] Clicking a member avatar writes `?assignee=` and clicking it again clears
      it; the avatars are `<button>`, not `aria-hidden` spans.
- [x] **`+ Create` in the Done column creates a task whose status is `done`.**
      This is the bug above, asserted directly.
- [x] View settings is a searchable field list with `×` per row; the four
      non-removable fields show a disabled `×` with the reason.
- [x] All four right-hand icons do something real — none is decoration.
- [x] The add-column control is a square tile aligned with the lane headers and
      **still does not carry `.lane`** (`board-lane-scroll.test.ts` counts it).
- [x] Both themes, 1600/1440/1280/900/420, page overflow `0` at each.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Known red, and what turns it green

Per CLAUDE.md §4.4 step 1, named here rather than discovered at review.

```
server/web/test/browser/sprint-strip.test.ts
  "there is no second filter row — the filters are in the bar"
    assert.ok(!(await slot.isVisible()),
      'the second row is back — the slot should be empty with no filter active')
```

That guard came from **LAI-270**, which deleted a filter band because *"the
design has no such row."* The Jira reference has one, and the owner has made
Jira the reference for the board. The file is `server/web/test/`, which is
SHELL's, so **this task retires it** — rewritten to assert what is still true
(the filters are reachable and not duplicated), not merely deleted.

**`SPEC.md:1460` still says swimlanes are not in v1.** That is `docs/`, so it is
**LAI-289**, filed. This task does not wait for it — nothing here is schema —
but the two should be reviewed together.

## Notes / context

**The reference changed, and that is the owner's call.** `docs/design/` has no
swimlanes, no Filter or Group button, no icon cluster and no add-column
affordance; its own meeting-review fixture kills swimlanes by name (`LAI-097`,
*"Kill it. It costs us a render path and we've never used it."*). The owner was
shown this and chose Jira. **LAI-282** (re-import the prototype) should be
reprioritised so the repo stops disagreeing with itself.

**LAI-288 is amended, not closed** — dragging *between swimlanes* stays out
(it means reassign, which is a different endpoint and has no keyboard story),
but dragging between columns inside a swimlane works and still means status. Its
on-screen notice narrows accordingly.

**LAI-255 is stale** and should be closed at review: it claims *"Add task"* is
one of four right-rail panels, and the refreshed prototype has it inside the
column at `:308`, with the rail holding only the live stream, agent sessions and
stale.

**Planned follow-ups, filed as each starts** so their shape can absorb what this
one teaches: `work_type` + `flagged_at`; `due_on` + `planned_start` (needs
LAI-289); parent and subtasks; the timeline as a scheduling view.
