---
id: LAI-1128
title: 'Load failures are recoverable and honest: Calendar, Activity, Capacity, Unlisted, Developer › Advanced'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-1124
status: review
finished: 2026-11-05T11:11:00Z
started: 2026-11-04T13:59:55Z
---

## Goal

The UX audit (LAI-1124, `docs/ux/audit/ux-audit.md` B5, B6, B15) found
screens that lie about a failed read or never recover from one: Calendar and
Activity draw a load error as an empty view with no retry; Capacity and
Unlisted keep an error on screen after the next read succeeds and offer no
retry; Unlisted's promote takes the space as free text with a fixture-like
placeholder and Enter does nothing; Developer › Advanced's credentials error
has no retry. Make every one of these failures say what happened, offer a way
back, and recover without a reload.

## Acceptance criteria

- [x] Calendar and Activity read their tasks through one
      `useTaskSummaries(slug)` hook with three states (loading, ok, error);
      an error renders `ApiErrorState` with *Try again*, never an empty
      calendar or "no tasks", and *Try again* recovers.
- [x] A shared `usePolled(fetcher, { ms, keepOnError, pauseWhenHidden })`
      in `server/web/src/api/` clears its error on a successful read, keeps
      the last good data on a failed re-read and says it is stale, offers a
      retry, and does not poll while the tab is hidden. Capacity and Unlisted
      use it; no other poller is migrated in this task.
- [x] Capacity: a failed first read shows `ApiErrorState` with *Try again*;
      a failed re-read keeps the cards and shows a stale notice with
      *Try again*; the next good read clears both.
- [x] Unlisted: the same three behaviours as Capacity.
- [x] Unlisted promote: the space is a `Dropdown` of the spaces the reader
      may create tasks in (`GET /projects` and `task.create` from
      `GET /permissions`); the form is a `<form>`, so Enter submits; a
      disabled *Create task* says why.
- [x] Developer › Advanced: the credentials error has *Try again*. Developer
      › Tools: the two empty states use `components/EmptyState.tsx` rather
      than hand-rolled `dx-empty` markup.
- [x] Unit tests for `useTaskSummaries`'s mapping and `usePolled`'s
      controller (error → retry → ok, keepOnError, hidden pause); browser
      tests per screen for first-load failure + retry, Capacity and Unlisted
      stale re-read + recovery, and the promote picker, Enter and the disabled
      reason — each shown to fail with the fix reverted.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

SHELL's area only: `server/web/`. No new dependency. Out of scope, owned by
parallel tasks: the drawer host, SpaceLayout, TaskDetailPanel, ScreenOutlet
(LAI-1127); toasts, ReviewScreen, settings tabs (LAI-1129); MyDay, the
Insights badge, first-space and the v3 Tools/Devices *buttons* (LAI-1130);
`/design` (LAI-1131). PR base is `integration-ui-transformation`.
