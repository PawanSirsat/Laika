---
id: LAI-281
title: Activity becomes a tab; the board goes plain
area: web
assignee: shell
status: in-progress
priority: p1
depends-on: []
discovered-from: LAI-280
started: 2026-09-18T22:05:00Z
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
