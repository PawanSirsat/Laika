---
id: LAI-480
title: The root gate bails on the first failing workspace and hides the others
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-611
status: backlog
---

## Goal

`pnpm test` at the repo root is **the** gate — CLAUDE.md §5 says so twice, and
the rule that names it is the one that has already failed twice this month. It
runs `pnpm -r --if-present run test`, and `pnpm -r` **aborts the whole recursive
run at the first workspace that fails**. Every workspace after it never runs.

So a root `EXIT 1` means *"at least one workspace failed"*. It does **not** mean
*"everything else passed"* — and there is nothing in the output that says which
of the two you are looking at.

This is the same defect §5 already documents twice in other instruments — the
`grep "Tests "` that could not see `Failed`, the chained `&&` that threw away
lint's exit code — **arriving in the command §5 names as the gate itself.**

## Measured, on this repo, 2026-09-20 (landing LAI-611)

`cli` was red by design (SHELL's un-landed half). The root run aborted on it:

```
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  laika@0.1.0 test
```

Lines the `server` workspace contributed to the root run, in full:

```
server test$ pnpm run typecheck && vitest run
server test: > @laika/server@0.1.0 typecheck
server test: > tsc -p tsconfig.json --noEmit
server test:  RUN  v4.1.11 /…/Laika/server
```

**Four lines. Vitest started and reported not one result before it was killed.**
Run on its own, the same suite emits fifteen lines ending `Tests 1979 passed`.
`server/web` was cut off the same way — its last root-run line is `type: 'suite'`
with no `# tests` summary, where standalone it ends `# pass 897`.

**1979 + 897 = 2876 assertions the root gate did not run**, on a landing whose
entire purpose was turning two of them green. A reviewer who saw `EXIT 1`,
recognised the known `cli` red, and landed on that basis would have shipped
without the server suite having executed at all.

## Acceptance criteria

- [ ] The root `test` script runs **every** workspace even when one fails.
      `pnpm -r --no-bail --if-present run test` is the obvious form; any form
      that satisfies the rest of these is fine.
- [ ] It still **exits non-zero** when any workspace fails. `--no-bail` must not
      become "the gate stops failing" — that is a worse outcome than the bug.
- [ ] A test proves both halves **by construction, not by description**: with a
      deliberately failing workspace, assert (a) the root run's output contains a
      result line from a workspace ordered *after* the failing one, and (b) the
      exit code is non-zero. A test that only checks the exit code would pass
      today and is not this.
- [ ] `pnpm lint` and `pnpm format` are checked for the same defect and fixed or
      cleared in the task file. They are single commands rather than recursive
      ones, so they are probably fine — **say which, having looked.**
- [ ] CLAUDE.md §5's gate snippet is corrected if the command changes. **File
      that as a separate task for CHIEF** — `CLAUDE.md` is CHIEF's and this task
      grants no crossing.

## Notes

- No new dependency: `--no-bail` is a pnpm flag.
- **Do not "fix" this by reordering workspaces** so the flaky one runs last.
  That hides the same hole behind an ordering nobody will maintain.
- Worth checking whether `--no-bail` changes the output interleaving enough to
  break anything that parses the root run. Nothing in the repo does today, as
  far as the filer could see, but the filer was not looking hard.
