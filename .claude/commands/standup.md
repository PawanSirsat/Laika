---
description: Board status — done since last standup, in progress by whom, blocked, next up
---

Produce a standup report for the Laika board. Read, do not write: this command
changes nothing.

**Gather**

1. **Read across all branches, not the working tree.** Sessions work in separate
   worktrees on `core` / `shell` (CLAUDE.md §4.2), so `master`'s
   `.tasks/` shows only the last integration — in-flight work is invisible there.

   ```bash
   git log --all --name-status --oneline -50 -- .tasks/
   for b in master core shell; do
     echo "== $b =="; git ls-tree -r --name-only $b -- .tasks/in-progress .tasks/review
   done
   ```

   Then read the frontmatter of each task file from the branch that has the
   newest version (`git show <branch>:<path>`): `id`, `title`, `area`,
   `assignee`, `priority`, `depends-on`, `discovered-from`, `status`, timestamps.
2. Logs from every branch — `git log --all --name-only -- logs/` then
   `git show <branch>:logs/<file>` — plus anything since the last standup entry
   in `logs/chief-*.md`.
3. `git log --all --oneline -30` and `git log master..core`,
   `git log master..shell` for work committed but not yet integrated.

**Output exactly these five sections**

**Done since last standup** — tasks now in `.tasks/done/`, with id, title, who
did it. If none, say so plainly.

**In progress** — one line per task in `.tasks/in-progress/`: id, title,
assignee, how long since `started`. Flag anything older than a day as **stale**.

**In review** — tasks in `.tasks/review/` waiting on CHIEF, oldest first. This is
CHIEF's own queue; call it out if it is growing.

**Blocked** — anything whose `depends-on` includes an id not in `.tasks/done/`.
Name the blocking id. Also list any task file or log entry that reports being
stuck.

**Next up** — the highest-priority *ready* tasks (unclaimed, dependencies all
done), split by area, with the specific next action for CORE and SHELL.

**Unintegrated** — commits on `core` / `shell` that are not yet in
`master` (`git log master..<branch> --oneline`). This is CHIEF's merge queue; a
builder branch drifting far ahead of `master` is a review backlog, not progress.

**Then**: note any drift you spotted — commits with no task id, work in an area
its author does not own, criteria ticked with no matching commit, tasks in
progress with no log entry. State it factually; do not fix it here.

Keep it short enough to read standing up.
