---
id: LAI-954
title: 'Two My Day browser tests fail late in the day: "now at 60%" and the "12 PM" tick read the wall clock'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-953
status: review
started: 2026-10-22T18:22:59+05:30
finished: 2026-10-22T18:37:08+05:30
---

## Goal

Found gating LAI-953 on 2026-10-22 at 17:43 IST (Belka). Both fail
deterministically, on the LAI-953 branch **and** at its claim commit
(`c48dc9e7`, before any LAI-953 change), so they are not LAI-953's — and
they are on `master`'s code (LAI-889 was accepted at `f99d1415`):

```
server/web/test/browser/my-day-v3.test.ts:106
  not ok - the card spans the page above the editor, and today opens with now in view (LAI-889)
  error: 'now at 880 of 882'      (second run: 'now at 885 of 882')

server/web/test/browser/my-day.test.ts:369
  not ok - a 12-hour clock with AM/PM, and minutes and hours in words
  error: 'ticks: 6 AM, 7 AM, 8 AM, 9 AM, 10 AM, 11 AM, 1 PM, 2 PM, 3 PM, 4 PM, 5 PM, 6 PM, 7 PM, 8 PM, 9 PM'
```

Reproduce: `cd server/web && node --test test/browser/my-day-v3.test.ts
test/browser/my-day.test.ts` in the late afternoon local time.

The first asserts *now* sits at 0.6 of the scroller's width; late in the day
the scroller cannot scroll far enough to put it there, so *now* lands at the
right edge. The second expects a `12 PM` axis tick that is absent at this
hour (likely hidden by a label near it, or the visible window). Both read the
real clock, which is the LAI-779 / LAI-794 shape (wall-clock assertions)
again. **This reddens the root gate, and so every deploy, for part of every
day.**

## Acceptance criteria

- [x] Both tests pin the clock (or derive their expectation from it) so they
      pass at any local time of day; demonstrated by running them with the
      clock set to early morning, noon and late evening.
- [x] **Sweep, not patch (CLAUDE.md §5):** a third site fails the same way —
      `my-day-v3.test.ts:102` (*"its header carries the day in minutes, the
      hours run along the top…"*), `hours: … 11 AM, 12 PM, 2 PM …` with `1 PM`
      missing at 18:21 IST on `master`, after LAI-889's `a9932c8e` fixed two
      others. Every My day browser test (and any other browser test that opens
      *today*) runs against a pinned clock, so none depends on the hour; the
      census of which tests were changed and why is in the log, from an
      untruncated search.
- [x] Proof: the whole `test/browser/my-day*.test.ts` set passes with the
      process clock faked to 06:00, 12:00, 18:30 and 23:30 local, and that
      proof is reproducible from a command written in the log.
- [x] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
