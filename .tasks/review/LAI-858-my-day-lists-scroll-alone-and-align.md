---
id: LAI-858
title: 'My day: To settle and Confirmed scroll on their own, never the page, and the screen lines up with the design'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-21T10:35:31Z
finished: 2026-10-21T12:40:38Z
---

## Goal

On My day, scrolling over the To settle card or the Confirmed card moves only
that card's list and never the page. Nothing on the screen is misaligned
against the owner's design.

This is on the owner's direct instruction (2026-10-21, with screenshots of the
live screen):

> "when im on to settle componenet or on the confirmed compnenet that is only
> scroll the that copenet once stop not scrooling teh hole page please check
> that and fix that"

> "also some ui is not prorly alligned in that"

Asked which parts were misaligned, the owner answered: "do it what is needs
to do".

## Acceptance criteria

- [x] **Reproduce first, and record it here.** In a real browser against the
      built app, record exactly when the page scrolls instead of the list. Try
      the pointer over the list, the header and the pager; the list at its
      top, middle and end; a full 10-row page and a shorter one; at 1440,
      1024 and 390px. Name the cause with evidence. `.myday-scroll` already
      has `overscroll-behavior: contain` (`my-day.css:1369-1374`), so say why
      that is not enough.
- [x] With the pointer anywhere over the To settle card or the Confirmed card,
      a wheel or trackpad scroll moves only that card's list whenever it has
      more rows than it shows. Reaching either end does not carry on into the
      page, and the page's scroll position does not change.
- [x] No row is left partly hidden under a card's header with a stray line of
      its text showing, as in the owner's screenshot. Opening a day, changing
      page and selecting a row (click, J or K) show the rows they bring into
      view whole. Selecting a row never moves the page.
- [x] Nothing else loses its scroll. The timeline still scrolls sideways on
      its own, the right column still scrolls, and the page still scrolls
      when the pointer is anywhere else.
- [x] **Alignment.** Compare the live My day with the owner's design
      (`docs/design/`, the "Laika App v2" My day) at 1440, 1024 and 390px,
      light and dark, sidebar open and folded. Fix every misalignment found in
      My day's own files, and list each one here with before and after
      screenshots. Anything outside My day's files is listed, not fixed. The
      SIGNALS and AGENTS lanes and the agent's name are LAI-834, LAI-833 and
      LAI-835, not this task.
- [x] Browser tests fail on today's code for the scroll and row-edge
      behaviour above, at 1440 and 390, and pass after.
- [x] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Files: `server/web/src/routes/screens/my-day/**` and
  `server/web/test/browser/my-day*.test.ts`, plus a new browser test file
  under `server/web/test/browser/` if that is clearer. No new dependencies.
- The lists are `DraftList.tsx:216` and `EntryList.tsx:58`, both
  `.myday-scroll`. The right column is sticky with its own scroll
  (`my-day.css:50-54`). LAI-842 made the rows one subgrid, and its
  column rules stay.
- D-094's type scale applies: every `font-size` is a step token.

## Reproduction and cause (the builder, 2026-10-21)

Reproduced in a real browser (Playwright Chromium, the built SPA, stubbed
`/api`) on a day shaped like the owner's screenshot: fifteen blocks to
settle, the first page six blocks on nothing (two-line rows) and four on a
card. The page's scroller is `.shell-main` (LAI-601); `window.scrollY` stayed
0 throughout. Each wheel was 120px, the pointer moved and let rest 700ms
between places. Raw readings: the scratchpad's `lai858/probe-before-v1.json`
(scroll) and `probe2-before-v1.json` (selection); the shorter page's from
`probe-before.json`, the same probe run again on `817f12be`'s source.

