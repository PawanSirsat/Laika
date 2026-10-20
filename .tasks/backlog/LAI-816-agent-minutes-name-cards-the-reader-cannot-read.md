---
id: LAI-816
title: "My day's agent minutes name cards the reader cannot read: the server sends their titles"
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-810
status: backlog
---

## Goal

`GET /me/time` names a card in *Agent minutes* only when the reader can read
it, as it already does for drafts. Today `agentDay` builds `by_task` from
`token_session_tasks` joined to `tasks` and `projects`
(`server/src/services/agent-time.ts`, the `splits` read), with no visibility
check. So a session the reader ran on a branch named after a card in a space
they cannot read, or can no longer read, sends that card's key **and title**.

## What LAI-810 found

Review round 1 asked My day to link an agent-minute row only when the reader
can read the card. The client now decides that from the card's key prefix
against `GET /projects`, which lists only readable spaces, with prefixes
unique per organisation. An unreadable card shows as `SEC-9 (not a card you
can see)`: no link and no title. **The title still arrives in the payload.**
The client hiding it is not the boundary; the server is.

## Acceptance criteria

- [ ] `by_task` carries a card only if the reader can read it
      (`canSeeProject`, i.e. `can()` with `project.read`, as drafts resolve
      their cards). Minutes on a card they
      cannot read are kept but unnamed: as `unattributed_minutes`, or as a row
      with the key and no title, matching how a draft says `task_key`. The
      choice goes in SPEC §6.4's `GET /me/time` shape.
- [ ] A server test: a session tied to a task in a private space the reader is
      not in yields no title for it.
- [ ] `server/web/src/api/time.ts` mirrors the shape, if it changes.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format`, each exiting 0.
