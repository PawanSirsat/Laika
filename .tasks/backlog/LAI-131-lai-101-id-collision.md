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
  in `.tasks/done/LAI-005-better-auth-wiring.md` (twice) and in `logs/pm-*.md`
  (twice).
- `LAI-101-activity-payload-names.md` — filed today from LAI-092's review.

**This is the exact failure D-017 exists to prevent**, and `LAI-005`'s own notes
say so in as many words: *"LAI-101 filed in the correct range (D-017)"*. `LAI-101`
is in **Builder-A's** range (100-199); the new task came from PM, whose range is
001-099.

## Acceptance criteria

- [ ] **The new task is renumbered, not the old one.** CLAUDE.md §3 is explicit —
      never renumber an existing task, because ids are referenced by
      `depends-on`, `discovered-from` and commit messages. The format-fix task
      has four references; the activity-payload one has none yet, so moving it
      costs nothing today and will cost something tomorrow.
- [ ] The new id comes from **PM's range** (001-099), per D-017.
- [ ] Nothing else references the new id first. Check with
      `git log --all --name-only --format= -- .tasks/ | grep -o 'LAI-[0-9]*' | sort -u`.

## Notes / context

Raised rather than fixed because `.tasks/` is PM's and renumbering is exactly the
operation CLAUDE.md warns is dangerous — it is what LAI-015 had to clean up.

Worth noting *why* it happened, since the rule was followed everywhere else: the
range check in §3 is a `git log --all` grep, and a task filed **in the same
minute** as another is the one case where two sessions can both read a clean
result. That is the same shape as the simultaneous-claim rule in §2, which has a
tiebreak (earlier commit wins) — filing has none. If this recurs, the tiebreak
could be the same one.
