---
id: LAI-271
title: 'Calendar, slugs in the rail, and the working-now chip'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-270
started: 2026-09-18T18:11:42+05:30
finished: 2026-09-18T18:11:42+05:30
reviewed: 2026-09-19T10:40:00Z
status: done
---

## Goal

The owner put two crops side by side. Four things left, all theirs to call and
all now done.

1. **Calendar is a tab.** It was deferred three times on the grounds that
   `tasks.due_date` does not exist. D-059 already answered that: the Calendar
   ships **with visible demo data** until the field lands. Deferring was me
   re-deciding a decision that had been made.
2. **The rail names a space by its slug** — `laika-core`, not `Laika Core`.
   Pointed at three times before it was done.
3. **The rail's order is creation order**, which is the reference's
   (`laika-core`, `laika-web`, `laika-infra` — not the alphabet).
4. **The working-now chip** reads `Mira K.` with `laika-core · branch`
   beneath and a status dot, not a full name and an `agent` pill.

## Acceptance criteria

- [x] `Calendar` is a tab and `/calendar` renders a six-week month grid with
      tasks on their due days, a `SAMPLE` notice naming `tasks.due_date`, and
      a demo module that cannot reach a production build (D-032).
- [x] The rail shows slugs, in creation order, and the display name survives
      where there is room: the row's title, the space bar, the popover.
- [x] A chip reads `Mira K.`, a dot for its kind, and `space · branch`; the
      Capacity **row** keeps the full name and the repo, because that is the
      screen for reading exactly where someone is.
- [x] The strip carries `N agent sessions live · N people active`.
- [x] The sprint pager is always drawn and disabled when it cannot scroll.
- [x] Full gate — all three `EXIT 0`, repo root.

## Completion notes

**The chip change was too broad and the suite caught it.** Shortening the name
and rewriting the subtext hit `PresencePerson` wholesale, which the Capacity
screen also uses — 17 tests went red. Scoped to `variant === 'chip'`: a chip is
a glance, a row is where you go to read exactly who is on which branch.

**And it printed raw ids for a while.** `project_ids` and `matched_task_id` are
ULIDs, not a slug and a key, so the first subtext rendered `p1 · t1` — which in
production would have been two ULIDs. Presence has no name to give, so the
strip passes the space's own slug down and the branch is the work.

**A fixture was hiding the ordering.** `spaces-sidebar`'s projects used
`id: slug`, so sorting by id sorted alphabetically and the reference's creation
order looked identical to it. Ids are ULIDs; the fixture says so now.

**`placeholder` is a banned word in screen copy** (LAI-019 AC4) and the
Calendar's first draft used it. The copy says "sample data" and the screen
carries the `SAMPLE` notice, which is the mechanism D-032 actually asks for.

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
