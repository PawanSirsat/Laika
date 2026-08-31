---
id: LAI-046
title: 'Merging master often adds dependencies, and nothing says so'
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-007
status: backlog
---

## Goal

SHELL has now lost time to the same thing in **three separate tasks**, and
said so directly in their LAI-021 log: *"The `pnpm install` tax has now cost me
time in three separate tasks in this worktree. Worth CHIEF knowing if a future
task's criteria assume the repo scripts just run after a merge."*

Worktrees do not share `node_modules`. Merging `master` brings code whose
dependencies are not installed, so the suite fails in ways that look exactly like
a broken build — and once cost an hour before being traced.

## Acceptance criteria

- [ ] `CLAUDE.md` §4.2 (worktrees) says that `git merge master` may add
      dependencies and that `pnpm install --frozen-lockfile` follows it.
- [ ] `.claude/skills/laika-workflow/SKILL.md` says the same where it tells a
      session to merge before claiming.
- [ ] `.claude/commands/claim.md` step 3 includes the install.
- [ ] The reason is stated, not just the instruction: **a stash does not isolate
      dependency state**, so "I stashed and the failure persisted" does not prove
      the failure is pre-existing.

## Notes / context

Three incidents, all the same root cause:

1. SHELL, LAI-021 — 70 lint errors across `server/src` that looked
   pre-existing. Stashed, re-ran, saw the same 70, concluded it was master's
   fault. It was a missing `better-auth` and `zod`. **They nearly filed a task
   against CORE for it.**
2. CHIEF, LAI-014 review — 9 failing test files and 3 lint errors in shell's
   worktree, all stale `node_modules` after a merge.
3. CHIEF, master — 17 tests instead of 90, same cause.

**I noticed this twice and wrote it in my own log both times without acting.**
That is the actual failure here: the information existed and never became a
change. `area: docs`, so it is CHIEF's.

**Prefer documentation over automation.** A `postmerge` hook would be invisible
and would not survive a rebase; the instruction belongs where a session already
looks, which is the claim protocol.
