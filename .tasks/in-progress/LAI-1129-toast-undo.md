---
id: LAI-1129
title: 'One shared Toast/undo, SaveStatus and InlineConfirm, applied to Review Accept, space/org settings saves and token-alert dismissal'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-1124
status: in-progress
started: 2026-11-04T12:00:00Z
---

## Goal

Feedback for a change is one implementation, not one per screen. Build a
shared `ToastProvider` + `useToast()` (mounted once in the app shell), a
`SaveStatus` primitive and one `InlineConfirm`, delete the private copies
they replace, and apply them where the audit found missing or dishonest
feedback (B9, B11, B12). Undo is offered only where a real reversing API
exists; nothing is faked client-side. The PR targets
`integration-ui-transformation`, not `master`.

Specs: `docs/ux/architecture/component-architecture.md` §2 (Toast,
InlineConfirm, ApprovalBar) and `docs/ux/design-system/interaction-contracts.md`
(states 4, 13; Toasts, Forms, Approval controls) on `LAI-1124-ux-docs`.

## Acceptance criteria

- [ ] `components/toast/` holds `ToastProvider` + `useToast()`, mounted once in
      `App.tsx`: a queue, `role="status"` for info/success and `role="alert"`
      for errors, an optional real Undo button with a countdown (10 s
      default), paused on hover and focus, a keyboard-reachable dismiss
      button, never moves focus, errors persist, tokens only in both themes,
      `prefers-reduced-motion` honoured, layered above dialogs.
- [ ] `MembersTab`'s private toast and `PeopleTab`'s org-role undo strip are
      migrated onto it and their private copies deleted. My day's toast is
      left for a follow-up (LAI-1130 is editing My day), named in a TODO.
- [ ] A single-source guard test fails when a screen draws its own toast
      outside the provider (My day allowed until migrated).
- [ ] Review Accept: the server has no genuine reversal (done → review via
      `/status` leaves the `accepted` decision row in `task_reviews`), so
      Accept asks first through `useConfirm`, then reports the
      server-confirmed result in a toast. No client-side fake undo.
- [ ] Review "Open on board" leaves a modified click (cmd/ctrl/shift/alt,
      middle button) to the browser, as the Sidebar does.
- [ ] `SaveStatus` ("Saving… / Saved / Couldn't save — Retry", polite live
      region) is applied to space-settings General, Access and Danger and to
      `organisation/OrgNameFact.tsx`.
- [ ] General has a dirty-state guard: switching Space settings tabs asks
      first, and `beforeunload` is armed while there are unsaved changes.
- [ ] One `InlineConfirm` (moves focus in, labels its question, Escape and
      Cancel return focus to the trigger) replaces the inline alertdialogs in
      DangerTab, MembersTab and AccessTab.
- [ ] Usage › AlertsBanner dismissal says so in a success toast; no Undo and no
      confirm, since no un-dismiss endpoint exists.
- [ ] Unit tests (queue, timers, undo callback, pause) and browser tests
      (accept confirm path; settings Saved and Retry; dirty guard; inline
      confirm focus; cmd-click; toast keyboard dismiss; reduced motion).
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 (CI
      authoritative if the host's load times out untouched tests).

## Notes / context

No new dependencies. Parallel tasks own: drawer/SpaceLayout/TaskDetailPanel
(LAI-1127), error states in Calendar/Activity/Capacity/Unlisted/Advanced
(LAI-1128), My day/Insights/first-space/v3 buttons (LAI-1130), /design trial
(LAI-1131). Do not touch those.
