---
id: LAI-613
title: Decide - per-project custom statuses and board columns (a testing column)
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-605
status: backlog
---

## Goal

A decision, before any code: the status enum is fixed
(`backlog|todo|in_progress|review|done|cancelled`) with a validated transition
graph (SPEC §5), and a real consumer wants a `testing` column between
`in_progress` and `review`, configured per project. Granting it touches the
schema, the policy graph, every status-coloured surface in the web client, and
the MCP/REST contracts - it is a SPEC change with at least three owners, not a
tool addition.

## Acceptance criteria

- [ ] CHIEF (with the owner) decides: custom statuses per project, a fixed
      richer enum (add `testing`), or no. Recorded in DECISIONS.md.
- [ ] If yes in either form: SPEC §5 amended, and implementation tasks filed
      for CORE (schema, transitions, `update_status` accepting configured
      values) and SHELL (board columns, status colours, filters) with the §4.4
      multi-owner procedure named in each.

## Notes / context

- From the same agent brief as LAI-611/612. The fixed-enum-plus-`testing`
  option is much cheaper than fully custom workflows and satisfies the stated
  need; worth weighing first.
