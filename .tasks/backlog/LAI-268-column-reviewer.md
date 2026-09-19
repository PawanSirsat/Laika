---
id: LAI-268
title: 'A reviewer for a board column'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-263
status: backlog
---

## Goal

**The owner asked for a reviewer name on the Review column** ("Sana reviews" in
the reference) and chose to have it be real configuration rather than a derived
guess or a fixture.

Laika has no concept of a column owner. Tasks have an `assignee_id`; columns
have nothing at all — they are five values of `TASK_STATUSES`, not rows. So
there is nowhere for this name to come from.

## What is wanted

A per-project, per-column owner — one user who is named in that column's
header. Shape is CORE's; the board needs a `user_id` per column and absent
meaning "nobody named".

## Acceptance criteria

- [ ] A column owner can be set per project and read back, gated by the policy
      that already governs project settings.
- [ ] Returned alongside the project (or the same place LAI-267's limits land —
      the two are the same shape of thing and should not be two requests).
- [ ] Absent renders nothing rather than an empty name.
- [ ] SPEC §4 and §6.4 updated; the drift guards stay green.

## Notes / context

Filed by SHELL at the owner's direction. **The lowest-priority of the two
column-settings tasks** — a WIP limit is a working constraint; a named reviewer
is a label. If CORE builds one, building both at once is likely cheaper, since
they want the same table and the same endpoint.

**Worth pushing back on at review**: the same information may already exist in
the data — the people assigned to the tasks currently in Review are, in effect,
who is reviewing. A stored name can go stale against that. The owner chose
stored configuration knowing the derived alternative was on the table, so this
is not an oversight.
