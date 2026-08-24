---
id: LAI-061
title: Nothing catches drift between schema.ts and the migrations
area: server
assignee: builder-a
priority: p2
depends-on: []
discovered-from: LAI-050
status: done
started: 2026-08-24T11:26:13+05:30
finished: 2026-08-24T11:33:37+05:30
reviewed: 2026-08-24T14:30:00+05:30
---

## Goal

`src/db/schema.ts` is Drizzle's **declaration**. The database the server and the
tests actually run against is built from `src/db/migrations/*.sql`. Nothing
asserts the two agree.

Found during the LAI-050 review: I changed `tasks.sprint_id` in `schema.ts` from
`onDelete: 'set null'` to `onDelete: 'cascade'` — the edit that makes deleting a
sprint destroy every task in it — and **all 615 tests passed**, because the
running schema came from `0000_initial_schema.sql`, which still said `set null`.

The immediate consequence is not a broken test suite. It is that **the next
person to run `drizzle-kit generate` emits a migration nobody asked for**,
carrying whatever stale edit is sitting in `schema.ts`, attributed to whichever
task happened to run the generator. A silent `ON DELETE cascade` arriving that
way is data loss with no author.

## Acceptance criteria

- [x] A test fails when `schema.ts` declares something the migrations do not
      produce. Prove it with the exact mutation above — flip `set null` to
      `cascade` in `schema.ts` only, watch it go red, restore.
- [x] The check covers **at least** column types, nullability, foreign-key
      actions, and unique/partial indexes. Foreign-key actions are the ones with
      teeth; do not settle for comparing column names.
- [x] It runs in `pnpm test`, needs no network, and does not require a
      pre-existing `laika.db`.
- [x] The failure message says *which* object differs and in which direction —
      "schema.ts says X, migrations say Y" — not just that a hash changed.

## Notes / context

**Prefer the tooling to a hand-rolled comparison if it can be done with no new
dependency.** `drizzle-kit` is already present. If it can diff the declared
schema against a database built from the migrations and exit non-zero, wrap that.
A snapshot-hash comparison is acceptable only if the message still names the
object that moved — a diff that says "hash mismatch" teaches nobody anything and
gets regenerated away by the first person who hits it.

**Overlaps LAI-051** (§4 ↔ `schema.ts`). That one checks the *spec* against the
declaration; this one checks the declaration against what actually runs. Together
they close the chain SPEC → `schema.ts` → migrations → database. **If you hold
both, build them as one mechanism with two assertions rather than two walkers.**

Related to the general lesson from LAI-054 and LAI-048: a guard that passes while
the thing it guards is untrue is worse than none. Two of the three examples so
far were bootstrap or declaration code that no test reaches.

---

## Notes at review — builder-a

`server/test/tooling/schema-migration-drift.test.ts` (9 tests) plus
`server/test/helpers/declared-schema.ts`, the shared reader. **698 tests**;
format, lint, typecheck clean, full suite run twice. Test-only change — nothing
under `src/` moved.

**AC1, your exact mutation, verbatim output:**

```
tasks.sprint_id → sprints: schema.ts says ON DELETE cascade, migrations say set null
```

**Every other direction I could think of, and what it says:**

| Mutation (in `schema.ts` or `enums.ts` only) | Message |
| --- | --- |
| `notNull()` dropped from `tasks.title` | `tasks.title: schema.ts says notNull=false, migrations say true` |
| `number` retyped to text | `tasks.number: schema.ts says type "text", migrations say "integer"` |
| one-active index made non-unique | `index "sprints_one_active_per_project": schema.ts says unique=false, migrations say true` |
| partial index loses its `WHERE` | `… schema.ts says WHERE <none>, migrations say WHERE status='active'` |
| a verb added to `ACTIVITY_TYPES` | `CHECK "activity_type_check": schema.ts allows "sprint.created" and the migrations do not` |
| a column declared, never migrated | `sprints.velocity: schema.ts declares it, the migrations do not` |
| a migration creates an undeclared index | `sprints: the migrations create index "sprints_goal_idx", schema.ts does not declare it` |
| the live reader sabotaged to find nothing | the sanity test fails, plus every table reported missing |

**1. One mechanism, as you asked.** `test/helpers/declared-schema.ts` is now the
only reader of what `schema.ts` declares, and **LAI-051's check was refactored
onto it** — so `schema-spec-drift` and `schema-migration-drift` compare the *same*
declaration upward and downward. A second, slightly different notion of "what
schema.ts says" sitting in the middle is exactly how a chain breaks quietly.

Proof that it is one chain rather than two: adding a column to `schema.ts` alone
now fails **both** checks — one saying §4 never mentions it, one saying the
migrations never create it. **Note that LAI-051's file changed after it went to
review**; if you had started on it, this is what moved.

**2. No `drizzle-kit` wrapper, and I think that is the better answer.** You
preferred the tooling if it needed no new dependency. `drizzle-kit generate` diffs
against its own snapshot and *writes a migration file* to do it, and `push`
mutates a database; neither gives a comparison I can assert on without side
effects, and both would report "a migration would be generated" rather than what
differs. Instead: the declaration is **run** (`getTableConfig`) and the migrated
database is **introspected** (`PRAGMA table_info`, `foreign_key_list`,
`index_list`/`index_info`, and `sqlite_master` DDL). Neither side is parsed from
source; both are the real thing; and every message names the object.

**3. No snapshot hash anywhere**, for the reason you gave — and the CHECK
comparison is where that mattered most. Comparing a twenty-value `IN (…)` list
prints four hundred characters twice and buries the one changed word, so when both
sides are that shape the failure reports the *difference* instead. First draft did
print both lists in full; it was unreadable, which is a milder version of the same
disease as a hash.

**4. Triggers are a hole, and a real one.** Drizzle cannot declare a trigger, so
`activity`'s append-only triggers exist only in the migrations and there is
nothing to compare them against. That is why they have been dropped three times by
table rebuilds. This check cannot help; LAI-044's test — which attempts an
`UPDATE` and a `DELETE` and expects both to fail — is the right shape for a
guarantee no declaration mentions, and it is the thing that has actually caught
them. Stated in both module comments so nobody assumes this check covers it.

**5. What I chose not to compare, and why.** Implicit indexes (`origin` of `u` or
`pk` — the ones SQLite builds for `UNIQUE` and `PRIMARY KEY` clauses) are skipped,
because they are already compared through the column and primary-key assertions
and reporting them again would mean two failures for one cause. Column *default
values* are compared as "has a default or not" rather than by value: SQLite stores
`dflt_value` as source text, so `'planned'` versus `"planned"` would read as drift
when nothing had changed. If you want defaults compared by value, that is a
normalisation problem worth its own task rather than a guess here.

## Review — PM, 2026-08-24

**Accepted.** I filed this with a specific proof mutation and it catches exactly
that: flipping `tasks.sprint_id` from `set null` to `cascade` in `schema.ts` —
which passed **615/615** before this existed — now fails
*foreign-key actions agree — these are the ones with teeth*.

The message meets the criterion I set on message quality:
`tasks.sprint_id → sprints: schema.ts says ON DELETE cascade, migrations say set null`.
Object named, both directions given.

With LAI-051 the chain SPEC → `schema.ts` → migrations → database is now closed
at every link.
