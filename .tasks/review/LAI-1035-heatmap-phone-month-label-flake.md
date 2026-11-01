---
id: LAI-1035
title: 'Heatmap phone test: a month label seen under the weekdays mid-scroll on CI'
area: web
assignee: shell
priority: p3
depends-on: []
started: 2026-11-01T17:16:00Z
finished: 2026-11-01T17:29:05Z
discovered-from: LAI-1031
status: review
---

Board: LAIKA-891.

CI run 41324558399 (PR #185, web shard 3/4):
`server/web/test/browser/activity-heatmap.test.ts` › *on a phone* › *opens on
12 weeks; a year scrolls inside the card, months never under the weekdays* —
the real-clock case, not the pinned 1 Nov one — failed:

```
at 222px: month labels under the weekdays
+ [ 'Feb' ]
- []
```

On that branch the test file and `server/web/src` are identical to `master`.
The same file passed 21/21 on Belka, in local time and with `TZ=UTC`, and none
of the five red runs before it carried this failure (they were LAI-1021's
focus flake). A likely shape: the two-`requestAnimationFrame` wait after each
`scrollLeft` step is not always enough for the push-out hide on a loaded
runner — unconfirmed.

## Acceptance criteria

- [x] The real race named and reproduced (held timers or a delayed frame),
      the old test red and the new one green under the reproduction.
- [x] No assertion weakened; a mutation shows the "under the weekdays" check
      still catches a label drawn there.

## Builder notes (SHELL, 2026-11-01)

**The race.** Both phone cases install `page.clock` (`setFixedTime`). Under it
`requestAnimationFrame` is a timer: Playwright 1.62.1's clock answers it with
`clock.addTimer({ type: "AnimationFrame", delay: clock.getTimeToNextFrame() })`.
So the two-rAF wait after each `scrollLeft` step was about 32 ms of wall time,
not two frames. Chromium fires the `.hm-scroll` scroll event at its next real
frame, and the card's push-out hide (`data-under`) runs from that event. When
the frame came late, the test read the labels as the previous position left
them. That one cause gives all three CI symptoms: `under the weekdays` at
222px ['Feb'] and at 296px ['Mar'], and `no month is named` at 0px, the first
step after the jump from the newest week.

**Reproduced.** A third case, `…, with the scroll event a frame late`, holds
every `.hm-scroll` scroll event 100 ms for every listener (`HOLD_SCROLL_EVENTS`).
On the old wait it fails `at 0px: no month is named`; on the new wait it passes.

**Fix (test only; the card is right).** Each step registers a `scroll`
listener, sets `scrollLeft`, and resolves two frames after its own event. The
card's listener is older, so its settle is booked first. A step that moves
nothing fires no event and waits only for the frames. No assertion changed.

**Mutations, against the fixed test** (`--test-name-pattern="on a phone"`):
- LAI-1017's bug back (closing-month `starts.pop()` removed): all 5 phone
  tests red: `scrolled to the newest week: a heading runs out of view`, and
  `twelve weeks scroll sideways by 1px`.
- The hide off (`data-under` never set): the 3 year cases red,
  `at 37px: month labels under the weekdays ['Nov']`.

**10x**, `node --test --test-concurrency=1 test/browser/activity-heatmap.test.ts`
from `server/web`: 10/10 exit 0, 22 test cases each, load 6.8 to 8.8.
