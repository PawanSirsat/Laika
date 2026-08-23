---
name: laika-workflow
description: Use when working in the Laika repo - before claiming, starting, finishing, or discovering work. Covers the task-file protocol (claim by git mv, one task at a time, review handoff), ownership boundaries between PM/Builder-A/Builder-B, and what to do when you find work you were not asked to do.
---

# Laika workflow

Three sessions share one branch. Nothing here is a suggestion — the protocol is
what stops two sessions from writing the same file.

## Before anything

1. `git pull --rebase`
2. Read `docs/SPEC.md` (skim if you have read it this session; re-read the
   sections your task names).
3. Read `.sessions/<you>.md`. If you do not know which session you are, **stop
   and ask.** Guessing costs more than asking.

## Ownership — memorise this

| You are | You may edit | Never |
| --- | --- | --- |
| PM | `docs/`, `.tasks/`, `.claude/`, `CLAUDE.md`, `logs/pm-*.md` | any application code |
| Builder-A | `server/` | `plugin/`, `cli/`, `docker/`, `docs/` |
| Builder-B | `plugin/`, `cli/`, `docker/` | `server/`, `docs/` |

Plus your own log file and your own claimed task file. Nothing else.

A task file may widen your area **only** by naming exact files (LAI-001 does this
for repo-root config). Vague permission is no permission.

## Claiming — the move is the lock

There is no lock file and no database. The lock is that `git mv` + commit either
lands or it doesn't.

```bash
git pull --rebase
# pick ONE from .tasks/backlog/ that is yours: right area, unclaimed,
# and every id in depends-on is present in .tasks/done/
git mv .tasks/backlog/LAI-00X-slug.md .tasks/in-progress/
# edit frontmatter: assignee: <you>, status: in-progress, started: <ISO-8601>
git add .tasks/in-progress/LAI-00X-slug.md
git commit -m "chore(tasks): claim LAI-00X [LAI-00X]"
git push
```

**Commit the claim before you write a single line of code.** The commit is what
tells the other sessions to back off.

If the `git mv` fails, or the rebase shows the file already moved, or it is
simply gone — **someone else claimed it. Pick a different task.** Do not move it
back. Do not "just check with them". Pick another and move on.

**One task in progress per session.** If you need to stop, move the file back to
`.tasks/backlog/`, reset `assignee: unclaimed` and `status: backlog`, commit, and
say why in your log.

## While working

- Commit small, in your own area only: `<type>(<area>): <summary> [<task-id>]`
- Stage explicit paths. Never `git add -A` from the repo root.
- `git pull --rebase` before every commit.
- If a criterion turns out to be wrong or impossible, do **not** silently drop
  it. Note it in the task file, say so in your log, and flag it for PM at review.

## Discovering work mid-task

You will find things. Bugs, missing endpoints, a config that should exist. The
temptation is to fix it while you are there. Don't.

Write a new task file in `.tasks/backlog/` from `.tasks/TEMPLATE.md`:

```yaml
id: LAI-0NN                 # next unused number — check all four .tasks/ dirs
area: server                # where the work actually belongs, not where you found it
assignee: unclaimed
discovered-from: LAI-00X    # the task you are on right now
status: backlog
```

Then mention it in your log entry and carry on with what you were doing.

Why: a fix outside your task is a fix nobody reviewed, in a commit nobody
expected, possibly in someone else's area. `discovered-from` keeps the trail —
six weeks from now it is the only record of why that task exists.

## Finishing

1. Tick every acceptance criterion in the file: `- [x]`.
2. Run lint, typecheck and tests. If they do not pass, you are not finished.
3. Set `status: review` and `finished: <ISO-8601>`.
4. `git mv .tasks/in-progress/LAI-00X-slug.md .tasks/review/`
5. Commit and push.
6. **Write your log entry** — see the `laika-logging` skill.

**Builders never move anything to `.tasks/done/`.** Only PM does, after checking
the criteria against the actual diff. If PM sends it back, it returns to
`.tasks/in-progress/` with review notes appended — read them, fix, move to review
again.

## Red flags

| Thought | Reality |
| --- | --- |
| "It's a one-line fix in their area" | It's their area. Write a task. |
| "I'll claim it after I start" | The claim commit *is* the start. |
| "I'll batch the log at the end" | You will forget the decisions. Log per task. |
| "No task file, but it's obviously needed" | Then write the task file. Takes two minutes. |
| "I'll mark my own task done" | Only PM moves to done. |
| "Force-push will fix this rebase" | It will destroy someone's commit. Stop and ask. |
