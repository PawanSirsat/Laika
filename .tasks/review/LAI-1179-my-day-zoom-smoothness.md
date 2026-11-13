---
id: LAI-1179
title: 'My day: the View zoom plays as the design does — on the click, one layer per view, Day a layer too'
area: web+server
assignee: chief
priority: p1
depends-on: [LAI-1174]
status: review
started: 2026-11-13T12:10:00Z
finished: 2026-11-13T15:30:00Z
---

## Goal

LAI-1174 built the View (Day · Week · Month · Year) and its zoom, and the
owner found it did not feel like the design (*My Day Calendar Zoom*). Measured
on `origin/master`: the zoom waited for the period's read before it began
(Week is seven day reads, Year four stretches, each 0.6 s away from here), the
view being left was unmounted and rebuilt as the leaving layer, the arriving
layer was never on top, the stage's height collapsed to a loading card and
jumped back, the 520 ms carried React work from the Day read and the clock,
Day was a hard cut both ways, quick switches raced, ‹ › never slid out, and
nothing was read ahead.

Two halves. **Web (SHELL's area, built by a dispatched builder)**: the stage
reworked to the design's choreography. **Server (CHIEF)**: `time-days.ts`'s
read made cheap enough that a year is one round trip's work, so the cache
and the prefetch have something fast to fill from.

## Acceptance criteria — web half

- [x] A change of view mounts the arriving layer **on the click**, at its
      final shape — the period's content if cached, else the same grid from
      the calendar alone (Week's seven dated heads, Month's rows of numbered
      cells, Year's twelve months of numbered days) carrying its `data-zk`
      tags and a shimmer where figures go — and the zoom starts in that
      commit's layout effect. No `ready()` gate, no loading card, no height
      change. Data lands inside the same layer element.
- [x] Layers are keyed by **period only**; the view being left is the same
      element with its role changed, never rebuilt.
- [x] While a zoom runs the stage holds `min-height` at the taller layer,
      both layers positioned over each other, each opaque in the canvas
      colour; the stage lets go at `finish`.
- [x] Z-order as the design: zoom in → arriving layer on top; zoom out →
      leaving layer on top. The leaving layer keeps `pointer-events: none`.
- [x] No React work of the stage's own during the 520 ms: busy is a ref and
      a `data-zooming` attribute; `LayerBody`, `WeekView`, `MonthView` and
      `YearView` are memoised with their derives; `onOpen`/`goSpan`/`open`
      and the wheel listener are stable; the Day read's `setLoad` and the
      60 s clock do not reach the wide layers (the Week keeps its own minute
      through `useSyncExternalStore`).
- [x] Day is a zoom target both ways: wide → Day (switch, `D`, `+`, Esc
      chain, a cell) zooms in from the `d:` cell onto the Day layer, which
      shows the Day's skeleton until its read lands and then the page itself,
      in place; Day → wide keeps the Day page as the leaving layer for the
      zoom out. `MyDayScreen` guards `view.day === selectedDay`, so the day
      before never shows under a new address; the Day read starts on the
      click because the address changes on the click.
- [x] Rapid input: while a movement runs only the **latest** request is
      kept and played at `finish`; a movement clears only the leaving layer
      it created (`seq` token). The switch's thumb and the header update at
      once (unchanged).
- [x] ‹ ›: `slideOut` 130 ms on the key, the next period mounted at its
      shape (placeholder if not cached), `slideIn` 300 ms — never a loading
      card.
- [x] The period cache is a module (`span-cache.ts`), keyed by subject and
      `week:<monday>` / `month:<YYYY-MM>` / `year:<YYYY>`, emptied by
      `reload()` (every time mutation on Day goes through it); a week's
      seven reads run three at a time in the foreground. After the Day read
      settles its week, month and year are read ahead one at a time in idle
      moments at background limits (year's stretches one at a time); after a
      switch to a wide view, the periods either side the same way
      (`span-prefetch.ts`).
- [x] Tests, `browser/my-day-span.test.ts` (16 pass): held Year → Month
      animates both layers within two frames with the month unread, holds
      the stage's height, fills the same element (`isSameNode`), and keeps
      frames coming (≥ 24 in 700 ms, no gap > 50 ms); the leaving layer is
      the element that was current; z-order in and out; W→M→Y lands on Year
      with one layer and no page error; Day → Week leaves the Day page
      animating and Week → Day by a cell and by `D` zooms in and shows that
      day; ‹ slides out on the key with no loading card; the reads ahead
      happen and a later switch asks for nothing of its own; the existing
      reduced-motion check still sees nothing move. Unit:
      `span-motion.test.ts` asserts `ZOOM_MS === 520` and the easing;
      `span-cache.test.ts` and `span-prefetch.test.ts` cover the cache and
      the planner. The harness answers a route function's promise, so a test
      can hold a read.
- [x] `server/web/vite.config.ts` honours `LAIKA_API_ORIGIN`, rewriting
      `Origin`/`Referer` for a non-loopback origin; `server/web/README.md`
      says how. Verified: `/api/v1/health` through the local dev server
      answers from production.
- [x] Mutation checks run and recorded in the log: the placeholder removed
      (gate restored) → the held-read test red; role back in the layer key →
      the same-element test red; the busy queue removed → the rapid-switch
      test red. The `seq` token alone removed leaves the suite green,
      because the queue already closes the race the token guards — recorded
      as such, not claimed otherwise.

## Server half (CHIEF)

- [x] `server/src/services/time-days.ts` reads a stretch in **two range queries**
      (`entriesBetween`, `draftsBetween` — the range twins of `entriesOn`/
      `draftsOn`) and buckets by day, where it read two queries a day. Measured
      on a copy of the pre-cutover production database (Pawan's 536 entries,
      Belka): a month 10.5 → 1.6 ms, a 92-day stretch 38.6 → 4.5 ms, a year's
      four chunks 108.7 → 6.4 ms. Output unchanged.
- [x] Its test: `test/services/time-days.test.ts` pins two statements for three
      days and for ninety-two, the day before `from` and after `to` out, a
      deleted entry and a dismissed draft counting for nothing; the existing
      four cases and `test/http/routes/time-days.test.ts` (8) hold. Mutation:
      `isNull(deletedAt)` dropped → red.
- [x] SPEC: no change — the `GET /me/time/days` contract (§6.4) is the same; how
      the server reads it is not a contract line.
