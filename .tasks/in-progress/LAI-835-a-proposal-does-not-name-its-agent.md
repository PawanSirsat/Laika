---
id: LAI-835
title: 'An agent''s proposed time does not say which agent proposed it'
area: server
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-831
status: in-progress
started: 2026-10-21T11:52:24Z
---

## Goal

The owner's My day design (LAI-831) says "Proposed by claude-code" in the
inspector and shows a `claude-code` badge on the row. LAI-831 says "Proposed
by an agent" and `agent`, because nothing serves the name.

## Found (LAI-831's census)

`propose_time_entry` and `POST /me/time-drafts` store `source: 'agent'` and
nothing about the token that sent it (`time_drafts` has no column for it), so
the person cannot tell one agent's proposal from another's.

## Acceptance criteria

- [ ] A proposal keeps the proposing token's client name, as tokens already
      record a client (`created_by_client`-style), never free text from the
      agent.
- [ ] `GET /me/time` serves it on the draft, to the person alone.
- [ ] My day shows it in the inspector and on the row's badge.
- [ ] Tests fail on today's code; the gate exits 0.
