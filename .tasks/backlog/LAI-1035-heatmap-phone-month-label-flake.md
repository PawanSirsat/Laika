---
id: LAI-1035
title: 'Heatmap phone test: a month label seen under the weekdays mid-scroll on CI'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1031
status: backlog
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

- [ ] The real race named and reproduced (held timers or a delayed frame),
      the old test red and the new one green under the reproduction.
- [ ] No assertion weakened; a mutation shows the "under the weekdays" check
      still catches a label drawn there.
