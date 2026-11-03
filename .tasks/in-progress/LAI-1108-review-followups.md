---
id: LAI-1108
title: 'Review follow-ups from PRs #252, #255 and #256: launcher reuse and permanent failures, Omnigent identity, Ping'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1101, LAI-1102, LAI-1107]
discovered-from: LAI-1107
status: in-progress
started: 2026-11-03T18:12:00+05:30
---

## Why

The reviews of PR #256 (LAI-1107), PR #252 (LAI-1101) and PR #255 (LAI-1102)
passed each with non-blocking findings. They are batched here as one
follow-up (CLAUDE.md §4: several small fixes in one area ship together).

## Acceptance criteria

Launcher (from #256):

- [ ] **(a)** `reusedWorktreeProblem` refuses a recorded path that is now a
      symlink to another checkout: the real path must equal the recorded one,
      and the worktree's `git rev-parse --git-common-dir` must be the
      configured repository's.
- [ ] **(b)** A permanent `ls-remote` or fetch failure (authentication failed,
      repository not found, permission denied) is a refusal, in
      `prepareWorkspace` and in `handoff prepare`. Network, 5xx and timeouts
      stay retried.
- [ ] **(c)** A backoff entry is cleared when its offer or request closes, and
      none outlives a bounded time.
- [ ] **(d)** `cli/README.md` says a record left by a pre-#256 launcher counts
      as hand-prepared once (fail closed).

Omnigent (from #252):

- [ ] **(e)** The Codex hooks take `CODEX_HOME` from the `codex` process's
      environment, as the marker reads `OMNIGENT` there, so a hook reads the
      same config copy the worker's MCP reads.
- [ ] **(f)** The run's `OMNIGENT` is recorded with the stored identity, and a
      session start decides again when it differs (a manual `claude --resume`
      of an Omnigent worker).
- [ ] **(g)** Known switching-helper texts are kept in a list (like
      `OLDER_CLAUDE_HELPERS`), pinned by a test, so a later edit to the helper
      does not strand a device that has an earlier one.
- [ ] **(h)** `tool add claude-code` and `tool add codex` honour
      `CLAUDE_CONFIG_DIR` / `CODEX_HOME` as the hooks do.

Web (from #255):

- [ ] **(i)** `PingButton`'s check has a timeout, so a hanging request cannot
      hold Ping.
- [ ] **(j)** `whyNoPing` says *Your role in X is viewer* only for a space the
      reader is a member of.
- [ ] **(k)** An idle Ping leaves no empty-wrapper gap.
- [ ] **(l)** Inside the 8 s wait, each kind of state change is announced at
      most once, not on every failed/recovered flap.

- [ ] Each item has a test that goes red when the fix is undone.

## Notes

- SHELL areas only: `cli/` and `server/web/`. If the web half grows, it
  ships as its own PR; no file is in both.
- Dispatched by polly (Belka); PR(s) into `master`.
