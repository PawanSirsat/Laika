---
id: LAI-858
title: 'My day: To settle and Confirmed scroll on their own, never the page, and the screen lines up with the design'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
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

- [ ] **Reproduce first, and record it here.** In a real browser against the
      built app, record exactly when the page scrolls instead of the list. Try
      the pointer over the list, the header and the pager; the list at its
      top, middle and end; a full 10-row page and a shorter one; at 1440,
      1024 and 390px. Name the cause with evidence. `.myday-scroll` already
      has `overscroll-behavior: contain` (`my-day.css:1369-1374`), so say why
      that is not enough.
- [ ] With the pointer anywhere over the To settle card or the Confirmed card,
      a wheel or trackpad scroll moves only that card's list whenever it has
      more rows than it shows. Reaching either end does not carry on into the
      page, and the page's scroll position does not change.
- [ ] No row is left partly hidden under a card's header with a stray line of
      its text showing, as in the owner's screenshot. Opening a day, changing
      page and selecting a row (click, J or K) show the rows they bring into
      view whole. Selecting a row never moves the page.
- [ ] Nothing else loses its scroll. The timeline still scrolls sideways on
      its own, the right column still scrolls, and the page still scrolls
      when the pointer is anywhere else.
- [ ] **Alignment.** Compare the live My day with the owner's design
      (`docs/design/`, the "Laika App v2" My day) at 1440, 1024 and 390px,
      light and dark, sidebar open and folded. Fix every misalignment found in
      My day's own files, and list each one here with before and after
      screenshots. Anything outside My day's files is listed, not fixed. The
      SIGNALS and AGENTS lanes and the agent's name are LAI-834, LAI-833 and
      LAI-835, not this task.
- [ ] Browser tests fail on today's code for the scroll and row-edge
      behaviour above, at 1440 and 390, and pass after.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Files: `server/web/src/routes/screens/my-day/**` and
  `server/web/test/browser/my-day*.test.ts`, plus a new browser test file
  under `server/web/test/browser/` if that is clearer. No new dependencies.
- The lists are `DraftList.tsx:216` and `EntryList.tsx:58`, both
  `.myday-scroll`. The right column is sticky with its own scroll
  (`my-day.css:50-54`). LAI-842 made the rows one subgrid, and its
  column rules stay.
- D-094's type scale applies: every `font-size` is a step token.
