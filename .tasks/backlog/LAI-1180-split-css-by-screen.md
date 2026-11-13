---
id: LAI-1180
title: 'Split the stylesheet by screen, once each screen imports the CSS it uses'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-1219]
discovered-from: LAI-1219
status: backlog
---

## Goal

LAI-1219 made every screen's **JS** load on demand but kept every screen's
**CSS** in the entry stylesheet (`components/shell/screen-styles.ts`), byte
for byte in its old order: 874 KB raw / 127.6 KB gzip, against the 40 KB
target in `docs/ux/design-system/responsive-accessibility.md`.

It could not split CSS safely, because screens depend on stylesheets that
only **other** screens import. Measured: the board's lane layout
(`.board-main` and `.board-grouped` in `routes/screens/board/board-rail.css`)
is imported only by `routes/screens/activity/ActivityPanels.tsx`, so with
per-chunk CSS the board's lanes stopped scrolling — and
`board-refresh.test.ts` ("a lane's scroll and an unsent draft survive a
refresh") went red. A rough source sweep (class tokens used in each chunk
against the CSS that chunk loads) reported several hundred candidate
(component, class) pairs. Many are noise from generic tokens, but it is not
a census anyone has done.

Per-chunk CSS also makes the cascade depend on the order screens were
visited, so two rules of equal specificity can resolve differently on two
visits to the same page.

## Acceptance criteria

- [ ] Every component imports the stylesheets whose classes it renders; a
      guard (source or build) fails when a screen chunk renders a class whose
      only definition is in CSS that chunk does not load.
- [ ] The cascade does not depend on visit order: no two rules of equal
      specificity in different chunk stylesheets set the same property on the
      same selector, or a guard says which do.
- [ ] `screen-styles.ts` and the AppShell three-sheet preamble are removed,
      and `bundle-budget.test.ts` gains a CSS budget for the entry.
- [ ] Browser tests pass in both themes; the screens LAI-1219's sweep flagged
      are checked by a test or by recorded screenshots.
