---
id: LAI-1184
title: 'My day: holidays and leave on Year, Month, Week and the Day page (D-149)'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-1183]
status: backlog
---

## Goal

The owner's screenshot (My day → Year, 2026-11-13): a holiday or a day on
leave is drawn in its own colour on every My day view, and the Day page says
so.

## Acceptance criteria

- [ ] Tokens in `theme.css` (both themes), `token-list.ts` and the contrast
      pairs: `--holiday`, `--holiday-bg`, `--holiday-border` (teal family) and
      `--leave`, `--leave-bg`, `--leave-border` (blue family, as *Away*);
      clear of the violet Year heat. No server colour is drawn.
- [ ] `span-derive.ts` `cellKind` gains `'off'`; **Year** tile: no time →
      tinted in the tone; with time → heat plus a corner dot (`::after`, not
      `box-shadow`); pending leave → a dashed outline only; label in `title`
      / aria ("Heritage Day", "On leave · half day", "Leave requested").
- [ ] **Month** cell: a chip with the label in place of "—"; **Week**
      column: the label in place of "No signal"; `SpanHead` legend gains
      Holiday and Leave swatches.
- [ ] **Day page**: a banner in the existing stack — "Public holiday —
      {label}", "On leave — {type} ({morning|afternoon})", "Leave requested";
      the header sub-line and `emptyKind` say it instead of "no signal";
      `WeekStrip` tiles marked.
- [ ] Unit tests (span-derive) and browser tests extending
      `my-day-span.test.ts` and the Day fixtures; both themes × 1440/390.
