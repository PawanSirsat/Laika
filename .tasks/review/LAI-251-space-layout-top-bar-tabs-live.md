---
id: LAI-251
title: 'SpaceLayout: the top bar, the full tab strip, the LIVE pill, presence, one SSE'
area: web
assignee: shell
priority: p1
depends-on: [LAI-249, LAI-250]
discovered-from: LAI-248
started: 2026-09-18T13:06:41+05:30
finished: 2026-09-18T13:52:10+05:30
status: review
---

> **Claim deviation, flagged (§2).** `depends-on` names LAI-249 and LAI-250,
> both in `.tasks/review/`. Same ground as those two: the owner-approved
> rebuild plan (2026-09-18) sequences Phase A back-to-back on this branch.
>
> **And the claim commit was late, which is a §2 breach, not a deviation.** The
> `git mv` happened at `started:` and the frontmatter edit did not follow until
> the repo gate failed `task-file-state.test.ts` — by which point the code was
> written. Nothing was lost (no other session claims web tasks, and the move
> was visible on this branch throughout) but the lock was incomplete for the
> duration and that is worth recording rather than quietly repairing. The
> guard that caught it is the one CLAUDE.md §2 describes.

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

- [x] Every space-scoped screen (Board, Timeline, Sprints, Dashboard, Meeting
      review) mounts through `SpaceLayout` via the registry's
      `layout: 'space'`, and **its old `ScreenHeader` is stripped in this same
      task** — no screen ever renders two headers.
- [x] Top bar row 1 renders every element above from real data (org/project/
      member payloads, presence count for "Agents N"); geometry checked in a
      browser test (icon 26px, name weight/size, cluster overlap, pill
      animation class present).
- [x] Tabs: 34px tall, active tab `--acc` with 2px underline, strip scrolls
      horizontally at narrow widths; Meeting review shows its real count and
      no badge when zero.
- [x] **Capacity appears in the strip** per the owner decision; `spaceTabs()`
      no longer refuses it; `reachable.test.ts`'s ORG-group assertions updated
      to the new shape in this task; the deviation reversal is stated in this
      file for CHIEF to record as a decision at review.
- [x] The LIVE pill states derive from the stream (stubbed SSE in tests):
      ready → live/pulsing, gap/closing → degraded state; `ConnectionBanner`
      no longer renders on space screens.
- [x] PresenceStrip is 48px, hidden below 820px, and a chip click sets
      `?assignee=` on the board.
- [x] One `EventSource` per project: opening board → timeline → sprints does
      not reconnect (asserted via the stub harness's connection count).
- [x] Both themes, widths 1440 / 1280 / 900 / 820 / 420, page overflow `0` at
      each.
- [x] Full gate — all three `EXIT 0`, repo root.

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

## Completion notes

**The deviation reversal, for CHIEF to record as a decision.** LAI-248 put
Capacity in an `ORG` sidebar group rather than the tab strip, reasoning that an
`orgLevel` route drops `?project=` and a tab under `laika-core` would claim to
be about it. The owner's exact-match mandate puts the design's strip back, and
the reasoning resolves rather than being overruled: **scope lives in the link,
not in the bar it is offered from.** `navHref` still drops `?project=` for
`/capacity`, so the tab is where you reach it and the URL is what it reads.
Capacity's `group` is now `null` — offering it in the sidebar *and* the strip
would be two answers to one question. Unlisted work stays in `ORG`; the design
has no tab for it to inherit.

**What replaced what**

| was | is |
| --- | --- |
| `SpaceTabs.tsx` (LAI-248) | `space/ViewTabs.tsx`, the design's 34px strip |
| each screen's `ScreenHeader` | one space bar + `SpaceSlot` per view |
| `board/PresenceStrip.tsx` | `space/PresenceStrip.tsx`, above every view |
| board-local search / agent / priority / new task | `SpaceTopBar`, same URL params |
| per-screen stream state | `SpaceLive`, one `EventSource` per space |

**`SpaceSlot` is a portal, and it is why no information was lost.** The design
has one bar per space and no per-view context line, but the headers being
removed carried real derived data — *"3 sprints · Jan–Mar"*, *"5 people ·
updated every 30s"*. Deleting those to match a mockup that had no way to show
them would have been matching the drawing rather than the design. Each view
portals its line into the bar instead.

**Three defects found by this task's own tests, all fixed here**

1. **The tab strip rendered 36px, not the design's 34.** `border-bottom: 2px`
   on a content-box element. Measured by the browser test rather than eyeballed.
2. **`Agents 0` beside a live agent session** — a race in the test, not the
   app: the chip renders before presence lands. The test waits for presence
   now, which is the data the assertion is about.
3. **A theme toggle that could not be clicked** — the rail is off-canvas below
   900px, and the width loop had left the viewport at 420. The test widens
   before touching a control that lives in the rail.

**A process breach, recorded rather than repaired quietly.** The `git mv` that
claimed this task was not followed by the frontmatter edit until the repo gate
failed `task-file-state.test.ts` — after the code was written. §2 wants the
move and the frontmatter in one commit, before any code. Nothing was lost, and
the guard that caught it is the one §2 describes; the note is in the frontmatter
above.
