---
id: LAI-150
title: '`presence_enabled = 0` should discard the heartbeat, not store an inert one'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-207, LAI-430]
discovered-from: LAI-430
status: backlog
---

## Goal

§4.2, on `presence_enabled`:

> When 0, `POST /heartbeats` returns `202` and **discards**, and
> Presence/Capacity show a disabled state rather than an empty one.

**LAI-430 implements half of that.** With presence off it does **not** resolve
the branch — so `matched_task_id` stays null and `tasks.branch` is not written,
which is the part that would otherwise build the record of who was working on
what that the switch exists to prevent (D-005).

**But the heartbeat row is still inserted.** §4.2 says "discards", and a stored
row carrying user, token, repo and branch is not discarded — it is the same
metadata, minus the task link.

## Why LAI-430 did not do it

Its criteria are about branch→task resolution, and one of them asks only that
resolution *not be attempted* when presence is off. Not writing the row at all is
a wider change: it is the difference between storing nothing and storing
something inert, it changes what `POST /heartbeats` does rather than what it
resolves, and it interacts with §9.3's disabled state, which is LAI-432's.

Doing it inside LAI-430 would also have made that task's own tests ambiguous —
several assert the row lands regardless, which is right for a *degraded* branch
and wrong for a *disabled* org, and those are different rules.

## Acceptance criteria

- [ ] With `presence_enabled = 0`, `POST /api/v1/heartbeats` answers `202` and
      **writes no `heartbeats` row**.
- [ ] It is still `202`, not `403` or `409`. A plugin must not start reporting
      errors because an org turned presence off — §9.2's "degrades, never errors"
      applies to the whole endpoint, and an operator who disabled a feature does
      not want an alert storm.
- [ ] Turning it back on resumes writing, with no backfill of the gap. There is
      nothing to backfill: the rows were never taken.
- [ ] A test that the **route** returns `202` in both states, so the client
      contract is identical whether or not the org records anything.
- [ ] LAI-430's tests still pass unchanged — a branch that does not resolve still
      writes a row. **Degraded and disabled are different rules and must not be
      collapsed.**

## Notes / context

**Retention pruning (§11.6) is LAI-431** and is a different mechanism: it removes
old rows on a schedule. This is about never taking them.

**Check §9.3's disabled state with LAI-432.** "Disabled" and "nobody is working"
must render differently, and once no rows are stored the only thing that can tell
them apart is `presence_enabled` itself — so the views have to read the column,
not infer from an empty table.
