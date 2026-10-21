---
id: LAI-301
title: "CLAUDE.md §5: the root gate no longer bails, and now prints a summary"
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-480]
discovered-from: LAI-480
status: backlog
---

## Goal

LAI-480 changed the root `test` script from `pnpm -r --if-present run test` to
`pnpm -r --no-bail --if-present run test`. **The command you type is still
`pnpm test`**, so §5's gate snippet is not wrong — but what the run *means* has
changed, and §5 is CHIEF's to update, not CORE's.

Filed by Strelka while building LAI-480; LAI-480 grants no crossing into
`CLAUDE.md`.

What changed, measured in `server/test/tooling/root-gate.test.ts`:

- Every workspace now runs even when an earlier one fails. A root `EXIT 1` no
  longer leaves the rest unrun.
- The exit code is still non-zero when any workspace fails.
- pnpm now ends a failing run with a line of the form
  `Summary: 1 fails, 1 passes` and `ERR_PNPM_RECURSIVE_FAIL`, where it used to
  print `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` and stop.

## Acceptance criteria

- [ ] §5 says the root gate runs every workspace past a failure (LAI-480), so a
      reader no longer has to treat `EXIT 1` as "the rest may not have run".
- [ ] CHIEF decides whether the snippet's `grep -E` line should also match
      `Summary:` so the per-workspace tally is printed, and records the call.
- [ ] The table row naming `pnpm -r` bailing stays as the record of what was
      measured (it is past tense, and §3 forbids rewriting the evidence).
