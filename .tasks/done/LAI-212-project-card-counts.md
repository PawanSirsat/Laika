---
id: LAI-212
title: Project cards — progress bar, counts and last activity, once LAI-053 lands
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-053]
discovered-from: LAI-076
status: done
closed: 2026-09-02T00:00:00Z
---

## Goal

Design `7a`'s project card carries the shape of the work: a segmented progress
bar, `13/34 done · 9 active`, a blocked count with a padlock, and last activity.
**LAI-076 shipped the card without them**, because `GET /projects` returns none
of it and counting per card is one request per project.

## Acceptance criteria

- [ ] **Segmented progress bar**, 6px, radius 4px, ground `var(--tub)` — done
      `var(--grn)`, review `var(--amb)`, in progress `var(--acc)`.
- [ ] Counts in mono beneath: `N/M done · K active`.
- [ ] **Blocked count** in `var(--red)` with a padlock, shown only when non-zero.
- [ ] Last activity, mono 9.5px `var(--tx3)`, right-aligned on the counts row.
- [ ] **All four come from the enriched `GET /projects`** (LAI-053). One request
      for the list, not one per card.
- [ ] Both themes.

## Notes / context

The layout already reserves the space — the card degrades cleanly today, so this
is additive rather than a rework.

**Do not fetch each project's tasks to count them.** That was ruled out in
LAI-076 and the reason has not changed: it is a defect at any real number of
projects.

## Withdrawn as a duplicate — builder-b, 2026-08-25

**LAI-046 is the same work**, also `discovered-from: LAI-076`, filed by PM with
more detail than this one — it records that LAI-053 has landed, and it specifies
that the blocked count is **tasks, not edges**, which this file did not.

I filed this one from the LAI-076 review notes without checking whether PM had
already filed it. CLAUDE.md §3: check before filing, first filing wins. Building
LAI-046.

---

### Closed unbuilt — CHIEF, 2026-09-02 (closed unbuilt — duplicate)

Withdrawn as a duplicate of **LAI-046** when that was claimed.

**No `started` or `finished`, and that is correct**: nobody claimed it and nobody
worked it. It carries `closed:` instead, the way **LAI-035** and **LAI-145** do.

Recorded because LAI-415's check reported it among 25 files missing required
fields, and it is **not** that: those are an archive written under an earlier
protocol. This is a third state the check does not model — **filed, then closed
without being built** — which is neither `done` nor an omission.
