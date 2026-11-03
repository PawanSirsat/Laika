---
id: LAI-1104
title: 'Codex through the launcher: one live run, and whether http_headers_helper wins'
area: cli
assignee: unclaimed
priority: p3
depends-on: [LAI-1039]
discovered-from: LAI-1039
status: backlog
---

## Goal

LAI-1039 ships Codex support **off by default**: `enable` adds it only when
the owner types `danger-full-access`. Its spike (plan "Unverified" 1–4) was
blocked by Codex's usage limit (until 2026-11-04 12:26 IST), so it measured
the sandbox without a model: under `codex sandbox -P :workspace` a `git
commit` fails with `index.lock: Operation not permitted` in a worktree **and
in a plain checkout**; `-c sandbox_workspace_write.writable_roots` is not
honoured by a named profile, so `--add-dir <common .git>` stays unmeasured;
`:danger-full-access` commits. The docs say an explicit bearer token beats a
helper's header.

## Acceptance criteria

- [ ] One real `codex exec` run started by the launcher on a throwaway task:
      prompt on stdin via `-`, MCP reached through `http_headers_helper`
      (`laika agent launcher headers codex`) with no token in any
      environment, `start_working` and `finish_task` succeed. Recorded with
      the run's `thread_id` and exit code.
- [ ] Whether `--add-dir <common .git>` lets `workspace-write` commit in a
      worktree, measured with a model run; if it does, `enable` may offer it
      instead of full access (a decision for the owner).
- [ ] Whether `SessionStart` fires in `codex exec`; if not, the launcher's
      `laika agent session start` + `LAIKA_LAUNCH_SESSION` path (plan §2).
- [ ] What happens when `~/.codex/config.toml` still has `bearer_token_env_var`
      (as `tool add codex` writes it before LAI-1101) and the variable is unset.

## Notes / context

Measured commands and outputs are in `logs/chief-builder-2026-11-03-LAI-1039.md`.
