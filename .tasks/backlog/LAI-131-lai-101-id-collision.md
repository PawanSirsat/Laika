---
id: LAI-131
title: Two different tasks are both numbered LAI-101
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-053
status: backlog
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

- [ ] **The new task is renumbered, not the old one.** CLAUDE.md §3 is explicit —
      never renumber an existing task, because ids are referenced by
      `depends-on`, `discovered-from` and commit messages. The format-fix task
      has four references; the activity-payload one has none yet, so moving it
      costs nothing today and will cost something tomorrow.
- [ ] The new id comes from **CHIEF's range** (001-099), per D-017.
- [ ] Nothing else references the new id first. Check with
      `git log --all --name-only --format= -- .tasks/ | grep -o 'LAI-[0-9]*' | sort -u`.

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
