---
id: LAI-716
title: 'Hand Laika over to the next agent — AGENTS.md, a handover doc, an env template'
area: docs
assignee: chief
priority: p1
depends-on: [LAI-714]
status: in-progress
started: 2026-10-08T09:40:00Z
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

- [ ] An agent in any harness finds the entry point, the reading order and the
      rules that are not optional.
- [ ] The handover says where everything runs (AWS account, stacks, instance,
      container, database, backups, image registry, secret, pipeline), with
      identifiers checked against the live account, not recalled.
- [ ] It says how a change reaches production, how to watch it, and what to do
      when it is red, including the manual fallback.
- [ ] It says how development works: setup, commands, the gate, the task
      protocol, branches, commits, ids, logs and decisions.
- [ ] **No secret value is written anywhere.** The repository is public. The
      env template carries the non-secret values, and for each secret where
      it lives and how the agent gets its own.
- [ ] Known issues and open work are listed, with task ids.
