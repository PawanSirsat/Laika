---
id: LAI-313
title: 'With LAI-853, a body refused for a wrapped task-list item names a bullet line the check already forgives'
area: shell
assignee: unclaimed
priority: p3
depends-on: [LAI-853]
discovered-from: LAI-312
status: backlog
---

## Goal

When the rich editor refuses a document, the notice names the line that
actually stops it.

## What was measured (2026-10-21, a trial merge of LAI-312 and LAI-853, built on Strelka)

The LAIKA-439 body (LAI-312's `IMPORTED` fixture) has two kinds of wrapped
list item:

- bullets wrapped onto a 2-space line, which LAI-853 forgives;
- task-list items wrapped onto a 6-space line, which it does not (LAI-302).

With both branches merged:

| Source | Opens | Notice |
| --- | --- | --- |
| the body as stored | Markdown | *"would rewrite line 25: “  CLI shipped in LAI-422 on 2026-09-02.” as “CLI shipped…”"* |
| the same, task items unwrapped | **rich**, untouched save byte-exact | — |

Line 25 is a bullet continuation that LAI-853 forgives, so it is not what
refuses the body. `firstDifference` compares texts without the forgiveness
`sameMarkdown` applies (`unindentContinuations`), so it names the first
forgiven indent instead of the task item.

## Acceptance criteria

- [ ] On the body above, the notice names a line of the wrapped task item,
      or LAI-302 makes the body open rich and this is closed as moot.
- [ ] A test with that body, run red first.

## Notes / context

- Moot if LAI-302 lands first and the body opens rich. Check that before
  starting.
