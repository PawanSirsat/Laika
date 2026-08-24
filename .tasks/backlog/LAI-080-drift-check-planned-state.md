---
id: LAI-080
title: The drift check has no way to say "specified, not yet built"
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-051]
discovered-from: LAI-073
status: backlog
---

## Goal

**D-011 makes the spec authoritative, which means the spec leads the code.** The
§4↔`schema.ts` drift check treats any difference as a failure, so the normal
interval between *deciding* something and *building* it turns master red.

This is not hypothetical. Writing §4.16 for D-027 failed
`has a table for every §4 section` immediately, and the only options were leave
master red or revert the spec. **I reverted**, and parked the section text inside
LAI-079 — which works, but means the authoritative document is temporarily not
the one that holds the decision.

The check is right to fail. What is missing is a way to say *"specified,
scheduled, not built yet"* that is **visible and expires**.

## Acceptance criteria

- [ ] A §4 section can be marked as planned, and the drift check passes while it
      is — **naming the task that will close it**. An unattributed exemption is
      how a permanent hole gets punched in a check.
- [ ] **The mark fails once the table exists.** A planned entry whose table has
      landed must go red, so the exemption cannot outlive its reason. This is the
      part that matters: an exemption nobody is forced to remove is a lie the
      check tells forever.
- [ ] **A planned entry naming a task already in `.tasks/done/` fails.** The task
      is the expiry mechanism.
- [ ] The report lists planned sections separately from drift, so
      `pnpm test` output distinguishes "not built yet" from "these disagree".
- [ ] Prove both directions: add a planned section with no table (green), then
      add the table (red), then remove the mark (green).
- [ ] Same treatment for LAI-061's schema↔migrations check if the same transient
      can occur there. **Say so either way** — if it cannot, write down why.

## Notes / context

**Do not solve this by weakening the check.** A blanket "ignore missing tables"
switch returns us to having no check at all, which is what LAI-051 existed to fix.
The mark must be per-section, attributed, and self-expiring.

The general lesson, third time now (LAI-054, LAI-048, this): **a guard is only
worth having if it can fail, and only worth keeping if it cannot fail for a
reason nobody can act on.** A check that goes red on a legitimate state trains
people to route around it — here, by not writing the spec.
