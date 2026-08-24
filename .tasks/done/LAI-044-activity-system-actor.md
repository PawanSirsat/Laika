---
id: LAI-044
title: Add the system actor kind and the activity actor constraint
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-025
status: done
started: 2026-08-24T07:26:28+05:30
finished: 2026-08-24T07:29:13+05:30
reviewed: 2026-08-24T08:50:00+05:30
---

## Goal

D-022 settled `activity` nullability. `project_id` and `actor_id` are already
nullable in the schema, so that half is done. What is missing is the third actor
kind and the constraint that gives a null actor its meaning.

## Acceptance criteria

- [x] `ACTOR_KINDS` becomes `['user', 'agent', 'system']`.
- [x] A check constraint enforces the biconditional: `actor_id IS NULL` **if and
      only if** `actor_kind = 'system'`. Both directions — a null actor with
      `user`, and a non-null actor with `system`, must each be rejected.
- [x] A migration, generated and committed like every other.
- [x] Tests assert **both** rejection directions and both valid shapes. The
      constraint is the entire point of D-022; a test that only covers the happy
      path proves nothing.
- [x] The "Deviation from §4.8" comment in `schema.ts` is replaced by a reference
      to D-022 — the deviation is now the rule.
- [x] Full gate green.

## Added by PM — 2026-08-24: also add `org.created`

LAI-009 requires an `activity` row for org creation and §4.8's type vocabulary
has none. Folding it in here rather than filing separately: this task already
opens the activity enum and its check constraint, and two migrations touching one
table is how a schema gets a conflict.

- [x] `ACTIVITY_TYPES` gains **`org.created`**, and SPEC §4.8's type list gains it
      too — PM will make the §4.8 edit; you do the enum and the constraint.
- [x] The same migration carries both changes: the `system` actor kind and
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

---

## Notes at review — builder-a

**331 tests**; format, lint and typecheck clean. Verified against a real fresh
database after all four migrations:

```
actor_kind values  : actor_kind IN ('user', 'agent', 'system')
biconditional      : (actor_id IS NULL) = (actor_kind = 'system')   ✓
org.created        : ✓
triggers           : activity_is_append_only_no_delete, activity_is_append_only_no_update
migrations applied : 4
```

**1. This migration destroyed the append-only guarantee, and LAI-003's tests
caught it.** Worth reading before the rest.

drizzle-kit implements any `activity` change as a table rebuild — `CREATE
__new_activity` … `DROP TABLE activity` … `RENAME`. **SQLite drops a table's
triggers with the table**, so the two `RAISE(ABORT)` triggers from migration 0000
— the ones enforcing §4.8's "no updates, no deletes, ever" — were gone the moment
this migration ran. The schema still *said* append-only in a comment; the database
no longer enforced it.

Three tests went red immediately, which is the entire reason this is a note and
not a silent regression shipped under a green gate. Had `activity.test.ts` only
covered the happy path, the audit table would have quietly become mutable.
Migration 0003 now recreates both triggers, with a comment telling the next person
that any future rewrite of `activity` must do the same. There is also a test that
there are exactly two triggers, so a re-run cannot leave duplicates.

**2. All four combinations of the biconditional are asserted**, per AC4:

| `actor_kind` | `actor_id` | Expected |
| --- | --- | --- |
| `system` | null | accepted |
| `user` | set | accepted |
| `agent` | set | accepted |
| `user` / `agent` | null | **rejected** — the "somebody forgot" case |
| `system` | set | **rejected** — the other direction |

The second rejection is the one that is easy to omit. Without it `system` becomes
a label anyone can attach to a human-authored row, and the constraint stops
answering the question D-022 exists to answer.

**3. One existing test changed meaning, correctly.** `writes system-actor events
with no actor (webhook.commit)` used `actor_kind: 'agent'` with a null actor — now
a constraint violation. `agent` is a token-authenticated *person* and still has an
actor; a webhook is `system`. That is D-022 working as intended on the first row
that met it.

**4. `org.created` added to the enum and the check constraint**, in the same
migration as the actor kind, as PM asked. Nothing writes it yet — LAI-009 does,
and now depends on this task. There is a test that it is insertable, so LAI-009
does not discover a typo in the vocabulary at the worst moment.

**5. The §4.8 deviation comment is gone**, replaced by a reference to D-022 and a
paragraph on why the biconditional matters more than the nullability. The
deviation is the rule now.

**Not filed, but worth knowing:** the UI will need a `system` presentation
distinct from user and agent. The task says to file it if I touch that area — I
have not, and `server/web/` is Builder-B's under D-016, so it belongs with
whoever builds the activity feed.

## Review — PM, 2026-08-24

**Accepted.** Gate green: lint clean, **331 server tests** (up from 322) and 109
web. **Unblocks LAI-009 — the last task before M2.**

**I tested the constraint against a real migrated database**, not through the
suite, because the constraint is the whole point of D-022:

| Case | Result |
| --- | --- |
| `system` + NULL actor | accepted |
| `user` + actor | accepted |
| `system` + actor | **rejected** |
| `user` + NULL actor | **rejected** |

Both valid shapes, both invalid shapes. The biconditional holds in both
directions.

### The constraint expression is exactly right

```sql
CHECK((actor_id IS NULL) = (actor_kind = 'system'))
```

That is a literal *if and only if*, not two separate CHECKs that happen to
overlap — so it cannot be half-satisfied, and there is no gap between them for a
row to fall through. It is also self-documenting: the SQL says the rule, so
nobody has to reconstruct the intent from two constraints and a comment.

`org.created` is in both `ACTOR_KINDS`' sibling list and the `activity_type_check`
constraint, so an invented type is rejected at the database rather than trusted
from TypeScript.

**The migration rebuilds the table** — SQLite cannot add a CHECK in place, so the
new-table/copy/drop/rename dance is correct and unavoidable, and the generated
migration does it properly.

**Timing was the point.** Nothing writes `system` events yet (webhooks M6, cron
M5) and nothing writes `org.created` yet (LAI-009). Landing the vocabulary and
the constraint before the first writer means no data audit — adding this CHECK to
a populated `activity` table later would have meant proving every existing row
already satisfied it.
