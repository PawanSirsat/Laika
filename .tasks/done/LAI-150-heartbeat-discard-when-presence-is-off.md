---
id: LAI-150
title: '`presence_enabled = 0` should discard the heartbeat, not store an inert one'
area: server
assignee: core
priority: p2
depends-on: [LAI-207, LAI-430]
discovered-from: LAI-430
status: done
started: 2026-09-02T03:30:00Z
finished: 2026-09-02T03:55:00Z
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

- [x] With `presence_enabled = 0`, `POST /api/v1/heartbeats` answers `202` and
      **writes no `heartbeats` row**.
- [x] It is still `202`, not `403` or `409`. A plugin must not start reporting
      errors because an org turned presence off — §9.2's "degrades, never errors"
      applies to the whole endpoint, and an operator who disabled a feature does
      not want an alert storm.
- [x] Turning it back on resumes writing, with no backfill of the gap. There is
      nothing to backfill: the rows were never taken.
- [x] A test that the **route** returns `202` in both states, so the client
      contract is identical whether or not the org records anything.
- [x] LAI-430's tests still pass unchanged — a branch that does not resolve still
      writes a row. **Degraded and disabled are different rules and must not be
      collapsed.**

## Notes / context

**Retention pruning (§11.6) is LAI-431** and is a different mechanism: it removes
old rows on a schedule. This is about never taking them.

**Check §9.3's disabled state with LAI-432.** "Disabled" and "nobody is working"
must render differently, and once no rows are stored the only thing that can tell
them apart is `presence_enabled` itself — so the views have to read the column,
not infer from an empty table.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1613 server, 585 web, lint and format clean.**

### The criterion I was most careful about

> *"LAI-430's tests still pass unchanged — a branch that does not resolve still
> writes a row. **Degraded and disabled are different rules and must not be
> collapsed.**"*

They pass unchanged. Nothing in LAI-430's set asserted that a row lands while
presence is **off** — only that one lands when the *branch* fails to resolve,
which is still true and is a different rule. The two are now tested side by side
in the same file, which is where the collapse would otherwise happen.

### Not a bypass

Disabled must not become a path with weaker rules. The body is still validated —
a blank repo is still `422`, the length bounds still apply — and a cookie is
still refused, because §9.1's credential rule has nothing to do with whether rows
are kept. **Mutating the check to sit above validation turns seven tests red**,
which is the one I most wanted to be sure of: it is the natural place to put it
and it is wrong.

### Still `202`, and tested in both states

The status and the empty body are identical whether or not the org records
anything, so a plugin cannot tell and does not need to.

### One comment corrected

`services/presence.ts` said *"once LAI-150 stops storing rows"*. It now says what
is true, and adds the half I had not written: inferring from an empty table is
wrong in **both** directions — it means "disabled" no more reliably than it means
"nobody is working".

Three mutations, all caught.

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** 1613 server, 585 web, green.

**Verified by mutation:** removing the discard — storing the row regardless —
turns **six** tests red, including `resumes on being turned back on, with no gap
to backfill` and `leaves tasks.branch alone`.

### Discarding means writing nothing, not writing something inert

The comment at the site is the argument and it is right: *a stored row still
carries the user, the token, the repo and the branch — the same metadata, minus
the task link — so keeping it would leave the switch promising a privacy property
(D-005) it does not deliver.* An off switch that stores everything except the
join is not off.

**`202` kept, deliberately.** A plugin must not start reporting errors because an
org turned a feature off, and §9.2's *degrades, never errors* covers the whole
endpoint. An operator who disabled presence does not want an alert storm for it.

**And "this is not retention"** is worth having written down where it is: LAI-431
removes old rows on a schedule; this never takes them, so turning presence back
on resumes with **nothing to backfill, because there was never a gap.**

### The mutation worth having was the one about ordering

*Moving the disabled check above validation — the natural place to put it — turns
seven tests red.* **A disabled org must not become a path with weaker rules**:
`still validates the body — disabled is not a bypass` is the test, and §9.1's
credential rule has nothing to do with whether rows are kept. That is the kind of
mutation that finds a bug nobody would have written a test for after the fact.

### A comment four hours old had already gone stale

`presence.ts` said *"once LAI-150 stops storing rows"* — and LAI-150 was you, two
tasks later. Corrected **and extended** with the half that was missing: inferring
from an empty table is wrong in **both** directions.

---

**One of mine, in the act of reviewing this.** My mutation harness backed up
`src/services/heartbeats.ts` with a `cp A || cp B` fallback — and `A` existed, so
it silently saved the **route** file and then restored it over the **service**.
462 lines gone, recovered from git.

**A multi-part command where nothing checks that the right part ran** — the exact
shape CORE named this hour, and the third variant of it today after the no-op
mutations and the half-applied edits. It happened to the reviewer, inside the
review, of a task about being careful. Worth writing down for that reason alone.
