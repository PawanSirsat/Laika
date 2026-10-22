---
id: LAI-879
title: 'Folder-name match folds case the same on both sides'
area: server
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-866
status: backlog
---

## Goal

A folder's name matches a project's name *"case and outer spaces aside"*, as
SPEC §6.4 says, for every letter, not only ASCII.

## What is there today (read at `9250fc3e`)

- `matchingProject` lowercases the folder's name in JavaScript (`wanted`,
  `server/src/services/time-drafts.ts:470`). It then asks SQLite for
  `lower(trim(name)) = wanted` (`:477`). SQLite's `lower()` folds only ASCII,
  so a project named `Über Client` is never a candidate for `über client`.
- It fails safe: the block stays untied, and the person can tie it by hand.

## Acceptance criteria

- [ ] **Test.** A project named `Über Client` matches a block from a folder
      named `über client`. Fails today; run it red first.
- [ ] The existing match, no-match, unreadable and tie tests pass unedited.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`).
- **Files:** `server/src/services/time-drafts.ts`,
  `server/test/services/time-folders.test.ts`. No new dependencies, and all
  database access stays in Drizzle (CLAUDE.md §5).
- The slug comparison (`eq(projects.slug, wanted)`) is unchanged: a slug is
  already lower case.
