---
id: LAI-061
title: Nothing catches drift between schema.ts and the migrations
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-050
status: backlog
started:
finished:
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

- [ ] A test fails when `schema.ts` declares something the migrations do not
      produce. Prove it with the exact mutation above — flip `set null` to
      `cascade` in `schema.ts` only, watch it go red, restore.
- [ ] The check covers **at least** column types, nullability, foreign-key
      actions, and unique/partial indexes. Foreign-key actions are the ones with
      teeth; do not settle for comparing column names.
- [ ] It runs in `pnpm test`, needs no network, and does not require a
      pre-existing `laika.db`.
- [ ] The failure message says *which* object differs and in which direction —
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
