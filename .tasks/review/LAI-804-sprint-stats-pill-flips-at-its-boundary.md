---
id: LAI-804
title: 'The board toolbar''s sprint figures flip between pill and compact when hovered at their boundary width, and the pill never opens'
area: web
assignee: strelka
priority: p1
depends-on: []
discovered-from: LAI-796
status: review
started: 2026-10-21T13:32:36Z
finished: 2026-10-21T13:59:00Z
---

## Goal

`SprintStats` (LAI-727) picks its tier — full, compact, pill — by measuring
before paint. At a main column of about **860px** the toolbar sits on the
pill/compact boundary, and hovering the pill re-measures and flips it:
measured on LAI-796's branch, the group's class went `pill → compact (×5) →
pill (×9)` within 1.5s of one `hover()`, with the pointer still. The
`mouseenter` lands while the group is *compact* (no handlers), so the pill
comes back closed with `aria-expanded="false"` and its BLK / LEFT tooltip
never shows until the pointer moves again.

LAI-796 made the sidebar an automatic 60px icon rail at windows of 1180px and
under, so a 920px window now gives the board exactly that 860px column. The
same flip is reachable at any window that leaves the toolbar that wide
(before LAI-796, about 1072px with the 212px sidebar).

## Acceptance criteria

- [x] At the pill/compact boundary, hovering, focusing or clicking the pill
      does not change its tier; the tooltip opens on the first hover.
- [x] A browser test at the boundary width — found by measuring, not by a
      guessed pixel — hovers once without moving and sees the tooltip.
- [x] `board-sprint-stats.test.ts`'s pill test no longer needs to open the
      sidebar at 920px (LAI-796 added that to keep its original geometry);
      remove that step and it stays green.
- [x] Gate: test, lint, format exit 0.

## Notes / context

- Likely a tier decision that depends on something the open state changes
  (the popover, `aria-describedby`, the focus ring), or a measurement that
  runs again on the re-render the hover causes. A small hysteresis on the
  boundary is one answer; not re-measuring on state that does not change the
  width is another.
- Reproduce: `/board?project=laika-core&sprint=s2&group=assignee` with the
  `SIX_MEMBERS` stub, viewport 920×768, sidebar collapsed, `pill.hover()`.

## Priority raised to p1 (CHIEF, 2026-10-20)

LAI-796's review: a 920px window now gets the icon rail by default, which
leaves the toolbar about 860px wide — the flip width itself. So anyone on a
small laptop hits this on every hover, not just a test.

## Evidence (Strelka, 2026-10-21)

Built on Strelka, branch `LAI-804-sprint-stats-pill`, base `3a44925a`.

**The defect does not reproduce on today's code, and the red-before could not
be shown.** Measured, not assumed:

- **The boundary is no longer at 860px.** At 920px (main column 860px, toolbar
  824px) the pill leaves search 113.9px, already under the 120px floor, so it is
  deep in the pill tier. LAI-828's type scale moved it. The new test finds the
  boundary by stepping the viewport: **first pill 1020px** on the way down
  (8px steps from 1180px), **first compact 1031px** on the way up (1px steps),
  **widest pill 1030px** (search 224.9px; stepping up needs 225.06px, which is
  room − compact 174.9px ≥ 120 + 8). Tier widths: full 260.6px, compact 174.9px,
  pill 78.1px.
- **Hover, focus and click are stable across the band.** A throwaway probe
  covered 1016–1045px in 1px steps, loaded at the width or resized to it from
  1280px or 900px. On every pill it saw one class change (`aria-expanded`),
  no tier change, and the tooltip open on the first hover.
- **It is stable on LAI-796's merge too (`6c97146a`).** Exported with
  `git archive` to a scratch directory: the new test passes there, with its
  boundary at 996 / 1012 / 1011px. With its sidebar step removed, *that* tree's
  pill test failed on `not the pill at 920px` and on `role` before any hover.
  That test opened at the default viewport and then resized to 920px, a path
  LAI-841 has since replaced with a viewport set before navigation. So the
  red that LAI-804 was filed from was the resize path, not the hover.
- **A likely source of the "pill → compact (×5) → pill (×9)" reading:** every
  measurement writes `className` four times (full, compact, pill, restore)
  before paint. A `MutationObserver` reports those writes as class changes
  that are never painted. The new test samples painted frames instead.

No product code changed: there was no flip left to fix, and changing the
measurement without a reproduction would be a guess.

| Criterion | Evidence |
| --- | --- |
| Boundary: hover, focus, click keep the tier; tooltip on first hover | `the pill on its boundary with compact (LAI-804)`: at the widest pill (1030px), each action painted `['pill']` for 1.5s, the tooltip showed and `aria-expanded="true"` |
| Browser test at a measured boundary, one hover, no movement | same test: the boundary is found by stepping, not written down; `pill.hover()` once, then nothing moves until its assertions |
| Pill test without opening the sidebar at 920px | `openSidebar(h)` removed from `the pill (LAI-727 review)`; Light and Dark green |
| Gate | see below |

**Mutation check.** `(stepUp ? RETURN_MARGIN_PX : 0)` became
`(stepUp && !hovered && !focused && !pinned ? RETURN_MARGIN_PX : 0)`, so the
tier depends on the open state. The file checksum changed (`a46f22d9` →
`8393f24e`) and the anchor grep found 1 line. The new test went **red**:
`hovered at 1030px, the tier changed`, actual `['pill', 'compact']`. The
920px pill test stayed **green** under the same mutation, which is why the
width is measured and not guessed. Source restored, checksum `a46f22d9` again.

**Commands** (from `server/web/`): `node --test --test-name-pattern="the pill"
test/browser/board-sprint-stats.test.ts` → 3 test cases (2 in the pill
describe, 1 in the boundary describe), EXIT 0.

**Gate** (repo root, on `54a0f956` plus this file and the log, run under
`/tmp/laika-root-gate.lock`, 19:54–19:58 IST):

| command | exit | `uptime` load at start |
| --- | --- | --- |
| `pnpm test > /tmp/804-gate.txt 2>&1` | `TEST 0` | 58.73 109.71 100.54 |
| `pnpm lint > /tmp/804-lint.txt 2>&1` | `LINT 0` | 107.50 109.65 101.88 |
| `pnpm format > /tmp/804-fmt.txt 2>&1` | `FMT  0` | 107.48 108.36 101.70 |

`server/web`: 2691 test cases, 2691 pass, 0 fail. `server`: 3386 passed,
10 skipped. `cli`: 535 test cases, 533 pass, 0 fail. The failure grep
(`Unhandled|Errors|Failed|not ok|✗`) matched only the test name `completeSetup
and fieldErrors` (an `ok`). In the gate run the boundary test logged the same
widths: first pill 1020px, first compact 1031px, widest pill 1030px. This table
is the only edit made after the gate, and it is Markdown, which neither
`pnpm format` nor the linters read.
