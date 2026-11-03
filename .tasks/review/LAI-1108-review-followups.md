---
id: LAI-1108
title: 'Review follow-ups from PRs #252, #255 and #256: launcher reuse and permanent failures, Omnigent identity, Ping'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1101, LAI-1102, LAI-1107]
discovered-from: LAI-1107
status: review
started: 2026-11-03T18:12:00+05:30
finished: 2026-11-03T18:40:35+05:30
---

## Why

The reviews of PR #256 (LAI-1107), PR #252 (LAI-1101) and PR #255 (LAI-1102)
passed each with non-blocking findings. They are batched here as one
follow-up (CLAUDE.md §4: several small fixes in one area ship together).

## Acceptance criteria

Launcher (from #256):

- [x] **(a)** `reusedWorktreeProblem` refuses a recorded path that is now a
      symlink to another checkout: the real path must equal the recorded one,
      and the worktree's `git rev-parse --git-common-dir` must be the
      configured repository's.
- [x] **(b)** A permanent `ls-remote` or fetch failure (authentication failed,
      repository not found, permission denied) is a refusal, in
      `prepareWorkspace` and in `handoff prepare`. Network, 5xx and timeouts
      stay retried.
- [x] **(c)** A backoff entry is cleared when its offer or request closes, and
      none outlives a bounded time.
- [x] **(d)** `cli/README.md` says a record left by a pre-#256 launcher counts
      as hand-prepared once (fail closed).

Omnigent (from #252):

- [x] **(e)** The Codex hooks take `CODEX_HOME` from the `codex` process's
      environment, as the marker reads `OMNIGENT` there, so a hook reads the
      same config copy the worker's MCP reads.
- [x] **(f)** The run's `OMNIGENT` is recorded with the stored identity, and a
      session start decides again when it differs (a manual `claude --resume`
      of an Omnigent worker).
- [x] **(g)** Known switching-helper texts are kept in a list (like
      `OLDER_CLAUDE_HELPERS`), pinned by a test, so a later edit to the helper
      does not strand a device that has an earlier one.
- [x] **(h)** `tool add claude-code` and `tool add codex` honour
      `CLAUDE_CONFIG_DIR` / `CODEX_HOME` as the hooks do.

Web (from #255):

- [x] **(i)** `PingButton`'s check has a timeout, so a hanging request cannot
      hold Ping.
- [x] **(j)** `whyNoPing` says *Your role in X is viewer* only for a space the
      reader is a member of.
- [x] **(k)** An idle Ping leaves no empty-wrapper gap.
- [x] **(l)** Inside the 8 s wait, each kind of state change is announced at
      most once, not on every failed/recovered flap.

- [x] Each item has a test that goes red when the fix is undone.

## Notes

- SHELL areas only: `cli/` and `server/web/`. If the web half grows, it
  ships as its own PR; no file is in both.
- Dispatched by polly (Belka); PR(s) into `master`.

## Evidence

- Tests (node --test, one file at a time, `--test-concurrency=1`, OMNIGENT
  unset; the hook suite double-forked away from Omnigent):
  - (a) `cli/test/agent-workspace.test.ts` describe *LAI-1108: a reused
    worktree is the one made there, of the configured repository* (3).
  - (b) same file, *LAI-1108: a remote that refuses the repository is a
    refusal, not unreachable* (3); `cli/test/agent-handoff.test.ts`, two
    *LAI-1108:* tests in *LAI-1107: prepare tells "could not reach"…*.
  - (c) `cli/test/agent-launcher.test.ts` describe *LAI-1108: a backoff ends
    with its offer, or after a bounded time* (2).
  - (e)(f)(g) `cli/test/agent-hooks-omnigent.test.ts` describes *LAI-1108
    (e)* (4, one through the real hook as a stand-in `codex`), *(f)* (2,
    through the real hook), *(g)* (2).
  - (h) `cli/test/device-pair-tool-add.test.ts`, two *LAI-1108 (h)* tests.
  - (i)(k)(l) `server/web/test/browser/auto-pickup.test.ts` describe
    *LAI-1108: Ping review follow-ups (PR #255)* (4); (j)
    `server/web/test/components/agent/capacity-derive.test.ts`, one.
- 24 mutations, each undoing one fix: every one turned its own test red,
  and each file was restored by checksum. The log lists them.
- (d) is prose: `cli/README.md`, the launcher's *Could not reach is not a
  refusal* paragraph.
- Not run here: the `*-e2e` CLI files (they spawn the real server) — left
  to CI, as in LAI-1107.
