---
id: LAI-1310
title: 'A toast for every action — one feedback contract, useAction, My day on the shared toast, a guard'
area: web
assignee: shell
priority: p1
depends-on: []
status: review
started: 2026-11-17T21:00:00Z
finished: 2026-11-18T01:55:00+02:00
---

## Goal

The owner: "add proper toast message for each and every action carried out".
~270 mutation call sites in `server/web/src`; ~10 use the shared toast
(LAI-1129). The rest end in inline banners, `SaveStatus`, a private My-day
toast, or nothing. Plan: `/Users/kvelld/.claude/plans/async-plotting-sketch.md` §A.

## The contract

- Every **explicit action** (button, menu item, drag, bulk action, confirm)
  ends in a toast: success names what happened (past tense, ≤6 words, names
  the thing), errors persist with the server's sentence as `detail`, **Undo**
  only where the server can really reverse it (LAI-1129 rule 2).
- **Auto-saving fields** (inline edits, `SaveStatus` forms) keep their in-place
  status; their **errors** also toast.
- Field-level 422s stay inline; the toast says *Couldn't save — see the
  highlighted field*.

## Acceptance criteria

- [x] `components/toast/use-action.ts`: `useAction().run({ do, success, undo?, failure? })`
      on top of `useToast`, with a model test.
- [x] Every area migrated: board/list/calendar, task drawer/workroom, sprints,
      my day/time, inbox/review/usage/notifications, organisation, space settings,
      spaces/projects, developer access/tokens, profile admin, auth/setup.
- [x] The private My-day toast is gone; its Undo flows use the shared toast;
      `toast-single-source.test.ts`'s NOT_YET_MIGRATED entry is deleted.
- [x] The silent ones speak: watch/unwatch, hide-done, mark notice read,
      sign-out failure.
- [x] Guard `test/components/toast/action-feedback.test.ts`: every file that
      calls a mutating `api/*` function goes through `useAction`/`useToast`/
      `useSaveStatus`, or is on an exact-count, reasoned allow-list.
- [x] Existing browser tests updated where feedback moved; typecheck, lint,
      format, web unit and the affected browser suites exit 0.

## Outcome

- Seven feature commits, one per area, plus the foundation; see
  `logs/shell-2026-11-18-LAI-1310.md`.
- The guard's allow-list holds three reasoned entries, each of which hands its
  writes to code that toasts: `TaskDrawerHost.tsx` (useLocalMoves),
  `calendar-drag.ts` (a pure helper whose caller runs it through useAction) and
  `SpaceSettingsScreen.tsx` (MembersTab). No "not migrated yet" entry is left.
- Added at the owner's word on 2026-11-18: toasts sit at the **bottom centre**
  at every width, and an error toast on a SaveStatus form carries **Retry**
  (a persistent centred toast can cover the form's own Retry).
- Deliberately not toasted: Project setup's Save-access error stays the inline
  `ApiErrorState` (its Try again re-sends the kept choice); LoginRoute gained no
  sign-in failure toast; the classic Tokens tab toasts but no browser test opens it.
