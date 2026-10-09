---
id: LAI-735
title: 'UI polish — the List card gets a visible edge, and no blank band above Create task'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: done
started: 2026-10-08T19:48:24Z
finished: 2026-10-08T19:52:14Z
---

## Goal

Made on the owner's direct instruction; UI polish. The builder is a single
agent on branch `build-ui-list-card`, cut from `origin/master` ed1e884;
nothing here is pushed.

The owner's screenshot of the List (light mode) shows two problems:

1. The table card's edge is the same colour as the page, so it reads as a
   smudge rather than a card.
2. A band of empty card sits between the last task row and the pinned
   `+ Create task` row, with its own divider line. Create should sit directly
   under the last row with a single divider, and the card should not be inset
   from the toolbar above it.

## Scope — the exact files (CLAUDE.md §1)

- `server/web/src/routes/screens/list/list.css`
- `server/web/src/routes/screens/list/ListView.tsx` — comment only
- `server/web/test/browser/list-create-row.test.ts` — the few-rows test

## Acceptance criteria

- [x] The card's border uses an existing token that is visible against the
      canvas, in light and dark.
- [x] With few rows, nothing selected, the Create row starts within 1px of the
      last row's bottom and ends on the card's foot.
- [x] With many rows, the Create row stays pinned while the rows scroll and
      never hides the last row (the existing LAI-717 tests still pass).
- [x] The bulk bar's room still applies only while rows are selected, and the
      bulk bar never covers the Create row or the last row.
- [x] The card lines up with the toolbar's edges, with no extra padding from
      the List pane.
- [x] The changed test fails on the old CSS. Each of its two new assertions
      has been run against the old CSS on its own.
- [x] Screenshots before and after, light and dark, few and many rows.
- [x] Repo gate `pnpm test`, `pnpm lint`, `pnpm format` exits 0/0/0.

## Builder notes

**Root cause of the gap.** It was neither the bulk bar's room nor a padding.
`.list-bulk-room` renders only while rows are selected, and nothing set a
`padding-bottom`. The cause was LAI-717's own layout: `.list-card` was
`flex: 1 1 auto`, so it stretched to the pane, and `margin-top: auto` on
`.list-create` pushed the Create row to that foot. The pane's free space
therefore landed between the last row and Create. It measured 191px under 8
rows and 349px under 1 row at 1440x900.

**The fix.** `.list-card` is now `flex: 0 1 auto`, so it is as tall as its
rows and shrinks to the pane once they overflow. `margin-top: auto` is gone,
because there is no free space left for it to take. The empty List (no
`.list-card`, `.state` is `flex: 1`) is unchanged. LAI-717's rule, Create on
the card's foot, still holds: the foot is simply under the last row now. The
pager follows the card up.

**The edge.** Dashboard's `.dash-card` uses the same `--border-subtle`, so
matching it would have changed nothing. Measured at 1440x900, the light edge
pixel was (233,234,236) against the canvas's (238,240,246). The card now uses
`--border-default`, an existing token defined in both themes.

**Outer padding.** `.list-pane` had `14px 18px 18px` on top of `.board-main`'s
own padding. That inset the card 18px from each toolbar edge (card 248-1404,
toolbar 230-1422) and doubled the gap above it. It is now `0`, and the card
spans 230-1422.

**Test.** In `list-create-row.test.ts`, "few rows" now asserts gap <= 1px and
a card border alpha >= 0.15 in both themes. Each assertion was run against the
old CSS and failed on its own. With the whole old `list.css`: `a 349px band of
blank card between the row and Create`. With only the border reverted:
`light: the card's border is too faint to see — rgba(15, 23, 42, 0.09)`.

**Screenshots.** `/tmp/laika-ui-list-card-shots/{before,after}-{light,dark}-{8,60}rows.png`,
stubbed-API harness at 1440x900.

**Gate.** The first full `pnpm test` exited 0: web 1632/1632, server
2176/2176, cli 98 passed. The final run, after a comment-only edit and the
task/log text, exited 1. Its only failures were the four tests in
`server/test/tooling/build.test.ts`, each `built server never became healthy`,
which is the known boot timeout under load. Re-run alone
(`vitest run test/tooling/build.test.ts`) it exited 0 with 15/15. On that
final tree `pnpm lint` exited 0 and `pnpm format` exited 0.

## Accepted

2026-10-09, by polly (orchestrator), for release 4. Review: APPROVED by
independent review. Integrated on `build-release-4`; the only conflict was
`logs/chief-2026-10-09.md`, resolved by keeping every entry in timestamp
order.