| Window | Pointer over | List (rows vs room) | What moved |
| --- | --- | --- | --- |
| 1440×900 | To settle rows | 500px of rows in 544px: fits | **nothing** — the page stayed at 889 (a dead zone) |
| 1440×900 | To settle header / pager | fits | **the page**, 889 → 1009 |
| 1440×900 | Confirmed pager | 410px in 544px: fits | **the page**, 1428 → 1308 (up) |
| 1024×768 | To settle rows, down to the end | 500px in 476px: **23px over** | the list 0 → 23, page still; at its end the first row sat 23px under the header with its last line showing (`before-1024-owner15-settle-listend.png`) — **the owner's screenshot** |
| 1024×768 | To settle rows, at the top | 23px over | the last row 23px short at the list's foot |
| 1024×768 | To settle header / pager | 23px over | **the page**, 842 → 962 |
| 390×844 | To settle rows, either end | 482px over | the list only (0 → 482), page held at 1648 |
| 390×844 | To settle header / pager | 482px over | **the page**, 1648 → 1768 |
| 390×844 | Confirmed header / pager | 386px over | **the page**, 2311 → 2431 → 2671 |
| 1440, 1024, 390 | A shorter page (four blocks): its rows | fits | **nothing** — the page held at 889, 842, 1630 |
| 1440, 1024, 390 | A shorter page: its header | fits | **the page**, 889 → 1009, 842 → 962, 1630 → 1750 |

Selection (same day): at 1024, **J to the tenth block left it cut** (607–647
against the list's foot at 624) — nothing brought it into view. Read from
the code (`DraftList.tsx:91-100` at `817f12be`), a page changed by J or K
kept the old scroll; only *‹ Prev* / *Next ›* reset it. At 390, selecting a
row of another kind changed the page's offset by 36px while the list held
still on the screen (its top at 375, `probe3-before.json`): the inspector
above grows or shrinks with the block's kind (743 vs 707px) and the
browser's scroll anchoring keeps what is on screen in place. At 1440 and
1024 the inspector's height did not change.

**The cause, three parts:**

1. **`overscroll-behavior: contain` holds a wheel only over the scroller
   itself.** The card's header, selection bar, pager and — on Confirmed —
   *Add time* are the scroller's siblings, not inside it, so a wheel there
   starts on the page's scroll chain. That is "the whole page scrolls when I'm
   on the component": over the rows the list was held; over every other part
   of the same card, the page moved. A trackpad user crosses from one to the
   other without noticing.
2. **The list's height was not a whole number of rows.** `min(34rem, 62dvh)`
   against rows of 41px (on a card) and 56px (two lines) meant a ten-row page
   on a laptop-height window came **less than a row over** — 23px at
   1024×768. `contain` cannot help there: the list could move only by that
   sliver, and at its end the first row sat cut under the header with one
   line showing. The same arithmetic cut the last row at the foot when it
   opened.
3. **Selecting did not reveal.** J and K changed the selection and the page
   of rows, but nothing scrolled the list to the row, and a page changed by
   J kept the old scroll.

And one the owner did not name: a list that **fits** was a dead zone —
`contain` on a scroller with nothing to scroll still stopped the wheel, so
over the rows the page would not move while over the header it did.

## Fix

- `server/web/src/routes/screens/my-day/ListScroller.tsx` (new) — the scroll
  area both lists now share.
  - A non-passive `wheel` listener on the card turns a wheel anywhere else
    over the card into rows of the list, **only while the list has more rows
    than it shows**; at either end it is still taken, so nothing carries on
    into the page. Over the rows the browser scrolls them natively and
    `overscroll-behavior: contain` keeps it there. Skipped: pinch-zoom
    (`ctrlKey`), sideways wheels, and anything inside the card that scrolls
    that way itself. A page fling already moving as the card passes under the
    pointer stays the page's for that gesture (150ms between events), as the
    browser keeps one that passes over the rows — evidence only, probe 7, not
    a test: it hangs on event timing a loaded runner cannot promise.
  - `fitRows`: the list's height is the most whole rows that fit the
    stylesheet's `max-height`; a tail after the rows makes the furthest
    scroll a row's top. `data-overflows` says whether it scrolls at all.
    Re-fitted on a resize of the rows and of the window.
  - `reveal`: the selected row is brought into view whole by setting the
    list's `scrollTop` — never `scrollIntoView`, which moves the page too —
    and a new page starts at its top. On the fix, a click on a row cut by
    the window's bottom edge moved neither the page nor the list (probe 5,
    1440 and 390).
- `DraftList.tsx`, `EntryList.tsx` — render `ListScroller`; the section
  carries the card ref; `go()` and its `scrollTop = 0` are gone (the
  scroller does it for every change of page, J and K included).
- `my-day.css` — `.myday-scroll` snaps rows to their top
  (`scroll-snap-type: y mandatory`, `scroll-snap-align: start` on each row);
  `overscroll-behavior: contain` only with `[data-overflows]`.

