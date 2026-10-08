---
id: LAI-725
title: 'Timeline: the space bar''s Priority, tag, Anyone and Ready filters show there and filter nothing'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-721
status: backlog
---

## Goal

On `/timeline` the space bar (`SpaceTopBar`) draws Search, `Priority: all`,
`Any tag`, `Anyone` and `Ready only` — visible in the owner's production
screenshots of 2026-10-08 — and the Timeline reads none of them: it did not
before LAI-721 and does not after. A control that changes nothing on the
screen it sits on reads as broken.

Decide one of: hide them on the Timeline (as the Board hides the bar's copy
behind its own toolbar), or make them narrow what an opened sprint lists.

## Acceptance criteria

- [ ] On `/timeline`, every filter the space bar shows changes what the
      Timeline shows, or the bar does not show it there — asserted in a
      browser test either way.
- [ ] Whatever is chosen does not reintroduce a whole-project task walk
      (LAI-721, D-074): filtering applies to a sprint's tasks as it is opened.

## Notes / context

- Found while building LAI-721; out of its scope.
- `space-bar.test.ts` and `space-chrome-compaction.test.ts` currently assert
  the Timeline keeps these filters in the bar, so a decision to hide them
  re-aims those tests on purpose.
