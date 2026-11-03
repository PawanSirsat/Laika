---
id: LAI-1092
title: 'laika update: the PR #243 review batch — guard comments say what each format does, Gemini/Antigravity guard tests, a re-read before the whole-file fallback, tokenIn reads from one fd'
area: cli
assignee: shell/belka
priority: p2
depends-on: [LAI-1089]
discovered-from: LAI-1089
status: review
started: 2026-11-02T13:41:17Z
finished: 2026-11-02T14:03:30Z
---

## Why

The review of PR #243 (LAI-1089, merged as `6dcdac60`) found five things in
`cli/src/update.ts`, its tests and `cli/README.md`:

1. **Two comments and the README claim more than the code does** (CLAUDE.md
   §5). `LaikaEntries` (~548), `entriesDigest` (~616) and the README guard
   paragraph (~237) say a file that is "not the format at all" is compared
   whole. That is true of the JSON files only: `codexLaikaLines` never
   throws, so `~/.codex/config.toml` is always scanned line by line and is
   never compared whole.
2. **Gemini CLI and Antigravity have no guard test.** Give either the wrong
   container and it compares `none` to `none`, so a change to its laika
   entry would pass silently.
3. **The manager-file test does not pin the no-print guarantee by itself.**
   `run()` refuses any `lai_` in the output; a planted token printed without
   its prefix would pass.
4. **`tokenIn` checks with `lstat` and then reads by path**, so the path can
   be swapped for a symlink between the two. It should open with
   `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, `fstat` the descriptor (regular file
   only) and read from that descriptor.
5. **A half-written JSON file trips a false rollback** (owner, 2026-11-02:
   required). Claude Code rewrites `~/.claude.json` every few seconds, so
   either guard read can catch it half-written. When that happens, the
   whole-file fallback hashes something that never matches. On a parse
   failure the guard must wait briefly and read again a bounded number of
   times before it falls back to the whole-file hash. If the file stays
   unparseable, the guard still fails closed.

## Acceptance criteria

- [x] The `LaikaEntries` and `entriesDigest` comments and the README guard
      paragraph say exactly what each format does: JSON is parsed, re-read on
      a parse failure, then compared whole; Codex's TOML is scanned line by
      line and never compared whole.
- [x] Guard tests for `~/.gemini/settings.json` and
      `~/.gemini/config/mcp_config.json`: a change to the laika entry rolls
      back, naming the file, and an unrelated change in the same file does
      not.
- [x] The manager-file test asserts the planted token's marker
      (`POLLYPLANTED`) is in neither stdout nor stderr.
- [x] `tokenIn` opens with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, accepts a
      regular file only (checked with `fstat` on the descriptor), reads from
      that descriptor and always closes it. Tests: a path swapped for a
      symlink after the check is not followed, and a FIFO that holds a
      tool's token is not read.
- [x] On a parse failure, the MCP guard waits briefly (100–250 ms) and
      re-reads, at most 2–3 times, before it falls back to the whole-file
      hash. The loop is never unbounded. Tests: a file that is unparseable
      at the first read and valid with an unchanged laika entry at the
      re-read does not roll back, at either guard read. A file that stays
      unparseable still rolls back, after exactly the bounded number of
      waits.
- [x] Each change has a test that goes red when the change is undone
      (mutation-checked, with each file restored by checksum).
- [x] `cli/README.md` documents the re-read; the touched section stays
      wrapped to 80 columns.

## Notes / context

- Scope: `cli/src/update.ts`, `cli/test/update.test.ts`, `cli/README.md`. No
  new dependencies.
- Belka load rule: one test file at a time, single worker, wait while the
  1-minute load is above 15. Do not run the full suite locally; CI runs the
  gate.

## Done (2026-11-02, SHELL on Belka)

- Item 5 became required mid-task (owner). The wait is `UpdateIo.sleep`, 150
  ms, with at most 2 re-reads; tests inject it, so none of them sleeps.
- Codex's `config.toml` never fails to parse, so it gets no re-read: a
  half-written one that cuts the laika table compares as changed, and the
  update rolls back (fails closed). That is noted here and left unchanged.
- The `O_NONBLOCK` mutant makes the FIFO test hang rather than fail (the open
  waits for a writer); the mutation check bounded it with a 240 s alarm.
- Mutation checks: 15 of 15 red. Log: `logs/shell-2026-11-02-LAI-1092.md`.