And for the alignment below:

- `my-day.css` — one inset for everything in the two cards
  (`--myday-inset`, 14px on a phone), the row's 3px edge taken out of it;
  `.myday-source { justify-self: end }`; every To settle row two lines with
  set leading, the card's title under its key; on a phone the wrapped lines
  start at the time (`--myday-lead`), the week's line wraps between its
  arrows, the timeline's controls wrap together, the lock takes its own line
  without the dot; the gaps' link starts its lines at the left.
- `MyDayScreen.tsx` — `gutterOutside`, a callback ref on the column beside
  the day: a negative right margin as wide as its scrollbar gutter
  (`offsetWidth − clientWidth`), so the gutter sits in the page's margin.

Commits: `d5c388f3` (tests, red), `2ee3932f` (scroll), `6f03c3f5` (the
lists' alignment), `97c92d28` (screen tests, red), `bc9108f0` (the rest of
the screen).

## Alignment (criterion 5)

**The reference.** The owner's "Laika App v2" My day is **not in
`docs/design/`** — no file there mentions My day. It is
`~/Downloads/Laika App v2.html`, copied to `/tmp/laika-myday-v2/` (LAI-831).
Rendered with Playwright at 1440 light and dark, 1024 and 390; it has no
phone layout (at 390 it is a desktop page cut off). LAI-831's decisions A–I
and CHIEF's additions stand: durations such as `1 h 35 min`, the 12-hour
clock, the header's wording.

Measured on the live screen, every row part against its card, at 1440, 1024
and 390, light and dark, the sidebar open and folded (`align-before.json`,
`align-after.json`). Screenshots are in the scratchpad's `lai858/shots/`,
never committed. Distances are from the card's edge.

