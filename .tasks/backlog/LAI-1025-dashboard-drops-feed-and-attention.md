---
id: LAI-1025
title: 'The project Dashboard drops Recent activity and Needs attention, and the requests that fed only them'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

The owner (Pawan, 2026-11-01) asked for the **Recent activity** panel (tabs
All / People / Agents) and the **Needs attention** panel (tabs Blocked /
Stale / Waiting for review > 5 days) to come off every project's Dashboard:
they make the page slow to load. Everything else on the page stays, and so
does every endpoint another screen, tool or client still calls.

## Acceptance criteria

- [ ] The project Dashboard renders neither panel, and its grid has no empty
      cell where they were — light and dark, at 1440 and 390.
- [ ] Every request the dashboard made only for those panels is gone, and a
      test asserts the dashboard no longer makes it.
- [ ] Each endpoint that fed them is either deleted, with its route, unused
      service code, tests and guards, because nothing else calls it — or kept,
      with the other caller named in the PR. No guard is weakened.
- [ ] The activity log, the History tab, Inbox › Review and every MCP tool
      behave as before.
- [ ] SPEC §11.4.2's Dashboard row and §11.4.2.1's Dashboard paragraph (and
      §11.6's mention of the Dashboard's *Stale* tab) say what the page now is.
- [ ] Before and after: the dashboard's load requests and their server time,
      measured on a local instance, are in the PR.

## Notes / context

Named cross-area edits (D-033/D-034): `docs/SPEC.md` §11.4.2 (Dashboard row of
the screen → endpoint map), §11.4.2.1 (Dashboard paragraph), §11.6
(stale-task flagging's sentence naming the Dashboard's *Stale* tab).

Belka is shared: affected test files only, one at a time, single worker. CI is
the full gate.
