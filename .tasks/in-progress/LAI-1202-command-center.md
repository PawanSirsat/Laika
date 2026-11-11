---
id: LAI-1202
title: 'Command Center v1 at /home: what needs you, your work, your agents, blocked, coming up and recent activity, from existing data'
area: shell
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-11-11T09:00:00Z
---

## Goal

A first Command Center at `/home` (proposal `ia-command-center-proactive.md`
§2): one page that answers "what needs me, and what do I do next", built only
from endpoints that exist today. Every row is actionable; every count links to
the filtered full view; no vanity metric cards. UI only, `server/web/` only, no
new endpoints, no new dependencies, no demo data. `/home` is **not** made the
default landing route here — the owner decides that.

## Acceptance criteria

- [ ] `/home` is a route in `route-table.ts`, in the sidebar's HOME group, and
      registered in `ScreenOutlet`'s `SCREENS`; the default landing route is
      unchanged.
- [ ] **Needs your attention**: review items awaiting the reader, hand-offs
      awaiting their approval, and their overdue tasks; each row opens the
      review dialog, the hand-off or the task.
- [ ] **Your active work**: tasks assigned to the reader in progress / up next
      across spaces; each opens its task in its own space.
- [ ] **Agents**: the reader's own agents with their claim and connection state
      only as the API reports it; "Connection lost" only from real heartbeat
      data.
- [ ] **Blocked**: the reader's tasks with an unfinished dependency, naming the
      blocker and its owner.
- [ ] **Coming up**: tasks due in the next 7 days (a client-side filter of data
      already fetched; the missing server due-date filter is noted as a gap).
- [ ] **Recent activity** across the reader's spaces, bounded, linking out.
- [ ] Each section: skeleton while loading, its own error with Retry that keeps
      last data, a quiet one-liner when empty, absent without permission; one
      failing section leaves the rest.
- [ ] Counts in headers link to the filtered full view; no metric cards.
- [ ] Polling reuses the shared approach and pauses while the tab is hidden; no
      new `EventSource`.
- [ ] Both themes, existing surface tokens only (no `theme.css` edits), 390 one
      column with attention first, 1024 / 1440 two columns; landmarks,
      headings, list semantics; reduced motion.
- [ ] Unit tests for the derivations; Playwright tests for each section,
      permission hiding, empty one-liners, row actions, one failing section and
      the 390 order; each key behaviour mutated once to prove a test fails.
- [ ] Gate green: lint, format, web typecheck, and the web test script in four
      shards.