| # | Where | Before | After | Screenshots (before → after) |
| --- | --- | --- | --- | --- |
| 1 | Both cards, every width | Rows started **3px right** of their header, pager, bar and *Add time*: box and marks at 22px, header at 19px. The selected row's 3px edge was added to the same inset | 19px and 19px — the edge comes out of the inset, as the design's 17px + 3px | `before-1440-light-open-settle.png` → `after-1440-light-open-settle.png`; `before-1440-dark-open-entries.png` → `after-1440-dark-open-entries.png` |
| 2 | Both cards, laptop | A source badge **stretched to the widest** in its column, its word at the left: every To settle badge 67px (`agent` as wide as `collector`), every Confirmed badge 75px (`Typed` as wide as `Solidtime`) | As wide as its word, at the row's end: 48/67px, 50/70/75px, all ending on one line | `before-1440-light-folded-settle.png`, `before-1440-dark-open-entries.png` → `after-…` of each |
| 3 | To settle, every width | **Rows of three heights**: on a card 41px (key and title side by side on one line), on nothing 56px, General or a space 59px (those two from the test's red run) | One height, 56px (107px on a phone): every row is the label and the line under it, as the design draws them; set leading, so the font does not decide | `before-1440-light-folded-settle.png` → `after-1440-light-folded-settle.png` |
| 4 | Both cards, phone | Rows inset **14px**, header, pager, bar and *Add time* **18px**: left edges 1px apart (with the 3px edge), right edges 4px | One inset, 14px on a phone, for all of them | `before-390-light-open-settle.png` → `after-390-light-open-settle.png` |
| 5 | Both cards, phone | The lines under the first (card, title, badge) started **under the box or the mark**, at 18px, not under the time at 46px / 38px | They start where the time does (43px / 35px) | `before-390-light-open-settle.png`, `before-390-light-open-entries.png` → `after-…` of each |
| 6 | To settle, laptop-height windows | The list's foot and, at its end, its head **cut a row** (above) | Whole rows at rest, at every position | `before-1024-owner15-settle-listend.png` → `after-1024-owner15-settle-listend.png`; `before-1024-j-o10.png` → `after-1024-j-o10.png` |
| 7 | The column beside the day, every width | Its cards ended **15px short** of the page's other edges: 1407 against the week's 1422 at 1440, 991 against the day's 1006 at 1024, 359 against 374 at 390. `scrollbar-gutter: stable` kept the scrollbar's gutter inside the column (the design's cards end with the week) | The gutter goes in the page's margin; the cards end at 1422, 1006, 374. Nothing changes where scrollbars overlay, which have no gutter | `screen-before-1440-light-open-0.png` → `screen-after-1440-light-open-0.png`; `screen-before-1024-light-open-3.png` → `screen-after-1024-light-open-3.png` |
| 8 | The week, phone | `‹`, the week's line and `›` on **three lines** | The line wraps between its arrows | `screen-before-390-dark-open-0.png` → `screen-after-390-dark-open-0.png` |
| 9 | The timeline's controls, phone | `‹` left on the title's line, *Now*, `›` and the zoom on the next | All together on a line under the title | same pair |
| 10 | The GAPS figure, phone | Its link (a button) **centred** its wrapped lines; the other figures' lines start at the left | Starts each line with its label | same pair |
| 11 | The subtitle, phone | The dot between the date and the lock **left at the end** of the date's line when the lock wrapped | The lock has its own line and the dot goes | same pair |

**Different from the design and not changed** — style, not alignment, or
already decided:

- The source badge is the UI face, small, semibold; the design sets it in
  the mono face at 11px. *General* in a row is the UI face; the design sets
  it in mono. Type, not alignment.
- The design's lengths read `1:35`; ours `1 h 35 min` (CHIEF's addition A).
- The design's Confirmed row runs its time into its length
  (`11:30 AM – 12:00 PM0:30`): a mockup artefact. LAI-842's subgrid keeps
  ours apart.
- The design's SIGNALS and AGENTS lanes and the proposing agent's name are
  LAI-834, LAI-833 and LAI-835.
- At 1024 with the sidebar folded, today's tile in the week reads *11 h 51
  min to sett…*: an ellipsis by design (LAI-831), not a misalignment.
- The design's cards are inset 20px; ours 18px, the same in every card.
  Spacing, consistent across the screen, not alignment.

**Outside My day's files: nothing found.** The design's absence from
`docs/design/` is the one thing outside — listed for CHIEF.

## Tests

`server/web/test/browser/my-day-scroll.test.ts` (new), fifteen cases:

- *a wheel over a list that has more rows than it shows moves only that
  list* — To settle at 1440×900 and 390×844 over a row, the header, the
  pager and (ticked) the selection bar; Confirmed at 1440×640 and 390×844
  over a row, the header, the pager and *Add time*. One notch moves the list
  and not the page; enough notches reach each end and the page has not
  moved; the document never scrolls. Each case first asserts the list has
  something to scroll and the page has room both ways, so a broken setup
  cannot pass it.
- *a list that shows every row is not a scroller* — Confirmed at 1440×900
  fits; over its rows and its header the page scrolls.
- *rows come to rest whole* — at 1440 and 390: no row partly in view on
  opening, at the end, back at the top, **one notch in**, on each J from the
  first block to the tenth, J onto page two, K back, a click on a row, and
  *Next ›*; the selected row is all in view; **the list does not move on the
  screen** (its offset is the reading, since the page's own offset follows
  the inspector's height by scroll anchoring at 390 — above).
- *the rows line up* — at 1440 and 390, a first page with every kind of row
  on it: one row height (without the last row's missing line); a card's
  title under its key; each row's first part starts with its header; on a
  laptop each row ends with the pager, badges end on one line and differ in
  width by word; on a phone each row's card starts at its time and ends with
  the pager.
- *the rest of the screen lines up* — at 1440, 1024 and 390 the cards
  beside the day end with the page's other edges; at 390 the week's arrows
  sit either side of its line, the timeline's four controls on one line, each
  line of the gaps' link starts with its label, and no dot is left at a
  line's end.
- *nothing else loses its scroll* (guards) — at 1440×700 and 390: the page
  scrolls over the day's figures; the timeline scrolls sideways on its own;
  on a laptop the column beside the day scrolls on its own.

`my-day-bulk.test.ts` — one assertion follows the card link's new form:
`innerText` is `LAI-1\nSearch matches keys`, and `textContent` still reads
`LAI-1 Search matches keys`.

**Red first**, on this branch's `817f12be` source with only the new test file
(the three changed source files restored to `HEAD` by name and
`ListScroller.tsx` moved aside; a trap put each back and checked its sum):

```
cd server/web && pnpm exec node --test test/browser/my-day-scroll.test.ts   →  EXIT 1
# tests 11  # pass 2  # fail 9
```

The nine fail on what they name: *"1440: a wheel over the header scrolled the
page — 1015 !== 915"*, the same at 390 (1774 !== 1674), Confirmed 1440×640
(1533 !== 1433) and 390 (2437 !== 2337); *"over a row, the page did not
scroll"*; *"opened, a row is partly hidden: s10 626–681"* (1440) and *s05
568–675* (390); *"To settle rows of more than one height: s01 55, s02 40, s03
58 …"* (1440) and *106, 90, 109 …* (390). The two passing are the
*nothing else loses its scroll* guards, which hold on today's code too.

The four *rest of the screen* cases came with the whole-screen audit,
after the first eleven were green, and were red first on `6f03c3f5` (the
list fixes, before these): `--test-name-pattern "ends where the page|wrap
without coming apart"` → `EXIT 1`, 4 of 4 failed: *"a card beside the day
ends at 1407, the page's edge at 1422"* (991/1006 at 1024, 359/374 at 390)
and *"a week arrow is not beside the week's line"* at 390. That case stops
at its first assertion; the mutants below show each of its parts red.

**Green** on `bc9108f0`: the four My day browser files together
(`my-day-scroll`, `my-day`, `my-day-bulk`, `my-day-v2`) → `EXIT 0`,
`# tests 69 # pass 69`, at load ~12–21.

**Mutations** (`mutate.py`; each anchor checked to match once, the file
restored by name and its sum checked; each run the matching tests only):

| Mutant | Red |
| --- | --- |
| M1 no wheel listener on the card | 4 of 4 *moves only that list* |
| M2 no tail | 2 of 2 *rows rest whole* |
| M3 no whole-row height | 2 of 2 *rows rest whole* |
| M4 no reveal | 2 of 2 *rows rest whole* |
| M5 `contain` always, not only with `[data-overflows]` | 1 of 1 *not a scroller* |
| M6 badge stretched again | 1440 *line up* (a phone's badge is not in the grid) |
| M7 row inset without the 3px | 2 of 2 *line up* |
| M8 no hanging indent | 390 *line up* |
| M9 the card's title beside its key | 2 of 2 *line up* |
| M10 no `scroll-snap-type` | **green at first** — nothing read a resting place mid-list. The *one notch in* assertion was added for it; then 390 *rows rest whole* red (1440's one notch lands on the end, whole either way) |
| B1 no `ref={gutterOutside}` | 3 of 3 *ends where the page's other edges do* (1407 vs 1422) |
| B2 week line not `flex: 1 1 0` | 390 *wrap*: "a week arrow is not beside the week's line" |
| B3 no `.dayline-tools-gap` line | 390 *wrap*: "the timeline's controls came apart: [625,661,661,661]" |
| B4 gaps link not `text-align: start` | 390 *wrap*: "a line of the gaps' link starts at 34.3, its label at 31" |
| B5 the dot and lock as before | 390 *wrap*: "the subtitle's dot hangs at a line's end" |

## Gate

Run by the shared serialising script (`gate.sh`: one gate at a time across
builders, `VITEST_MAX_WORKERS=2`, waits for the 5-minute load under 20),
each command to its own file and its own exit code.

| Run | HEAD | Load at start → end | `pnpm test` | `pnpm lint` | `pnpm format` |
| --- | --- | --- | --- | --- | --- |
| 1 | `6f03c3f5` (the lists' fixes) | 15.4 → 19.9 | 0 | 0 | 0 |
| 2 | `bc9108f0` (all the code) | 9.0 → 10.8 | 0 | 0 | 0 |

Run 1: `server/web` 2641 of 2641; `server` 165 files passed, 2 skipped, 3375
tests passed, 10 skipped; `cli` 535 tests, 533 passed, 2 skipped, 0 failed. A grep of
the output for `Unhandled|Errors|Failed|not ok|✗` finds only the test named
*completeSetup and fieldErrors*. Run 2: `server/web` 2645 of 2645 (the four
new cases), the rest as run 1; the same grep, the same one name.

The gate after this record — the only change after run 2 is `.tasks/` and
`logs/` — runs on the commit that carries it, and its result is in the pull
request.
