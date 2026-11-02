---
id: LAI-1087
title: 'Project setup: the step rail reads on one line a step beside the aside'
area: shell
assignee: unclaimed
priority: p2
depends-on: [LAI-1082]
discovered-from: LAI-1082
status: backlog
---

## Why

The owner, on production's Project setup tab (2026-11-02), with a screenshot:
*"in project setup that left part is not looking good its title coming on next
line fix that make it more good"*.

With the aside shown, `design.css` gives the rail card `11.75rem`. After the
card's padding, the step's padding and the 32px number, a step name has about
88px, so *Choose project & tool* and *Copy project prompt* break over two
lines and *Review & verify* over two, and the rail reads as a column of
broken words. Only Project setup passes an `aside`, so the narrow rail is its
alone.

## Goal

Beside the aside, each step's name is on one line, the rail is no taller than
the step card beside it, and the step card keeps enough room for its two
pickers side by side.

## Acceptance criteria

- [ ] At 1440 × 900 on step 1, each of the three step names in the rail is
      one line: its height is one line box.
- [ ] The aside is still beside the step at 1440 px and gone at 1040 px (the
      existing browser test stays green unchanged).
- [ ] The Add device and Add tool wizards, which pass no aside, are unchanged.
- [ ] The rail is still a strip of three under 53rem, and both themes draw it
      in tokens only, none new.
- [ ] A browser test pins the one-line names at 1440 px.

## Notes / context

`server/web/` only — SHELL's. The rail is Connect's `StepRail`; its rules stay
in `connect.css` untouched, and the design's look is scoped under
`.dx-wizard[data-aside='true']` in `developer/v3/design.css`.
