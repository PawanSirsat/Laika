---
id: LAI-1021
title: 'Closing the task drawer returns focus to the card that opened it, not to the page body'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from: LAI-1018
status: in-progress
started: 2026-11-01T13:03:17Z
---

## Why

Found on production (`8469099f`) by the LAI-1018 live keyboard walk, in all
four configs (dark and light, 1440 and 390 px). On `/board`, focus
"LAIKA-876 — open details" and press Enter: the drawer opens and focuses its
panel, which is correct. Press Escape, or Tab to × and press Enter: the
drawer closes, and `document.activeElement` is `<body>`. It is still
`<body>` 2.5 s later.

A keyboard or screen-reader user is thrown to the top of the document and
has to Tab back through the sidebar, the board header and every lane to
return to the card they were on. That fails WCAG 2.4.3 Focus Order, and the
programme's own bar for these screens: "focus restored after dialogs".

`server/web/src/components/drawer/TaskDrawer.tsx` focuses the panel on mount
("so a keyboard reader is inside the thing that just opened") and nothing
hands focus back when `onClose` strips `?task=`. The app's dialogs already
do this: `components/use-dialog-focus.ts` restores focus to the opener, and
ConfirmDialog and HandoffOfferDialog use it.

Evidence: `.polly/evidence/LAI-phase6/` on Belka; the record is
`docs/acceptance/LAI-1018-live-browser.md` § 3.

## Acceptance criteria

- [ ] Closing the drawer (Escape, × or the scrim) returns focus to the
      element that opened it: the card's "KEY — open details" button when
      opened from a card, in both themes, at desktop and 390 px.
- [ ] When the opener is gone, or the drawer was opened from a URL with no
      opener, focus goes to a stated fallback, not to `<body>`. For example,
      the card for that task if it is on screen, else the board's main region.
- [ ] A web test opens the drawer from a card by keyboard, closes it by
      Escape and by ×, and asserts `document.activeElement` is the card's
      open button. The test goes red when the restore is removed.
