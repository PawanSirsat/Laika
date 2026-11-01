---
id: LAI-319
title: 'my-day-header "light: a phone walks the days" reads the desktop week before the 390 px layout has hidden it'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-565
status: backlog
---

Filed by Strelka while gating LAI-565, 2026-10-29.

## Why

The repo-root `pnpm test` on branch `LAI-565-agents-tab-shared-components`
failed once in `server/web/test/browser/my-day-header.test.ts:368` —
`.myday-week-weekday` still visible (`false !== true`) — with 3581 of 3582 web
tests passing and the dark twin of the same test green. The file alone passed
three runs out of three. LAI-565 touches no My Day code.

The test resizes to 390 px and `until`s only `[data-day-nav]` visible, then
reads `.myday-phone-letter` and `.myday-week-weekday` once each. Under a full
gate's load the desktop week can still be laid out at that read.

## Scope

- `server/web/test/browser/my-day-header.test.ts` only: wait for the state the
  assertions read (the phone row shown **and** the week hidden), with the
  file's own timeout, before asserting. No product change.

## Acceptance criteria

- [ ] The phone-layout reads wait for the layout they assert, not for a
      sibling of it.
- [ ] The assertions still fail when the week stays visible at 390 px
      (mutate the CSS, watch it go red).
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
