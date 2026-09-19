---
id: LAI-281
title: Activity becomes a tab; the board goes plain
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-280
started: 2026-09-18T22:05:00Z
finished: 2026-09-18T22:22:00Z
reviewed: 2026-09-19T10:40:00Z
---

## Why

The owner updated the design (2026-09-18) and sent two screenshots.

**The board's right rail is gone.** The board is plain columns — five lanes with
the whole width, no 252px column beside them.

**Its three panels are a tab of their own**, between Dashboard and Meeting
review: *Live stream* · *Agent sessions* · *Stale · no movement*, three across,
under a header line reading `N events in the last minute · M agent sessions
running · K stale tasks` and a `LIVE · SSE` pill.

It is the better arrangement for a reason the screenshots make obvious: at 252px
the stream was too narrow to read a sentence in, and the board was paying a
fifth of its width for it.

## What

- `routes/screens/activity/{ActivityScreen,ActivityPanels}.tsx` + `activity.css`.
  `ActivityPanels` **is** the old `BoardRail`, moved — the markup did not change,
  only its address and its width, so it keeps its `.rail-*` classes.
- `/activity` in `ROUTES`, in `SPACE_TAB_PATHS` after `/dashboard`, in
  `SCREENS`, and with its own `SCREEN_COPY`.
- `BoardScreen` renders no rail, and **no longer polls presence**: it did so
  every twenty seconds for two readers, and both have left — the strip moved to
  `SpaceLayout` (which reads through `SpaceLive`) and the rail is now this tab.
- The panels are level and equal height, with the design's tinted headers —
  purple for sessions, amber for stale, none for the neutral one.

## Acceptance criteria

- [x] The board renders **no** rail, and its lanes take the full width.
- [x] `Activity` is a tab in the design's position and carries `?project=`.
- [x] Three panels, equal height, with the design's tinted headers.
- [x] The header line's figures are counted from what is on screen.
- [x] Page overflow `0` at 1600 / 1440 / 1280 / 900 / 420.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**I could not read the updated design directly.** `DesignSync` answers *"needs
design-system authorization — run `/design-login`"*, which only the owner can do,
and it reads design-*system* projects rather than this prototype anyway. This was
built from the two screenshots and the local
`docs/design/Laika Prototype.dc.html`, **which is now stale** — it still has the
rail and no Activity tab. Worth re-importing: filed as LAI-282 for CHIEF, since
`docs/` is not SHELL's.

**One thing in the design is not buildable and was not faked.** Its session rows
carry a progress bar, an elapsed time and a tool-call count. Nothing on the wire
has any of them — a heartbeat is `last_seen`, `repo`, `branch`. LAI-440 already
removed one invented percentage bar from this exact card; a bar measuring nothing
is worse than no bar. The rows say `RUNNING`, which is the one thing that is
true: the session beat inside the window.

**Four tests moved rather than being rewritten**, and two were deleted:

- The three agent-session assertions were always about this panel and only
  changed address — they are now `activity-tab.test.ts`, opened at `/activity`.
- *"The Live stream rail travels with the lanes"* and *"the lane strip never
  reaches BoardRail"* are **deleted**. They were real properties of a board with
  a column beside it, and there is no such column; a test kept alive against a
  component that no longer exists is the exemption-that-never-expires shape.
- `board-lane-scroll`'s squeeze test asserted scrolling at `1440px` — true when
  five lanes *plus the rail* had to fit. Without the rail they fit at 1440, so
  the assertion was testing nothing; the widths are now `1180 / 1024`, where the
  board is genuinely crowded.

**And one test caught me being lazy:** I reached for `.strip` as the board's
positive control, and that stub has no sprints — so the chips' absence was the
fixture, not the board. It uses the lanes.

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

**Verified specifically.** `document.querySelector('.board-rail')` is **null** on
the board, and the five lanes measure 277px each at 1680px wide with
`documentElement.scrollWidth === innerWidth` — full width, no horizontal
overflow. The nine view tabs render as `Board · List · Timeline · Calendar ·
Sprints · Capacity · Dashboard · Activity · Meeting review`, with **Activity
between Dashboard and Meeting review** as the task states.
