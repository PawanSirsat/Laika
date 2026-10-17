---
id: LAI-763
title: 'Cleanup release review follow-ups: refused writes count as presence, archived-space chips, a dead toolbar rule, a stale comment, a brittle README test (server/ + server/web/)'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-755, LAI-756, LAI-730, LAI-744]
discovered-from: LAI-756
status: backlog
---

## Goal

The non-blocking findings from the 17 Oct review of the cleanup release are
fixed, so presence only reflects writes that actually happened, every Capacity
chip opens its own space, and the toolbar CSS and comments say what the code
does. Filed by CHIEF (Omnigent) on the owner's direct instruction.

## Acceptance criteria

- [ ] A token write counts as presence only when it succeeded (2xx), stamped
      after the handler, not before rate limiting, the setup gate,
      idempotency and `can()`. A refused 403, 404, 422 or 429 write, including
      a POST from a `read_only` token, never stamps. Decide and record (in
      D-081's successor or the SPEC) whether `PUT /me/local-activity` and
      `PUT /me/activity-sharing` count; the reviewer suggests not.
- [ ] A Capacity chip for an in-progress task in an archived space, and a chip
      clicked before the space list has loaded, still opens the task in its
      own space (today both fall back to `/board?q=KEY` on the last space
      opened, `CapacityScreen.tsx:132`).
- [ ] `board-toolbar.css:580`: the `.bt-members { margin-inline: 0 }` rule
      inside the container block is overridden by the later base rule
      (`:712-720`). Move it after the base rule or delete it and the part of
      the comment at `:574-575` that credits it; re-measure search width at
      920px and 1024px with the sidebar open.
- [ ] `SprintStats.tsx:57` no longer says the toolbar wraps "below 47.5rem"
      (it wraps under 40rem of the row's width).
- [ ] The README badge test does not fail on a badge colour written as hex
      with digits (for example `MCP-server-1f6feb`).
- [ ] Each behaviour change has a test that fails without it; full gate green.

## Notes / context

Source: the review of branch `build-cleanup` (head 5be657aa), merged to master
on 17 Oct. Board card to be created alongside this file.
