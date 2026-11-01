---
id: LAI-480
title: The root gate bails on the first failing workspace and hides the others
area: server
assignee: strelka
priority: p1
depends-on: []
discovered-from: LAI-611
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-21T13:32:36Z
finished: 2026-10-21T13:42:50Z
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

- [x] The root `test` script runs **every** workspace even when one fails.
      `pnpm -r --no-bail --if-present run test` is the obvious form; any form
      that satisfies the rest of these is fine.
- [x] It still **exits non-zero** when any workspace fails. `--no-bail` must not
      become "the gate stops failing" — that is a worse outcome than the bug.
- [x] A test proves both halves **by construction, not by description**: with a
      deliberately failing workspace, assert (a) the root run's output contains a
      result line from a workspace ordered *after* the failing one, and (b) the
      exit code is non-zero. A test that only checks the exit code would pass
      today and is not this.
- [x] `pnpm lint` and `pnpm format` are checked for the same defect and fixed or
      cleared in the task file. They are single commands rather than recursive
      ones, so they are probably fine — **say which, having looked.**
- [x] CLAUDE.md §5's gate snippet is corrected if the command changes. **File
      that as a separate task for CHIEF** — `CLAUDE.md` is CHIEF's and this task
      grants no crossing.

## Notes

- No new dependency: `--no-bail` is a pnpm flag.
- **Do not "fix" this by reordering workspaces** so the flaky one runs last.
  That hides the same hole behind an ordering nobody will maintain.
- Worth checking whether `--no-bail` changes the output interleaving enough to
  break anything that parses the root run. Nothing in the repo does today, as
  far as the filer could see, but the filer was not looking hard.

## Evidence (built on Strelka, 2026-10-21)

**Named crossing (D-033).** This task authorises exactly one line outside
`server/`: the `test` script in the repo-root `package.json`, now
`pnpm -r --no-bail --if-present run test`. Nothing else outside `server/` was
touched, apart from this task file and the LAI-301 filing.

**Criteria 1–3: the construction test.** `server/test/tooling/root-gate.test.ts`
reads the real root `test` script out of `package.json` (the
`format-fix.test.ts` pattern) and runs it in a throwaway pnpm workspace. That
workspace has two packages, `first`, whose test exits 1, and `second`, which
has `first` as a `workspace:*` devDependency, so pnpm's topological order runs
it strictly after `first` instead of in parallel with it. Three tests:

- `runs a workspace ordered after a failing one`: output contains
  `first test: Failed` **and** `second test: LAI-480-SECOND-WORKSPACE-RAN`.
- `still exits non-zero when a workspace fails`: `status` is `1` and the
  output contains `Summary: 1 fails, 1 passes`.
- `exits zero when every workspace passes`: the other side of the exit code.

Proved red against the old script before the fix
(`cd server && pnpm exec vitest run test/tooling/root-gate.test.ts`):
`Tests 2 failed | 1 passed (3)`. The first two failed, each receiving
`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL first@0.0.0 test` with no `second` line.
The exit-code-only half was already `1` before the fix, which is exactly why
the test also asserts on the second workspace's output. After the fix:
`Tests 3 passed (3)`, exit 0.

**Criterion 4: lint and format, having looked.** Neither has the defect. Both
are single processes, not recursive runs: `"lint": "eslint ."` and
`"format": "prettier --check … \"**/*.{…}\""`. Each walks every file and
reports every finding before it exits, with no per-package abort to bail on.
Checked for Prettier by giving it two unformatted files: it listed both
(`Code style issues found in 2 files`) and exited 1. Cleared, no change.

**Criterion 5: the CLAUDE.md snippet.** The command people type is still
`pnpm test`, so §5's snippet is not wrong. What a run means and prints has
changed, though: every workspace runs, and a failing run now ends
`Summary: N fails, M passes` / `ERR_PNPM_RECURSIVE_FAIL`. Filed for CHIEF as
**LAI-301** (`area: docs`, p3), commit `50b32059`. `CLAUDE.md` is not edited.

**Notes item: anything parsing the root output.** Nothing does.
`.github/workflows/deploy.yml:52` runs `pnpm test` and reads only its exit code.
A green `--no-bail` run prints no `Summary:` line; pnpm prints it only when
something fails.

**Gate: the last run is red, on one known load flake, and is reported that
way.** All runs were at the repo root, each command to its own file, unpiped,
with exit codes on their own lines. The code and test files are byte-identical
across all four runs; only `.tasks/` and `logs/` changed in between. From run 3
on, root gates were serialised machine-wide with polly's
`/tmp/laika-root-gate.lock`, because six builders share this laptop.

| run | load (1/5/15) | TEST | LINT | FMT | what failed |
| --- | --- | --- | --- | --- | --- |
| 1, before the task-file edit | 22 → 70 | **0** | 0 | 0 | nothing: server `3389 passed`, web `# pass 2690`, cli `# pass 533` |
| 2 | 15 / 57 / 62 → 59 | 1 | 0 | 0 | `sprints.test.ts` page-size test, `timed out in 5000ms` |
| 3, locked | 102 → 270 | 1 | 0 | 0 | `restore-drill.test.ts` (timeout), `cli/test/activity-sync.test.ts` ×2, `server/web/test/browser/my-day-v2.test.ts` ×2 |
| 4, locked, the last | 142 → 219 | 1 | 0 | 0 | `sprints.test.ts` page-size test again, the **only** failure: `Tests 1 failed \| 3388 passed`, web `# fail 0`, cli `# fail 0` |

Every failing file run **alone**, under the same load: `sprints.test.ts`
timed out once at load 59, then passed `43 passed (43)`. `restore-drill`
passed `3 passed (3)`, `activity-sync` `# pass 43 # fail 0`, and `my-day-v2`
`# pass 31 # fail 0`. None of them is touched by this diff: one script line
and a new test file.

Filed as **LAI-304** (`area: server`, p2), with the full table and run 3's
other failures listed so they are not lost. Re-gate on a quieter machine
before landing; on Strelka today the 1-minute load never fell below 100
during a gate.

The red runs are themselves evidence for criteria 1–2 on the real repo. Run 4
ended `Summary: 1 fails, 2 passes` and exited 1, with a full result from all
three workspaces. The three run concurrently, so this run does not by itself
show that a later workspace would have been cut off. The task's 2026-09-20
measurement shows that, and so does `root-gate.test.ts`, by construction.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #15.
