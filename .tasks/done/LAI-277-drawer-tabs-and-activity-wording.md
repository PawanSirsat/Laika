---
id: LAI-277
title: The task drawer's tabs, and wording for every activity type
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-275
started: 2026-09-18T20:20:00Z
finished: 2026-09-18T20:32:00Z
reviewed: 2026-09-19T10:40:00Z
---

## Why

The drawer, in the owner's page-by-page pass (prototype lines 360–520).

**Comments and activity were stacked**, so reaching a long thread meant
scrolling past the whole activity log and back. The design tabs them.

**And the activity log printed database values at people.** `sprint.tasks_changed`
rendered as itself, in the drawer and on the board's rail.

## What

- The design's tab strip in the drawer: Comments · Activity, with counts, real
  `role="tab"` buttons, and `hidden` panels. Tab state is local, **not** in the
  URL — Back has to close the drawer (LAI-252), and a tab in the address bar
  would make it step through tab switches first.
- `ACTIVITY_LABELS` now covers **all 37** of `ACTIVITY_TYPES`. It covered ten.
- `test/api/activity-labels.test.ts` reads the server's enum and asserts **names
  from both sides**.

## Acceptance criteria

- [x] The drawer tabs Comments and Activity; only one panel is visible.
- [x] Every type in `ACTIVITY_TYPES` has wording; every wording names a real
      type; no wording is the type repeated back.
- [x] `describeEvent` renders wording, and an unknown type still renders rather
      than throwing.
- [x] Verified on the running instance: no dotted enum value in the drawer's
      activity panel.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**Two tabs, not the design's three.** The design's third is *Changes* — commits
and the PR — and Laika has no endpoint that returns them; **LAI-095** is the task
that would build it. A tab that is always empty claims a feature exists, which is
worse than one that is absent.

**This closes LAI-225's substance — CHIEF to dedupe.** LAI-225 is filed as
*"project events render as raw type names"* and is the same defect. It was fixed
here rather than left because it is visible on the screen this task is about, and
because the fix is one map plus its guard.

**The map was wrong in both directions**, which is the shape worth remembering:
`task.claimed` and `comment.updated` had wording and are **not in the enum at
all**, while twenty-seven real types had none. That is why the guard asserts
names rather than a count — `10` against `37` is a number somebody would have
had to notice, and nobody did.

**The fallback stays.** A type added on the server before a line is added here
still renders as itself, which is legible and obviously incomplete; the guard is
what stops that state surviving a gate.

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
