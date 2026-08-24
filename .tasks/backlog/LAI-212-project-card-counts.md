---
id: LAI-212
title: Project cards — progress bar, counts and last activity, once LAI-053 lands
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-053]
discovered-from: LAI-076
status: backlog
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
