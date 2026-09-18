---
id: LAI-267
title: 'A WIP limit per board column'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-263
status: backlog
---

## Goal

**The owner asked for `WIP 3/4` on the In Progress column** and chose to have a
real limit rather than a rendered guess.

There is no WIP limit anywhere in Laika today: no column table, no project
setting, no field on `projects`, no endpoint. `grep -i wip server/src` returns
nothing. The `4` in `docs/design/Laika Prototype.dc.html` is a mockup number,
and `server/web/src/demo/wip.ts` exists only to say so — it is demo-gated under
D-032 and cannot reach a production build.

So the board can show a numerator today and has nothing true to put after the
slash. This asks for the denominator.

## What is wanted

A per-project, per-column limit an admin can set, and that `GET /projects/:slug`
returns so the board can render `WIP <count>/<limit>`.

Shape is CORE's to decide. The board needs only: which column, what number, and
absent meaning "no limit" — a column with no limit must render the count alone
rather than `3/0` or `3/∞`.

## Acceptance criteria

- [ ] A limit can be set per column for a project, by someone the policy
      permits, and read back.
- [ ] `GET /projects/:slug` carries the limits (or a documented sibling
      endpoint does), so the board needs one request rather than one per
      column.
- [ ] **Absent is a first-class answer.** No limit set must be distinguishable
      from a limit of zero, and SPEC §6.4 says which is which.
- [ ] SPEC §4 and §6.4 updated; `schema-spec-drift` and
      `response-type-coverage` stay green.
- [ ] The client type is paired in `view-type-drift.test.ts` when SHELL wires
      it (LAI-263's follow-up, not this task).

## Notes / context

Filed by SHELL at the owner's direction while rebuilding the board to the
design. **Not urgent for the board to ship**: until this lands, In Progress
renders `WIP 2` — the count with no denominator, which is true.

Whether a limit should *enforce* anything (refuse a move that would exceed it)
is a separate question and deliberately not asked here. The board wants to
display it; enforcement is a policy decision with its own consequences.
