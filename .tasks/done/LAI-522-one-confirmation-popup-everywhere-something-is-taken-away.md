---
id: LAI-522
title: 'One confirmation popup, everywhere something is taken away — Delete entry and Discard timer first; every window.confirm replaced'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-515
status: done
started: 2026-10-25T09:21:51Z
finished: 2026-10-25T09:56:40Z
---

## Goal

The owner, 2026-10-25: *"we have delete entry feature but that's not showing
the confirmation pop up — I want that, make it good, add it everywhere in the
website where needed."* My day's *Delete entry* and *Discard timer* act at
once; seven screens ask through the browser's own `window.confirm`, which
cannot be styled, themed or named; one good dialog lives only in
Organisation. Make one popup and use it wherever something is taken away.

## Acceptance criteria

- [x] A shared confirmation popup in `components/`: a title, a sentence on
      what happens, an optional summary of the thing affected, Cancel and a
      red action; Escape and the backdrop cancel; focus starts on Cancel and
      stays inside; both themes; on a phone the buttons stack full width.
- [x] A hook any screen can await — `confirm({…})` resolves true or false —
      so a `window.confirm` becomes one line.
- [x] My day: *Delete entry* and *Discard timer* ask first, naming the entry
      or the time that would be lost.
- [x] Every `window.confirm` in `server/web/src` is replaced: none is left.
- [x] Clearing the plan limit and removing or resetting a model price ask
      first.
- [x] Organisation's dialog (role changes, revoke invite, transfer) is the
      shared one, as it already behaves.
- [x] Browser tests for My day's two and for one replaced `window.confirm`;
      the gate green.

## Notes / context

Already confirmed inline and left as they are: deleting a sprint, leaving a
space, archiving a space, the admin panel's sign-out / revoke / remove, and
turning *Draft my time* off. Actions with Undo or that are put back with one
click (Not work time, a break, a dependency, unwatching) stay one click.

## Build notes and acceptance (CHIEF, 2026-10-25)

- `components/ConfirmDialog.tsx` (Organisation's, moved and given a mark, a
  summary card and a phone layout) and `components/ConfirmProvider.tsx`
  (`useConfirm()`), mounted in `App.tsx`.
- My day's *Delete entry* names the task, its time and length; *Discard
  timer* names what it was on and how long it ran. On a phone Discard is
  hidden while a timer runs (LAI-518), so the phone check uses Delete entry.
- Every `window.confirm` replaced (eight calls in seven files); clearing the
  plan limit and removing or resetting a model price ask.
- Found on the way: the dialog's focus never reached Cancel — a selector list
  answered the wrapper span, first in document order. Fixed for Organisation
  too.
- Tests: `confirm-dialog.test.ts` (new) and the five suites that answered the
  browser's native dialog, now answering the app's (`test/browser/confirm.ts`).
  Released on the owner's word: "push".
