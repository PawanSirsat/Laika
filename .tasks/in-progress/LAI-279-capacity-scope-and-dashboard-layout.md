---
id: LAI-279
title: Capacity keeps its space; the Dashboard takes the design's layout
area: web
assignee: shell
status: in-progress
priority: p1
depends-on: []
discovered-from: LAI-275
started: 2026-09-18T21:05:00Z
---

## Why

Two owner reports against the reference.

**1. Capacity looked like a different application.** Clicking the tab left the
space bar reading **"No space"** over a screen still showing that space's tabs,
and the sidebar's selection cleared.

The cause was deliberate and wrong. LAI-251 marked `/capacity` `orgLevel` so its
tab would drop `?project=` — reasoning that a tab under `laika-core` must not
claim to be about `laika-core`. The honesty was right; the mechanism was not. A
missing query parameter is not a scope statement, it is a screen that looks
broken, and it also lost the space you came from.

The design settles it (prototype line 651): Capacity is drawn **inside** the
space, and its summary bar says the scope in words — *"across 3 spaces · live"*.

**2. The Dashboard was a single column.** The design puts four panels across the
top — release progress, throughput, who is carrying what, what needs a decision
— then the activity feed beside a rail carrying *Stale* and *Agent log*. Ours ran
every panel full width, so the four figures a reader comes here for could never
be seen together, which is the whole point of a dashboard.

## What

- `/capacity` is no longer `orgLevel`; its tab carries `?project=` like every
  other. The summary bar reads `across N spaces · live`, counted from
  `GET /projects` — `undefined` until it lands, so the bar never says
  "across 0 spaces".
- The Dashboard's `dash-row` (4 across) and `dash-body` (feed + 252px rail).
- New rail panels: **Stale · 5+ days quiet** (same threshold and same
  `updated_at` as the board's rail and the List's amber — one definition of
  stale for the product) and **Agent log**, both counted from data already
  loaded rather than a second request.
- The design's **All · People · Agents** filter on the feed.

## Acceptance criteria

- [x] The Capacity tab carries `?project=`; the space bar names the space.
- [x] Its summary bar states the scope in words.
- [x] Four panels across the top; the feed sits beside a rail.
- [x] Page overflow `0` at 1600 / 1440 / 1280 / 900 / 420.
- [x] The filter's counts reconcile: `All === People + Agents`.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**Three defects this turned up, all mine, all caught by measuring:**

1. **`All 145` sat next to `People 155`** — a filter claiming to show more than
   everything. The tallies came from `kinds`, which counts every event in the
   range including verbs the feed declines (`FEED_SILENT`); the buttons filter
   the *visible* list. A button's count must describe the list that button
   produces. The panel's own "N events · M by agents" is a different claim —
   about what happened, not what is listed — and deliberately keeps the range.
2. **`dash-feed` was already taken.** It is the layout class on the `<ul>` of
   events (`display: grid; padding: 0`); putting it on the section stripped the
   panel's card and padding. A class name that reads right and is already in use
   is the easiest kind of collision to miss.
3. **Grid items do not shrink by default.** `min-width: auto` floored the feed
   column at its content and pushed the page 41px at 420px — and the blocked
   rows, fine at full width, hung 43px out of a quarter-width cell at 1600px.

**The tab strip was innocent.** The first overflow probe blamed `.view-tab`
elements; they sit inside a container that scrolls correctly, and a bounding box
extending past the viewport inside a scroll container is normal. The probe now
asks which element's `scrollWidth` exceeds its own `clientWidth` while
`overflow-x` is `visible`, which is the question that actually identifies a
culprit.

**`Stale` shows nothing on the demo instance and that is correct** — every
seeded task has moved in the last five days.
