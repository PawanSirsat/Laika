---
id: LAI-131
title: Two different tasks are both numbered LAI-101
area: docs
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-053
status: done
started: 2026-09-02T20:45:00Z
finished: 2026-09-02T20:50:00Z
---

## Goal

`.tasks/backlog/` currently holds **two files claiming `LAI-101`**:

- `LAI-101-format-fix-misses-committed-work.md` — filed from LAI-005, referenced
  in `.tasks/done/LAI-005-better-auth-wiring.md` (twice) and in `logs/chief-*.md`
  (twice).
- `LAI-101-activity-payload-names.md` — filed today from LAI-092's review.

**This is the exact failure D-017 exists to prevent**, and `LAI-005`'s own notes
say so in as many words: *"LAI-101 filed in the correct range (D-017)"*. `LAI-101`
is in **CORE's** range (100-199); the new task came from CHIEF, whose range is
001-099.

## Acceptance criteria

- [x] **The new task was renumbered, not the old one.** CLAUDE.md §3 is explicit —
      never renumber an existing task, because ids are referenced by
      `depends-on`, `discovered-from` and commit messages. The format-fix task
      has four references; the activity-payload one has none yet, so moving it
      costs nothing today and will cost something tomorrow.
- [x] The new id came from **CHIEF's range** — **`LAI-045`**, and it is closed.
      `LAI-101-format-fix-misses-committed-work.md` kept its number and its four
      references, and is in `.tasks/done/`.
- [x] Verified across every branch: **`LAI-101` now names exactly one task**, and
      `KNOWN_COLLISIONS` in `task-file-state.test.ts` does not list it — so the
      guard agrees, not just the directory listing.

## Notes / context

Raised rather than fixed because `.tasks/` is CHIEF's and renumbering is exactly the
operation CLAUDE.md warns is dangerous — it is what LAI-015 had to clean up.

Worth noting *why* it happened, since the rule was followed everywhere else: the
range check in §3 is a `git log --all` grep, and a task filed **in the same
minute** as another is the one case where two sessions can both read a clean
result. That is the same shape as the simultaneous-claim rule in §2, which has a
tiebreak (earlier commit wins) — filing has none. If this recurs, the tiebreak
could be the same one.

---

## Note — CHIEF, 2026-08-31: it is three collisions, not one

Swept every task file after **nearly making a fourth myself** — I filed
LAI-411's follow-up as `LAI-042`, which `.tasks/done/LAI-042-error-codes-413-405.md`
has held since M1. Caught before committing and renumbered to `LAI-416`.

The full set:

| id | files |
| --- | --- |
| `LAI-046` | `backlog/LAI-046-install-after-merge.md`, `done/LAI-046-projects-card-counts.md` |
| `LAI-100` | `done/LAI-100-format-check-red-on-imported-prototype.md`, `done/LAI-100-policy-matrix-drift.md` |
| `LAI-101` | the two named above |

**Renumbering remains forbidden** (D-017) — these ids are referenced by
`depends-on`, `discovered-from`, commit messages and logs, which is what LAI-015
had to clean up. So the resolution is a **disambiguation record**, not a rename:
decide how each pair is referred to, and write it somewhere a reader lands.

**And the reason this keeps happening is that nothing checks.** "Lowest unused
number in your own range, checked across every branch" is a discipline with no
guard behind it, and D-036 filling CHIEF's first block made it worse — I wrote
that decision and then still reached into the exhausted range out of habit.
**LAI-415 now carries the check**; this task is the record of what it will find.

---

## Closed — CHIEF, 2026-09-02. **Already resolved; verified rather than assumed.**

The activity-payload task became **`LAI-045`** — CHIEF's range, per D-017 — and is
in `.tasks/done/`. `LAI-101` names one task across every branch, and
`KNOWN_COLLISIONS` is `['LAI-046', 'LAI-100']`, which does not include it. **The
guard agrees with the directory listing**, which is the check worth doing rather
than trusting either alone.

### And the guard turned up a fresh instance of today's recurring defect

```ts
const KNOWN_COLLISIONS = ['LAI-046', 'LAI-100'];   //  two
it('has no collision beyond the three recorded', …) //  three
```

**The companion test `still has every collision the exemption claims` proves no
*entry* is stale** — it goes red the moment a recorded collision is resolved and
not removed. So the list is provably current, **and the sentence describing it
went stale at precisely the moment the guard did its job.**

That is the third time today, in three unrelated files:

| | said | was |
| --- | --- | --- |
| `CLAUDE.md` §2 | *"ten listed and eleven served"* | eleven and eleven, since LAI-433 |
| LAI-436's fixture comment | *"now is pinned by the sprint that contains today"* | now was never pinned |
| this test name | *"the three recorded"* | two |

**The generalisation is now in `CONVENTIONS.md` §4** and it is narrower and more
useful than "keep comments up to date": **do not put a count in a name or a
comment when the code holds the list.** The list is the fact; the number is a copy
of it that nothing checks. `LAI-461` files the one-word fix.
