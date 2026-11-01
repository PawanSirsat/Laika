---
id: LAI-584
title: 'Inbox › Review lists only the oldest 200, so a task just finished cannot be accepted from the queue'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-582
status: backlog
---

## Goal

A person can reach and accept any task waiting for review from Inbox › Review,
however many are waiting — including the one an agent finished a minute ago.

## Acceptance criteria

- [ ] The review queue can reach every waiting task (a cursor, or a newest-first / per-project view that is not capped below the waiting count)
- [ ] With more than 200 waiting, a task finished just now can be found and accepted from Inbox › Review in the web app
- [ ] The "first 200" wording stays honest about whatever cap remains
- [ ] Repo-root gate exits 0

## Notes / context

Measured live on production in LAI-582, 2026-10-28: 200+ tasks wait for
review, the screen reads "200 waiting · oldest first · first 200", and the
Project filter set to Laika still shows "first 200". The sandbox card LAIKA-836,
finished to Review by an agent with `finish_task`, was not in the list, so it
was accepted from the task drawer's Status control instead.

`server/src/services/review.ts` returns `{ tasks, truncated }` with no cursor
(`:192`); `ReviewScreen.tsx:198` prints the cap. Likely two owners (server
cursor, web paging) — split if so, per CLAUDE.md §4.4.

Not part of the agent-identities programme; found while accepting its sandbox.
