# .tasks/ — the board

One markdown file per task. The **directory a file lives in is its status**, and
moving the file is the lock. Copy `TEMPLATE.md` to create a new task.

```
backlog/      unclaimed, or claimed-but-not-started
in-progress/  exactly one session is working on it right now
review/       builder says done; waiting on PM
done/         PM verified the acceptance criteria
```

Filename: `LAI-00X-short-slug.md`. Ids are never reused.

Full protocol — claiming, releasing, discovered-from, who may move what — is in
`/CLAUDE.md` §2 and `.claude/skills/laika-workflow/SKILL.md`.
