---
id: LAI-1202
title: 'Command Center v1 at /home: what needs you, your work, your agents, blocked, coming up and recent activity, from existing data'
area: shell
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-11-11T09:00:00Z
finished: 2026-11-11T13:30:00Z
---

## Goal

A first Command Center at `/home` (proposal `ia-command-center-proactive.md`
§2): one page that answers "what needs me, and what do I do next", built only
from endpoints that exist today. Every row is actionable; every count links to
the filtered full view; no vanity metric cards. UI only, `server/web/` only, no
new endpoints, no new dependencies, no demo data. `/home` is **not** made the
default landing route here — the owner decides that.

## Acceptance criteria

- [x] `/home` is a route in `route-table.ts`, in the sidebar's HOME group, and
      registered in `ScreenOutlet`'s `SCREENS`; the default landing route is
      unchanged.
- [x] **Needs your attention**: review items awaiting the reader, hand-offs
      awaiting their approval, and their overdue tasks; each row opens the
      review dialog, the hand-off or the task.
- [x] **Your active work**: tasks assigned to the reader in progress / up next
      across spaces; each opens its task in its own space.
- [x] **Agents**: the reader's own agents with their claim and connection state
      only as the API reports it; "Connection lost" only from real heartbeat
      data.
- [x] **Blocked**: the reader's tasks with an unfinished dependency, naming the
      blocker and its owner.
- [x] **Coming up**: tasks due in the next 7 days (a client-side filter of data
      already fetched; the missing server due-date filter is noted as a gap).
- [x] **Recent activity** across the reader's spaces, bounded, linking out.
- [x] Each section: skeleton while loading, its own error with Retry that keeps
      last data, a quiet one-liner when empty, absent without permission; one
      failing section leaves the rest.
- [x] Counts in headers link to the filtered full view; no metric cards.
- [x] Polling reuses the shared approach and pauses while the tab is hidden; no
      new `EventSource`.
- [x] Both themes, existing surface tokens only (no `theme.css` edits), 390 one
      column with attention first, 1024 / 1440 two columns; landmarks,
      headings, list semantics; reduced motion.
- [x] Unit tests for the derivations; Playwright tests for each section,
      permission hiding, empty one-liners, row actions, one failing section and
      the 390 order; each key behaviour mutated once to prove a test fails.
- [x] Gate green: lint, format, web typecheck, and the web test script in four
      shards.

## Notes for review

- **Not the landing route.** `DEFAULT_PATH` is still `/board`; making `/home`
  the default is the owner's call.
- **Counts that span spaces** lead to Organisation → Work filtered to the
  reader, which has no overdue, blocked or due-window filter, so the list
  there is a superset. One space leads to that space's List (`overdue`,
  `blocked`) or Calendar. Closing that needs `overdue`, `blocked` and
  `due_before`/`due_after` on `GET /tasks` (server).
- **Coming up** is a client-side filter of the reader's own open tasks; the
  server has no due-date filter.
- **Agents** are the reader's own only (`GET /agents` is `agent.read_own`);
  connection is the newest session's server word from `GET /agents/:id`;
  claims shown are those on the reader's own tasks.
- `GET /activity` now has a browser caller, so LAI-237 (*org-wide activity
  feed unused*) can likely be closed.
- Review queue rows come from the shell's own read (the sidebar badge), not a
  second request.
