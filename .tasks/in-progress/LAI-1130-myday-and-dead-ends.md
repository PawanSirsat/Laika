---
id: LAI-1130
title: 'My day with time tracking off shows your work; small dead ends and correctness fixes'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-1124
status: in-progress
started: 2026-11-04T14:00:04Z
---

## Goal

The UX audit (LAI-1124, `docs/ux/audit/ux-audit.md`; V2, B7, B8, B10, B21,
B23) found My day a dead end when the organisation has time tracking off,
and a handful of small correctness issues around it. Fix them in
`server/web/` only — no server change, no new dependency.

## Acceptance criteria

- [ ] V2: with time tracking off, My day lists the reader's open work under
      *On your plate* — overdue first, then due soon, then in progress, then
      the rest — read from `GET /tasks?assignee=<me>` per open status, each
      row opening the task in its own space through `taskHref`. A compact,
      non-blocking note says time tracking is off; its settings link shows
      only to a reader holding `org.time.set` (from `GET /permissions`, never
      the role). Header controls that do nothing in this state are hidden,
      and at 390px there is no week strip with *nothing yet*.
- [ ] B7: a failed re-read of a day already on screen keeps that day and
      shows a stale notice with Retry; a first read that fails is still the
      error card.
- [ ] B8: the sidebar's Insights badge (token alerts) leads to
      `/insights?tab=usage`, the Usage tab shows the count, and the badge's
      accessible text names alerts, not *waiting*.
- [ ] B21: with no spaces, the sidebar still shows SPACES with *Create a
      space* for a reader holding `project.create`, and the board's empty
      state offers the same; neither appears without the capability.
- [ ] B10: v3 *Reconnect (new credential)…* and *Disconnect device…* say why
      they are unavailable (visible text, `aria-describedby`) and are truly
      disabled rather than silent.
- [ ] Profile's permission-denied copy names the grant, not *admin*; the
      first field is focused on Login, First boot, Invite and Reset
      password; the stale comment in `routes/nav-permissions.ts` is fixed.
- [ ] Playwright (stubbed API) covers each of the above, and each new test
      is shown to fail with its fix reverted.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes

Parallel work not to touch: drawer / SpaceLayout / TaskDetailPanel /
ScreenOutlet task links (LAI-1127), error states in Calendar / Activity /
Capacity / Unlisted / Advanced (LAI-1128), shared toast and ReviewScreen and
settings tabs (LAI-1129), `/design` (LAI-1131). In `BoardScreen.tsx` only
the empty-state JSX changes. PR base is `integration-ui-transformation`.
