---
id: LAI-251
title: 'SpaceLayout: the top bar, the full tab strip, the LIVE pill, presence, one SSE'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-249, LAI-250]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase A3 of the owner-approved prototype rebuild (2026-09-18). One layer
between shell and screen for every space-scoped route, matching
`docs/design/Laika Prototype.dc.html` (top bar at ~line 118, tabs at ~2247,
presence `.lk-presence`):

- `src/components/space/SpaceLayout.tsx` — reads `?project=` (and hosts
  `?task=` from LAI-252); renders top bar, tab strip, presence strip, then the
  active view.
- **SpaceTopBar row 1**: 26px `--acc` rounded-7 icon square, space name
  19px/800/-.024em, overlapping 21px avatar cluster with `+N` overflow in
  mono, `⋯` button; right side — pulsing LIVE pill (`--grns` bg, `--grnb`
  border, 5px dot, `pulse 2s`), 132px search, "Agents N" toggle, priority
  cycler, filled `+ Create` (30px, `--acc`, radius 9). Every control wires to
  the existing board URL params (`q`, `priority`, `agent`, and Create opens
  the board's new-task form) — nothing renders dead.
- **Row 2, the view tabs**: 34px tabs, active = `--acc` text + 2px bottom
  border + weight 700, horizontally scrollable; Meeting review carries its
  real pending count.
- **PresenceStrip**: 48px `WORKING NOW`, moved up out of `board/`; a person
  chip filters the board by `?assignee=` (closes LAI-149 — note for dedupe).
- **LiveContext**: ONE `EventSource` per project via the existing
  `event-stream.ts` / `use-events.ts`; provides stream state + presence +
  recent events to the pill, the strip, card flash and the board rail.

**The strip is the design's full one — Capacity included (owner decision).**
The owner's approved rebuild plan takes the prototype's tab strip as-is,
superseding LAI-248's recorded ORG-group deviation for Capacity. Unlisted work
stays in the ORG sidebar group. The Capacity tab navigates to `/capacity`
without `?project=` (it reads across the org; the URL stays honest even when
the tab sits in a space's chrome). List and Calendar tabs join in their own
tasks when their routes exist.

## Acceptance criteria

- [ ] Every space-scoped screen (Board, Timeline, Sprints, Dashboard, Meeting
      review) mounts through `SpaceLayout` via the registry's
      `layout: 'space'`, and **its old `ScreenHeader` is stripped in this same
      task** — no screen ever renders two headers.
- [ ] Top bar row 1 renders every element above from real data (org/project/
      member payloads, presence count for "Agents N"); geometry checked in a
      browser test (icon 26px, name weight/size, cluster overlap, pill
      animation class present).
- [ ] Tabs: 34px tall, active tab `--acc` with 2px underline, strip scrolls
      horizontally at narrow widths; Meeting review shows its real count and
      no badge when zero.
- [ ] **Capacity appears in the strip** per the owner decision; `spaceTabs()`
      no longer refuses it; `reachable.test.ts`'s ORG-group assertions updated
      to the new shape in this task; the deviation reversal is stated in this
      file for CHIEF to record as a decision at review.
- [ ] The LIVE pill states derive from the stream (stubbed SSE in tests):
      ready → live/pulsing, gap/closing → degraded state; `ConnectionBanner`
      no longer renders on space screens.
- [ ] PresenceStrip is 48px, hidden below 820px, and a chip click sets
      `?assignee=` on the board.
- [ ] One `EventSource` per project: opening board → timeline → sprints does
      not reconnect (asserted via the stub harness's connection count).
- [ ] Both themes, widths 1440 / 1280 / 900 / 820 / 420, page overflow `0` at
      each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

New files: `src/components/space/{SpaceLayout,SpaceTopBar,ViewTabs,
PresenceStrip,LiveContext}.tsx`, `space/animations.css` (`pulse/flash/tick/
pop/slidein` with `prefers-reduced-motion` guards), plus a pure
`space/top-bar-derive.ts` (cluster overflow, agent count) with node tests.
`SpaceTabs.tsx`/`space-tabs.css` from LAI-248 are subsumed and deleted here.
Old `board/PresenceStrip.tsx` deleted. Style from the prototype, markup never
(§5.1). No new dependencies.

Absorbed backlog id, for CHIEF to close against this: **LAI-149.**

**The responsive rules follow the prototype** (rail <1180, sub <1000, presence
<820 — prototype lines 34–37), per the owner's exact-match mandate; where they
contradict LAI-175/LAI-244's shipped breakpoints, the prototype wins and CHIEF
records the supersession at review.
