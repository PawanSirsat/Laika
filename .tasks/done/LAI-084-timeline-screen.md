---
id: LAI-084
title: Timeline — one bar per sprint on a single track
area: web
assignee: builder-a
priority: p2
depends-on: [LAI-083]
discovered-from:
finished: 2026-08-24T19:57:19Z
reviewed: 2026-08-25T16:00:00+05:30
started: 2026-08-24T19:45:49Z
status: done
---

## Goal

D-014's timeline. **Sprints cannot overlap (§4.15), which is exactly why this is
a rendering pass and not a layout solver** — that non-overlap rule was built for
this screen.

**Yours under D-028** — only `server/web/src/routes/screens/timeline/`.

## Acceptance criteria

- [x] A horizontal date axis with **one bar per sprint**, positioned by
      `starts_on`/`ends_on`, drawn from the sprints endpoint.
- [x] Each bar shows the sprint name, its progress, and its status.
- [x] **Tasks never get their own dates** (D-014). A task appears inside its
      sprint's bar or in an unscheduled tray, never on the axis.
- [x] Today is marked.
- [x] An empty project renders the empty state, not a bare axis.
- [x] Both themes.

## Not in scope

Dragging a sprint edge to reschedule. It needs `PATCH /sprints/:id` wired to drag
maths and overlap rejection — worth its own task once the read view is right.

`docs/design/screenshots/` has two timeline PNGs that were **not** imported;
`docs/design/README.md` notes them. Look at them in the design project before
starting rather than inventing the layout.


---

## Builder-A notes (2026-08-25)

### The design's timeline is one of the artifacts, and I did not reproduce it

The prototype draws **a row per task with its own start and length** (`tlSpans`,
e.g. `'LAI-142': [30, 8, '12 – 19 Aug']`). Those dates are invented: `tasks` has
no planned-start and no due-date column, and D-014 keeps it that way on purpose
— *"draw it from sprint boundaries and it costs a view; draw it from task dates
and it costs a scheduling engine."* So the task rows are the same class of thing
as `postgres 16` on the first-boot screen, and `docs/design/README.md` says not
to copy them.

Tasks here appear **inside** a sprint when its bar is expanded, or in the
unscheduled tray, and nowhere on the axis. **A test enforces it**: it reads every
file in the folder and fails on `due_date`, `planned_start`, `taskSpan` or any
expression deriving an axis position from a task — and separately fails if
`api/tasks.ts` ever declares a date field a bar could use. A comment saying
"don't do this" is what the next session overrides; a failing test is not.

The two timeline PNGs the task points at are **not in the repo** —
`docs/design/README.md` records them as not imported, and I have no access to the
design project. I built to §11.4.3's prose instead, which is specific enough
(one track, bars are sprints, tasks are contents, today marked, past dimmed).

### Two decisions worth disagreeing with

- **The axis is not stretched to reach today.** It spans the earliest sprint
  start to the latest sprint end. A project whose next sprint is in March would
  otherwise get an axis mostly made of empty January, squashing every bar to a
  sliver to accommodate a marker. When today falls outside, the screen says which
  side instead — verified live: *"Today is after every sprint on this timeline."*
- **It reuses the sprints screen's data path** (`useSprints`, `sprint-derive`).
  Both folders are mine under D-028, and the alternative was a second copy of the
  cursor-walking and a second definition of "done over total" — the drift LAI-119
  is about, one layer up. The mutations go unused; this screen is read-only.

### Verified in a browser, both themes, real data

Three sprints straddling today with a real gap between them, eight tasks, one
unscheduled. Month bands `JUL 2026` / `AUG 2026` / `SEPT 2026` weighted by the
days actually on the axis; bars `2/2`, `1/3`, `0/2` from real task statuses; the
past sprint dimmed rather than hidden; today's rule inside the active bar.
Expanding it listed `LAI-4`, `LAI-5`, `LAI-3` with `done` in green. A project
with no sprints rendered **"Nothing scheduled yet"**, not a bare axis.

**On the browser lock:** I stopped using the shared MCP profile and drove my own
headless Chromium over CDP with a small script (Node 22 has a global
`WebSocket`, so it needs no dependency and no install). It sets the session
cookie via `Network.setCookie`, clicks the real theme radio, and reports the
rendered `innerText` alongside the screenshot — so a screenshot is never the only
evidence. No handoff with Builder-B needed. Happy to contribute it as repo
tooling if that is wanted; it is not in the ACs so it stayed in my scratchpad.

### Two probes that did not bite, and what they found

- The **trailing gap** in `toSegments` is unreachable for the range
  `timelineRange` produces, because that range ends at the last sprint. Rather
  than delete it I kept the function total over *any* range — it takes one as an
  argument — and added a test that passes a wider window. Dead code became tested
  code and the contract got written down.
- My **"same month in different years"** test used Dec→Jan, which are different
  months anyway, so a month-only key still passed. Replaced with a 14-month axis
  containing two Augusts, asserting **every band key is unique**. Duplicate React
  keys are a reconciliation bug rather than a layout one, which is exactly the
  kind a screenshot review cannot catch.

12 probes total; all 12 fail when broken. 814 server + 288 web tests pass.

### Not done, per Not in scope

Dragging a sprint edge to reschedule. The unscheduled tray is read-only for the
same reason — dragging into a sprint is the Sprints screen's "Add tasks", and
duplicating it here without the drag maths would be a worse copy.

## Review — PM, 2026-08-25

**Accepted.** Rendered with real sprints and tasks: month axis, one bar per
sprint with its progress, `Today` marker, active/planned status, and an
Unscheduled tray. The screen states its own constraint —
*"Tasks have no dates of their own — open a sprint to see what is in it"* — which
turns D-014 from a rule someone has to know into something the screen explains.

**The test that fails on `due_date` / `planned_start` / `taskSpan`, or on any axis
position derived from a task, is the right place to spend a test.** You said the
pressure to add task dates will come from someone reasonable asking for a nicer
Gantt, and that is exactly right — it already came, from Builder-B, who had
proposed positioning bars from `started_at`/`completed_at`. **Your catch stopped
it**: those are actuals, not a plan, and drawing them would render the past as
though it were a schedule. That exchange is the guard working before the code
existed.

**Not stretching the axis to reach today is a good call** — a project whose next
sprint is in March would otherwise be mostly empty January with every bar a
sliver, for one marker. Saying which side today falls on is better than moving
the axis to accommodate it.
