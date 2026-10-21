# myday-scroll — 2026-10-21

A builder CHIEF dispatched on the owner's direct instruction, in the
temporary worktree `Laika-myday-scroll/` on `LAI-858-my-day-lists-scroll`.

## 2026-10-21T12:40:51Z — LAI-858

**What changed**
- server/web/src/routes/screens/my-day/ListScroller.tsx — new; the scroll area To settle and Confirmed share: the wheel over the rest of the card turned into rows of the list while it has more rows than it shows, whole-row height with a tail so the end is a row's top, the selected row revealed by the list's own scroll
- server/web/src/routes/screens/my-day/DraftList.tsx, EntryList.tsx — render ListScroller; the card ref on the section; `go()` and its `scrollTop = 0` gone
- server/web/src/routes/screens/my-day/my-day.css — rows snap to their top; `contain` only with `[data-overflows]`; one inset (`--myday-inset`) for header, rows, bar, pager and Add time, the row's 3px edge taken out of it; badges as wide as their word at the row's end; every To settle row two lines with set leading; on a phone one 14px inset, the wrapped lines starting at the time, the week's line between its arrows, the timeline's controls together, the lock on its own line without the dot; the gaps' link left-aligned
- server/web/src/routes/screens/my-day/MyDayScreen.tsx — `gutterOutside`: the column beside the day puts its scrollbar gutter in the page's margin, so its cards end where the week does
- server/web/test/browser/my-day-scroll.test.ts — new, fifteen cases; eleven written first (nine red on 817f12be's source, the two guards green), four more from the whole-screen audit (all red on 6f03c3f5)
- server/web/test/browser/my-day-bulk.test.ts — the card link's text is key, then title under it; its name still both
- .tasks/review/LAI-858-my-day-lists-scroll-alone-and-align.md — cause, fix, alignment list, tests, gate runs

**Decisions**
- Redirect the wheel only from the parts of the card outside the list, and let the browser scroll the rows themselves — over the rows a native scroll with CSS snap and `contain` already does the right thing and feels better than anything scripted; scripting every wheel over the card would have taken the browser's own smooth scrolling and momentum away from the rows.
- A list that shows every row is no scroller: `contain` only with `[data-overflows]`. It had been a dead zone — over the rows the page would not move while over the header it did. The criterion only binds "whenever it has more rows than it shows", and a card nearly a screen tall that eats every wheel would make the page unscrollable from most of it.
- Whole-row height plus a snap plus a tail, rather than a CSS-only snap — a snap alone cannot stop the furthest position cutting a row when the list overflows by less than a row, which is exactly the owner's case.
- To settle rows all two lines, the card's title under its key — the owner's design draws every row that way, and one row height is what lets whole rows mean the same at both ends of the list.
- The shared scroller is a component (`ListScroller.tsx`), not a `use-*.ts` hook — a `.ts` module needs a mirrored unit test or a `WEB_NO_MIRROR_REQUIRED` entry in `server/test/tooling/structure.test.ts`, which is outside this task's files; the scroll area's markup was already duplicated in both lists, so a component is also the natural shape.
- The whole screen, not just the two lists, was audited against the design — the criterion says "the live My day". That found the side column's 15px gutter and four phone wrapping faults, fixed in the same files rather than left for another task.
- The side column's gutter is moved outside by a measured negative margin rather than by dropping `scrollbar-gutter: stable` or hiding the scrollbar — dropping it brings back the layout shift LAI-810 avoided, and hiding it takes the scrollbar from mouse users; the measured margin is zero wherever scrollbars overlay (a Mac with only a trackpad, by default), so there nothing changes.
- "Selecting never moves the page" is asserted as the list not moving on the screen, not as `.shell-main.scrollTop` unchanged — at 390 the inspector above changes height with the block's kind and the browser's scroll anchoring holds the view by changing that offset; asserting the offset would demand the inspector never change height, which is not this task.

**Discovered**
- The "Laika App v2" design that LAI-831 and LAI-858 cite is not in `docs/design/`; it exists only as `~/Downloads/Laika App v2.html` and a `/tmp` copy. Not filed (CHIEF asked for no task files); in the report for CHIEF.
- On a phone the inspector is 743px for a block on nothing and 707px for one on a card, so content below it shifts when J or K crosses kinds; scroll anchoring hides it while the list is on screen. In the report.
- The browser harness has no `pageerror` watch: a script error in the page cannot fail a test. Checked by hand for this change (probe 6: none). In the report.
- My own probe scripts named their screenshots `before-` unconditionally and an after-run overwrote them; the JSON readings were tagged and survived. Regenerated the before images against HEAD's source.
- A mutant with the CSS snap removed stayed green until a "one notch in" assertion was added — nothing had read a resting place mid-list.

**State**
Moved to .tasks/review/. After the last gate the branch is pushed and a PR opened against master; not merged.
