---
name: laika-workflow
description: Use when working in the Laika repo - before claiming, starting, finishing, or discovering work. Covers the task-file protocol (claim by git mv, one task at a time, review handoff), ownership boundaries between PM/Builder-A/Builder-B, and what to do when you find work you were not asked to do.
---

# Laika workflow

Three sessions share one branch. Nothing here is a suggestion — the protocol is
what stops two sessions from writing the same file.

## Before anything

0. **Confirm where you are.** `git worktree list && git branch --show-current`.
   PM works in `Laika/` on `master`; Builder-A in `Laika-builder-a/` on
   `builder-a`; Builder-B in `Laika-builder-b/` on `builder-b`. Wrong directory
   or wrong branch — stop and fix that first.
1. `git merge master` (builders never merge *out*; PM integrates)
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

There is no lock file and no database. The lock is a commit that either exists
or doesn't — and because all three worktrees share **one** object database, a
claim commit on any branch is visible to everyone the instant it is made. No
push, no fetch, no waiting.

```bash
git merge master
# pick ONE from .tasks/backlog/ that is yours: right area, unclaimed,
# and every id in depends-on is present in .tasks/done/ on master

# CHECK EVERY BRANCH — a rival claim is on their branch, not in your tree:
git log --all --oneline -- '.tasks/in-progress/LAI-00X*' \
                           '.tasks/review/LAI-00X*' '.tasks/done/LAI-00X*'
# any output at all => already taken, pick another

git mv .tasks/backlog/LAI-00X-slug.md .tasks/in-progress/
# edit frontmatter: assignee: <you>, status: in-progress, started: <ISO-8601>
git add .tasks/in-progress/LAI-00X-slug.md
git commit -m "chore(tasks): claim LAI-00X [LAI-00X]"
```

**Commit the claim before you write a single line of code.** The commit is what
tells the other sessions to back off.

**The `--all` check is the whole lock.** Skipping it because your working tree
looks clear is exactly the mistake that isolation was supposed to prevent — your
tree cannot see another branch.

If the `git mv` fails, the file is gone, or the check turns up a rival claim —
**someone else has it. Pick a different task.** Do not move it back. Do not
"just check with them". If two claims landed within seconds, the earlier commit
timestamp wins; the later session moves its copy back to `.tasks/backlog/`,
resets `assignee: unclaimed`, commits, and logs it.

**One task in progress per session.** If you need to stop, move the file back to
`.tasks/backlog/`, reset `assignee: unclaimed` and `status: backlog`, commit, and
say why in your log.

## While working

- Commit small, in your own area only: `<type>(<area>): <summary> [<task-id>]`
- **Stage explicit paths. Never `git add -A` from the repo root.** Your worktree
  makes this survivable rather than catastrophic — it is still wrong.
- `git merge master` when master moves. Never rebase your branch: PM reads it
  during review, and rewriting shared commits breaks that.
- If a criterion turns out to be wrong or impossible, do **not** silently drop
  it. Note it in the task file, say so in your log, and flag it for PM at review.

## Discovering work mid-task

You will find things. Bugs, missing endpoints, a config that should exist. The
temptation is to fix it while you are there. Don't.

Write a new task file in `.tasks/backlog/` from `.tasks/TEMPLATE.md`:

```yaml
id: LAI-0NN                 # lowest unused number IN YOUR OWN RANGE (D-017):
                            # PM 001-099 · Builder-A 100-199 · Builder-B 200-299
                            # check across branches, not just your tree:
                            #   git log --all --name-only --format= -- .tasks/ \
                            #     | grep -o 'LAI-[0-9]*' | sort -u
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
5. Commit. Leave it on your branch — **PM merges it into `master`** when
   accepting (CLAUDE.md §4.2). Never merge into `master` yourself.
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
| "My tree is clean, so the task is free" | Your tree can't see their branch. Run the `--all` check. |
| "I'll merge my branch into master myself" | PM integrates. Your branch waits in review. |
| "I'll take the next free id" | Take the next free id **in your range**. Free-for-all collided twice. |
