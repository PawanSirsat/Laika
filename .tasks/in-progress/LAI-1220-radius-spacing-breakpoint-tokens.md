---
id: LAI-1220
title: 'Radius, spacing and breakpoint tokens, each with a guard that refuses a new raw literal'
area: shell
assignee: shell
priority: p2
depends-on: []
discovered-from: null
status: in-progress
started: 2026-11-13T07:39:17Z
finished: null
---

Dispatched by polly (phase 1 UX audit: "~230 hard-coded radii, 29 distinct
breakpoints"; proposal `docs/ux/design-system/visual-language.md` §4.3 and
§4.4). UI only, `server/web/` only. Filed from CHIEF's id block.

## Goal

Colour, type, motion, layers and glass already have tokens and guards. Corner
radius, spacing and breakpoints do not. Give each family one source, move the
code onto it without a visible change, and add a guard per family that goes
red on a new raw literal.

## Acceptance criteria

- [ ] A fresh, untruncated census of raw `border-radius`, padding/margin/gap
      and `@media` width literals in `server/web/src`, before and after, with
      the numbers recorded in the log.
- [ ] **Radius:** a restrained radius scale as custom properties in the
      shared (theme-independent) block of `styles/theme.css`, listed in
      `theme/token-list.ts`. Every `border-radius` in `server/web/src` is a
      token, `0` or `inherit` (pill and circle through named tokens), or sits
      on a documented exemption list.
- [ ] **Spacing:** the existing `--space-*` scale is used and completed, not
      duplicated. Padding, margin and gap literals that a token matches are
      migrated; what is left is on an exemption list with a reason, and any
      remainder too large for one safe pass is filed as a follow-up task with
      `discovered-from: LAI-1220`.
- [ ] **Breakpoints:** one module, `theme/breakpoints.ts`, naming at least
      390, 768, 1024, 1280 and 1440, with the same values in CSS under a
      documented scheme. Ad-hoc `@media` widths and `matchMedia` queries are
      collapsed onto it where behaviour is equivalent; those that genuinely
      differ are listed.
- [ ] **Guards:** one test per family, in the style of `tokens.test.ts`, that
      fails on a new raw literal outside the token files and the exemption
      list, and asserts names from both sides rather than counts. Each guard is
      shown to go red, by itself, on one added raw literal.
- [ ] **No visual regressions:** before/after screenshots of a sample of
      screens at 390 and 1440 in both themes under
      `.polly/screenshots/lai-1220/` (outside the repo), compared; existing
      golden and screenshot tests still pass.
- [ ] No new dependency; `theme.css` colours untouched; both themes.
- [ ] Root gates `pnpm test`, `pnpm lint`, `pnpm format` each exit 0, run
      once after the last edit.
