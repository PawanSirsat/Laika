---
description: Board status — done since last standup, in progress by whom, blocked, next up
---

Produce a standup report for the Laika board. Read, do not write: this command
changes nothing.

**Gather**

1. All files in `.tasks/done/`, `.tasks/review/`, `.tasks/in-progress/`, and
   `.tasks/backlog/` — read the frontmatter of each (`id`, `title`, `area`,
   `assignee`, `priority`, `depends-on`, `discovered-from`, `status`, timestamps).
2. The most recent file in `logs/` for each session, plus anything since the last
   standup entry in `logs/pm-*.md`.
3. `git log --oneline -30` for commits not yet reflected in the task files.

**Output exactly these five sections**

**Done since last standup** — tasks now in `.tasks/done/`, with id, title, who
did it. If none, say so plainly.

**In progress** — one line per task in `.tasks/in-progress/`: id, title,
assignee, how long since `started`. Flag anything older than a day as **stale**.

**In review** — tasks in `.tasks/review/` waiting on PM, oldest first. This is
PM's own queue; call it out if it is growing.

**Blocked** — anything whose `depends-on` includes an id not in `.tasks/done/`.
Name the blocking id. Also list any task file or log entry that reports being
stuck.

**Next up** — the highest-priority *ready* tasks (unclaimed, dependencies all
done), split by area, with the specific next action for Builder-A and Builder-B.

**Then**: note any drift you spotted — commits with no task id, work in an area
its author does not own, criteria ticked with no matching commit, tasks in
progress with no log entry. State it factually; do not fix it here.

Keep it short enough to read standing up.
