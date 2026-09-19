---
id: LAI-285
title: The task drawer is two columns — the shape LAI-284 missed
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-284
started: 2026-09-19T00:20:00Z
finished: 2026-09-19T01:05:00Z
reviewed: 2026-09-19T10:40:00Z
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

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.

**Verified specifically.** The drawer measures **x=560, width=1120, height=1000**
in a 1680×1000 viewport, with two children inside the slot — `panel-head` and
`panel-columns` — which is the document-plus-rail shape the task describes.
`Escape` closes it and strips `?task=` from the URL, leaving `?project=`.
