---
id: LAI-044
title: Add the system actor kind and the activity actor constraint
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-025
status: in-progress
started: 2026-08-24T07:26:28+05:30
---

## Goal

D-022 settled `activity` nullability. `project_id` and `actor_id` are already
nullable in the schema, so that half is done. What is missing is the third actor
kind and the constraint that gives a null actor its meaning.

## Acceptance criteria

- [ ] `ACTOR_KINDS` becomes `['user', 'agent', 'system']`.
- [ ] A check constraint enforces the biconditional: `actor_id IS NULL` **if and
      only if** `actor_kind = 'system'`. Both directions — a null actor with
      `user`, and a non-null actor with `system`, must each be rejected.
- [ ] A migration, generated and committed like every other.
- [ ] Tests assert **both** rejection directions and both valid shapes. The
      constraint is the entire point of D-022; a test that only covers the happy
      path proves nothing.
- [ ] The "Deviation from §4.8" comment in `schema.ts` is replaced by a reference
      to D-022 — the deviation is now the rule.
- [ ] Full gate green.

## Added by PM — 2026-08-24: also add `org.created`

LAI-009 requires an `activity` row for org creation and §4.8's type vocabulary
has none. Folding it in here rather than filing separately: this task already
opens the activity enum and its check constraint, and two migrations touching one
table is how a schema gets a conflict.

- [ ] `ACTIVITY_TYPES` gains **`org.created`**, and SPEC §4.8's type list gains it
      too — PM will make the §4.8 edit; you do the enum and the constraint.
- [ ] The same migration carries both changes: the `system` actor kind and
      `org.created`.

Nothing writes it yet — LAI-009 does, and now depends on this task.

## Notes / context

D-022 and SPEC §4.8.

**Nothing writes `system` events yet.** Webhooks are M6 and cron is M5, so this
lands the vocabulary before the first writer needs it — which is the cheap
moment, because adding a check constraint to a populated table is a migration
with a data audit attached.

Your source comment is what made this a decision rather than folklore: it named
the conflicting types instead of just widening the column. That is why D-022
exists at all.

The UI will eventually need a `system` presentation distinct from user and agent
(SPEC §4.8). Not this task — file it if you touch that area.

No new dependencies.
