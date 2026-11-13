---
id: LAI-1220
title: 'Radius, spacing and breakpoint tokens, each with a guard that refuses a new raw literal'
area: shell
assignee: shell
priority: p2
depends-on: []
discovered-from: null
status: review
started: 2026-11-13T07:39:17Z
finished: 2026-11-13T08:47:17Z
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

- [x] A fresh, untruncated census of raw `border-radius`, padding/margin/gap
      and `@media` width literals in `server/web/src`, before and after, with
      the numbers recorded in the log.
- [x] **Radius:** a restrained radius scale as custom properties in the
      shared (theme-independent) block of `styles/theme.css`, listed in
      `theme/token-list.ts`. Every `border-radius` in `server/web/src` is a
      token, `0` or `inherit` (pill and circle through named tokens), or sits
      on a documented exemption list.
- [x] **Spacing:** the existing `--space-*` scale is used and completed, not
      duplicated. Padding, margin and gap literals that a token matches are
      migrated; what is left is on an exemption list with a reason, and any
      remainder too large for one safe pass is filed as a follow-up task with
      `discovered-from: LAI-1220`.
- [x] **Breakpoints:** one module, `theme/breakpoints.ts`, naming at least
      390, 768, 1024, 1280 and 1440, with the same values in CSS under a
      documented scheme. Ad-hoc `@media` widths and `matchMedia` queries are
      collapsed onto it where behaviour is equivalent; those that genuinely
      differ are listed.
- [x] **Guards:** one test per family, in the style of `tokens.test.ts`, that
      fails on a new raw literal outside the token files and the exemption
      list, and asserts names from both sides rather than counts. Each guard is
      shown to go red, by itself, on one added raw literal.
- [x] **No visual regressions:** before/after screenshots of a sample of
      screens at 390 and 1440 in both themes under
      `.polly/screenshots/lai-1220/` (outside the repo), compared; existing
      golden and screenshot tests still pass.
- [x] No new dependency; `theme.css` colours untouched; both themes.
- [ ] Root gates `pnpm test`, `pnpm lint`, `pnpm format` each exit 0, run
      once after the last edit.

## Builder notes (SHELL, LAI-1220)

- Follow-up filed: LAI-1179 (the 485 off-scale spacing declarations and 13
  off-scale breakpoints), discovered-from LAI-1220.
- Breakpoints: 30rem/37.5rem/40rem/64rem/80rem were collapsed onto
  480/600/640/1024/1280px. They are equal only at the browser's default font
  size, because `rem` in `@media` follows the browser default, not the root.
- **The gate criterion is unticked on purpose.** `pnpm lint` and `pnpm format`
  exit 0. `pnpm test`, run workspace by workspace after the last code edit
  at df6b8015, exited 1 in all three workspaces. Every failure is on the
  known-flake list or is load-related, and passed when re-run alone, except
  host-restart, which fails alone as well and is unrelated (server/
  untouched). Full table in logs/shell-2026-11-13-LAI-1220.md. The cli workspace's failures are load
  failures (fetch failed, ECONNRESET, missed timing budgets); this branch
  changes nothing under cli/ or server/src/.
