---
id: LAI-421
title: The skill that teaches an agent the claim protocol
area: plugin
assignee: unclaimed
priority: p2
depends-on: [LAI-419]
discovered-from:
status: backlog
---

## Goal

SPEC §8: a skill teaching **claim-before-code**, **`finish_task` → `review`**,
**`discovered_from`**, and **`log_unlisted_work`**.

This is the piece that makes an agent a *good* board citizen rather than merely a
connected one. Without it an agent will write code and then look for a task, or
close its own work, or silently drop what it noticed on the way.

`plugin/skills/README.md` exists as a stub from LAI-012.

## Acceptance criteria

- [ ] **Claim before code.** The skill states that an agent picks a ready task
      and calls `start_working` **before** editing, and that a `409` naming
      another assignee means pick a different task — never force it.
- [ ] **`finish_task` stops at `review`.** The skill says agents do not close
      their own work and explains why, because an agent that knows the reason
      will not look for a way around it (§7.2).
- [ ] **`discovered_from`.** Work found mid-task becomes a new task carrying the
      id it was found from — not done inline, not dropped. This is the single
      habit that makes the board's history worth reading.
- [ ] **`log_unlisted_work`** for anything outside every project, and what makes
      that different from a task.
- [ ] It teaches the **tools**, not Laika's internals. An agent needs to know
      `update_status` validates transitions; it does not need §5's diagram.
- [ ] **Written for an agent that has never seen this board**, and readable
      without the SPEC open beside it.
- [ ] It does **not** duplicate `.claude/skills/laika-workflow/SKILL.md`. That
      one governs the three sessions **building** Laika and describes a
      git-and-task-file protocol that does not exist for a user's agent — no
      `git mv` claim, no `.tasks/` directory, no worktrees. Confusing the two
      would teach a user's agent a protocol their board does not run.
- [ ] Full gate green.

## Notes

No new dependencies.

Take the tone from the existing `.claude/skills/` files — direct, specific, and
saying *why* — without taking their content.
