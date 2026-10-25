---
id: LAI-522
title: 'One confirmation popup, everywhere something is taken away — Delete entry and Discard timer first; every window.confirm replaced'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-515
status: backlog
---

## Goal

The owner, 2026-10-25: *"we have delete entry feature but that's not showing
the confirmation pop up — I want that, make it good, add it everywhere in the
website where needed."* My day's *Delete entry* and *Discard timer* act at
once; seven screens ask through the browser's own `window.confirm`, which
cannot be styled, themed or named; one good dialog lives only in
Organisation. Make one popup and use it wherever something is taken away.

## Acceptance criteria

- [ ] A shared confirmation popup in `components/`: a title, a sentence on
      what happens, an optional summary of the thing affected, Cancel and a
      red action; Escape and the backdrop cancel; focus starts on Cancel and
      stays inside; both themes; on a phone the buttons stack full width.
- [ ] A hook any screen can await — `confirm({…})` resolves true or false —
      so a `window.confirm` becomes one line.
- [ ] My day: *Delete entry* and *Discard timer* ask first, naming the entry
      or the time that would be lost.
- [ ] Every `window.confirm` in `server/web/src` is replaced: none is left.
- [ ] Clearing the plan limit and removing or resetting a model price ask
      first.
- [ ] Organisation's dialog (role changes, revoke invite, transfer) is the
      shared one, as it already behaves.
- [ ] Browser tests for My day's two and for one replaced `window.confirm`;
      the gate green.

## Notes / context

Already confirmed inline and left as they are: deleting a sprint, leaving a
space, archiving a space, the admin panel's sign-out / revoke / remove, and
turning *Draft my time* off. Actions with Undo or that are put back with one
click (Not work time, a break, a dependency, unwatching) stay one click.
