---
id: LAI-272
title: The sprint strip above WORKING NOW, and the column header the reference has
area: web
assignee: shell
status: in-progress
priority: p1
depends-on: []
discovered-from: LAI-271
started: 2026-09-18T18:05:00Z
---

## Why

Four owner reports against the reference, all on the board's top third.

1. **The sprint strip sat below WORKING NOW.** The reference orders the space
   as **tabs → sprints → working now → the view**. Ours had the presence band
   first, because the sprint strip belongs to the *board* and the presence
   strip belongs to the *space layout* — a screen rendering into the layout can
   only appear after it.
2. **The column header splayed across the tub.** The reference groups
   `● BACKLOG 3` on the left and pushes only the WIP note right; ours put the
   dot left, the name in the middle and the count hard against the right edge.
3. **No air above the tubs.** The reference leaves the design's `14px`
   between the WORKING NOW border and the first column; ours had none, so the
   band and the tubs touched. The owner's words: *"see the gap on top"*.
4. **The presence chip's second line was cut off.** The reference reads
   `laika-core · LAI-142`; ours read `lai-251…` — the raw branch, lower-cased,
   then clipped mid-word.

## What

- A `SpaceBand` portal (`BAND_SLOT_ID`), rendered by `SpaceLayout` between the
  view tabs and `PresenceStrip`, so a screen can contribute a band *above*
  presence. `BoardScreen` wraps `SprintStrip` in it.
- The pre-rebuild `.lane-head` / `.lane-title` / `.lane-count` block is
  **deleted**. It carried `justify-content: space-between` and the rebuilt rule
  below it overrode neither that nor its padding — two rules for one element is
  what hid the defect. The survivor takes the design's `0 4px` padding, `.07em`
  tracking, and the count's 5px-radius badge.
- `.board-main` gains the design's `14px` top and `18px` bottom padding; the
  lane's fixed height widens from `100dvh - 19rem` to `21rem` to pay for it.
- `.presence` drops to the design's 48px band.
- `taskKey()` turns `lai-251-space-bar` into `LAI-251`; a branch with no key in
  it is left exactly as it is rather than guessed at. `.pp-chip .pp-where`
  stops clipping — the chip is `flex: none` and sizes to its own line, as the
  design's does.

## Acceptance criteria

- [x] The sprint strip renders **above** WORKING NOW, asserted by position
      (`tabs < sprints < presence < lanes`) — the only check that can tell the
      two arrangements apart, since both render all four bands.
- [x] The column header's dot, name and count sit as one group on the left,
      with the column's slack to the **right** of the count. Asserted as slack,
      not as a fraction of the width: a narrow column can be more than half
      full of a correctly grouped header.
- [x] There is at least 12px between the band above and the first tub.
- [x] A presence chip's second line renders the **key**, upper-cased, and is
      never clipped (`scrollWidth <= clientWidth`).
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit `0`.
- [x] Verified on a running instance at 1900px, not only in the harness.

## Notes

**The claim commit is late, and this file did not exist while the work was
done.** The reports arrived mid-session against a running instance and were
fixed live; the file is written at submission. Recording it rather than
back-dating `started:` — same as LAI-251.

**The header test was mutation-checked.** Putting `justify-content:
space-between` back turned it red (`# fail 1`) and the revert was by name. The
`.lane-head` duplicate is exactly the shape a comment can hide: the rebuilt
rule *looks* complete, and reads as authoritative until you ask the browser
what `justifyContent` actually resolved to.

**Two stub defects found while adding the tests**, both of the
"green while proving nothing" family:

- `sprint-strip.test.ts` had `presence_enabled: false`, so WORKING NOW rendered
  nothing at all — a band-order assertion could never have run there.
- Its figures test read `.strip-stats` the moment the element appeared, which is
  before the tasks land. It read `DONE 0/0` once presence changed the timing.
  It now waits for the **data**, not the element.
