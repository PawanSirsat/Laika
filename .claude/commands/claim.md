---
description: Claim the highest-priority ready task in my area, per the task protocol
---

Claim exactly one task for **this session**, following the protocol in
`.claude/skills/laika-workflow/SKILL.md` and `CLAUDE.md` §2.

**1. Establish who you are.** Read `.sessions/` and identify your session and its
area (`server` for Builder-A; `plugin`, `cli`, `docker` for Builder-B). If you
cannot tell which session you are, **stop and ask** — do not guess.

**2. Refuse to double-claim.** If a file in `.tasks/in-progress/` is already
assigned to you, stop and report it. One task at a time.

**3. Select.** From `.tasks/backlog/`, keep only tasks where:
- `area` is one of yours, **and**
- `assignee` is `unclaimed` (or already you), **and**
- every id in `depends-on` has a file in `.tasks/done/`.

Sort by priority (`p1` before `p2` before `p3`), then by id ascending. Take the
first. If nothing qualifies, report which tasks in your area exist and what is
blocking each — then stop, do not invent work.

**4. Claim it.**

```bash
git pull --rebase
git mv .tasks/backlog/<file> .tasks/in-progress/
```

Edit its frontmatter: `assignee: <your-session>`, `status: in-progress`,
`started: <ISO-8601 now>`. Then:

```bash
git add .tasks/in-progress/<file>
git commit -m "chore(tasks): claim <TASK-ID> [<TASK-ID>]"
git push
```

If the move fails, the rebase shows the file already moved, or the file is
gone — **another session claimed it.** Say so, go back to step 3, and pick the
next one. Never move a task out of another session's hands.

**5. Report and stop.** Print the task id and title, its acceptance criteria, the
spec sections it names, and the first concrete step. Then **stop and wait** —
this command claims work, it does not start it.
