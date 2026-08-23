# plugin/skills/ — skills shipped to agents

Each skill is its own directory with a `SKILL.md` inside
(`skills/<name>/SKILL.md`). A loose `.md` at this level — like this README — is
not loaded as a skill.

Empty today. **Filled in M4.**

## What goes here

One skill teaching an agent how to work a Laika board, per SPEC §5:

- claim before you code — the task moves to `in_progress` first
- finish means `review`, never `done`; humans close work (`finish_task` in
  SPEC §4 stops at review for the same reason)
- record `discovered_from` when one task turns up another
- `log_unlisted_work` for work that belongs to no project yet

## Not to be confused with

`.claude/skills/` at the repo root, which configures the three sessions building
Laika. This directory ships to Laika's **users**. They are unrelated.
