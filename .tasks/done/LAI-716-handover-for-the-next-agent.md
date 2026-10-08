---
id: LAI-716
title: 'Hand Laika over to the next agent — AGENTS.md, a handover doc, an env template'
area: docs
assignee: chief
priority: p1
depends-on: [LAI-714]
status: done
started: 2026-10-08T09:40:00Z
finished: 2026-10-08T09:31:26Z
---

## Goal

The owner, 2026-10-08: *"add everything in an md file so the omni agent will
know … I'm going to hand over everything to the omni agent … add all creds in
.env … also tell them how to do development and all."* The next agent runs in a
multi-model harness, not necessarily Claude Code.

## Scope — the exact files (CLAUDE.md §1)

- `AGENTS.md` (new, repo root) — the entry point most agent harnesses read
- `docs/HANDOVER.md` (new)
- `docs/agent.env.example` (new)

## Acceptance criteria

- [x] An agent in any harness finds the entry point, the reading order and the
      rules that are not optional.
- [x] The handover says where everything runs (AWS account, stacks, instance,
      container, database, backups, image registry, secret, pipeline), with
      identifiers checked against the live account, not recalled.
- [x] It says how a change reaches production, how to watch it, and what to do
      when it is red, including the manual fallback.
- [x] It says how development works: setup, commands, the gate, the task
      protocol, branches, commits, ids, logs and decisions.
- [x] **No secret value is written anywhere.** The repository is public. The
      env template carries the non-secret values, and for each secret where
      it lives and how the agent gets its own.
- [x] Known issues and open work are listed, with task ids.

## CHIEF — done 2026-10-08T09:31:26Z

- `AGENTS.md` at the repo root is the entry point most harnesses read. It gives
  the reading order (HANDOVER, CLAUDE.md, SPEC and DECISIONS, the task) and the
  rules that are not optional.
- `docs/HANDOVER.md` covers where everything runs, the pipeline and what to do
  when it is red, development, credentials, safe production operations, state
  at handover, known issues, and working with the owner.
  - Every identifier was checked against the live account, the repository or
    the server: stacks `laika` and `laika-github-deploy`, the instance, the
    Elastic IP, the container's mounts, the secret's name, the backups
    directory, the dependencies, invites and Tokens.
- **No secret anywhere, and no production address** (LAI-627's rule for this
  public repo). Committed files point to the stack output. The real values are
  in `.env.agent` on the owner's machine, gitignored, mode 600. Secrets are
  left empty: the owner creates the agent's own GitHub and Laika tokens.
- The owner asked for "all creds in .env". The repository is public and the
  credentials are the owner's personal sessions, so none were extracted. The
  reason is recorded here and given to the owner.
- `aws-secrets-manager`, which the global instructions require loading for
  credential tasks, is not installed in this environment. Its rule was followed
  by hand: no secret value entered the conversation.
