---
id: LAI-285
title: The task drawer is two columns — the shape LAI-284 missed
area: web
assignee: shell
status: in-progress
priority: p1
depends-on: []
discovered-from: LAI-284
started: 2026-09-19T00:20:00Z
---

## Why

The owner sent the reference back with *"not 10% matched"*, and they were right.

LAI-284 built every section the design asks for — inline editing, dependencies,
watchers, provenance, tabs, the two actions — and **stacked them in one column**.
The reference is two: the task as a document on the left, and a 288px rail of
*fields* on the right. Right contents, wrong shape, which is not a near miss —
in one column a reader scrolls past the task's own metadata to reach its
description, and the actions sit below a comment thread instead of staying in
view beside it.

I had both screenshots the whole time and did not compare against them.

## What

- `panel-columns` → `panel-main` (the document) + `panel-side` (the rail).
  The drawer widens from **840 to 1120**; at 840 the two together left the
  description narrower than the board card the reader came from.
- `routes/screens/task/TaskMeta.tsx` — the rail: assignee (with the claim line),
  status, priority, space, created via, watchers. Each row is a label, a value
  and a **quiet second line** — `claimed 4m ago`, `scope full`.
- The header becomes a status bar: `LC-6` · state pill · priority dot, then
  `+ Move` · `Watch` · `⋯` · `×`. The title moves into the column, where it can
  be long without pushing the actions off the row.
- The left column, in the design's order: title, byline (`created via agent ·
  mira-cli`, tags, opened/updated), description, **Acceptance** in a quoted
  block, the discovered-from callout, dependencies, tabs, thread.
- `acceptance_md` is rendered for the first time — a real column nothing has
  ever shown.
- Dependencies label each chip with the **relation** (`BLOCKED BY` / `BLOCKS`)
  and put the blocker's own state on the right; `+ Link task` moves to the
  section heading.
- Comments lose their per-comment boxes — four cards read as four notices
  rather than a conversation. The composer becomes one control: field, then the
  marks and Send along its foot.
- `WatchersSection.tsx` is deleted; the rail is its home now.

## Acceptance criteria

- [x] Two columns: a document and a 288px rail, at 1120px.
- [x] The header carries key, state and priority, and Move / Watch / ⋯ / ×.
- [x] The rail's six fields render, each with its second line where there is one.
- [x] Acceptance renders when the task has one.
- [x] Dependencies show the relation and the blocker's state.
- [x] The send button sits inside the composer.
- [x] Full gate — all three `EXIT 0`, repo root, on a **plain** build.

## Notes

**What I should have done and did not:** open both screenshots and walk them
element by element before writing a line. LAI-284's tests all passed, and every
one of them asserted *presence* — does the section exist, does the request go
out — and none asserted *arrangement*. A suite that cannot see layout will
happily certify the wrong layout.

**`tasks.branch` is a real column the API does not expose.** The design writes
`branch lai-142-claim-lock` under the space. `TaskView` has no `branch` field,
so the browser cannot read it and the line is absent rather than invented.
Filed as **LAI-286** for CORE.

**A flaky test, found and fixed rather than re-run.** `task-drawer`'s scroll
test failed once with `{close: 0, head: 0}` and passed unchanged on the next
run. The drawer's shell is rendered by `SpaceLayout` the moment `?task=` is set,
while its contents are portalled in by `BoardScreen` once the task resolves — so
`.drawer` can exist with nothing in it for a frame, and the test was asserting
after a fixed sleep. It waits for `.panel-head` now. Its fixture was also
missing `/watchers` and `/mentionable`, which the panel began calling in
LAI-284.
