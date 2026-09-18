---
id: LAI-173
title: '§4 states enum values for eleven columns and one of them is guarded'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-172
status: backlog
---

## Goal

CHIEF asked whether §4.12's unguarded `status` generalises. **It does, and there
is a live disagreement right now that nothing reports.**

```
§4.12 says:   pending | applied | discarded | expired | failed     (five)
enums.ts says: pending, applied, expired, discarded                (four)
$ vitest run test/tooling/schema-spec-drift.test.ts
      Tests  35 passed (35)
```

D-057 added `failed` to §4.12 and the server half has not landed. **That is the
correct state mid-procedure** — §4.4 expects it — but **no test says so**, so the
gap between them is indistinguishable from agreement. The drift suite cannot
tell *"a half is in flight"* from *"these two have silently diverged"*.

## It is ten columns, not one

Measured across §4 — a value list being two or more backticked values joined by
`|`:

| section | column | values |
| --- | --- | --- |
| 4.1 `users` | `org_role` | 4 |
| 4.2 `orgs` | `ai_provider` | 4 |
| 4.3 `projects` | `visibility` | 2 |
| 4.4 `project_memberships` | `role` | 3 |
| 4.5 `tasks` | `status` | 7 |
| 4.5 `tasks` | `priority` | 3 |
| 4.5 `tasks` | `created_via` | 5 |
| **4.8 `activity`** | **`actor_kind`** | **2 — guarded** |
| 4.9 `tokens` | `scope` | 3 |
| 4.12 `meeting_reviews` | `status` | 5 |
| 4.15 `sprints` | `status` | 4 |

**Eleven stated, one compared.** §4.8's two vocabularies are guarded because
LAI-098 built that comparison for `ACTIVITY_TYPES` and `ACTOR_KINDS`
specifically; the mechanism was never generalised to the other nine.

## Why the other two axes do not cover it

- **`schema-migration-drift`** compares CHECK bodies between `schema.ts` and the
  migrations, so a `CHECK(status IN (…))` that disagrees with `enums.ts` **is**
  caught — on that leg. It has no opinion about §4.
- **`schema-spec-drift`** compares §4 to `schema.ts` by column **name**, and
  since LAI-163 by **nullability**. Not by permitted values.

So the value lists are enforced downward from `enums.ts` and compared to the
document by nothing. **This is the third axis of the same shape LAI-051 and
LAI-061 built the first two of.**

## It has already cost something, twice

- **LAI-454** added `discarded` to `MEETING_REVIEW_STATUSES` **ahead of §4.12**,
  and CORE wrote in the code that *"nothing currently checks this pair"*. Nothing
  did. §4.12 caught up only because a task file said it should — **a person, not
  a guard**.
- **D-057** is the same thing in reverse, live today.

Two directions, two tasks, and the check that would have reported both does not
exist.

## Acceptance criteria

- [ ] **Every §4 column that states a value list is compared to the enum that
      implements it**, in both directions, with the same self-expiring exemption
      shape the existing lists use.
- [ ] **The guard reports what it found** (LAI-465) — how many value lists it
      parsed and how many it matched to an enum. A parser that finds three of
      eleven must not read as full coverage.
- [ ] **A column §4 states and `enums.ts` does not implement is a finding, not a
      crash.** Several of these are `text` columns with a CHECK and no exported
      `const`; decide whether the comparison is against the enum, the CHECK, or
      both, and **say which in the file**.
- [ ] Prove it: change one value on each side in turn and watch it go red. Do it
      for a column that is **not** `meeting_reviews`, so the fixture is not the
      case that prompted it.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Not urgent because D-057's gap closes on its own** when the enum half lands.
p2 because the *next* one will not announce itself — both instances so far were
found by someone writing a task file, and the second only because CHIEF asked
whether the first generalised.

**Do not fold this into `schema-spec-drift`'s nullability block.** That reads §4's
prose for one attribute of a column; this reads a different shape (a value list,
often in a different cell) and needs its own parser and its own exemptions.
