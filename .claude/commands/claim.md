---
description: Claim the highest-priority ready task in my area, per the task protocol
---

Claim exactly one task for **this session**, following the protocol in
`.claude/skills/laika-workflow/SKILL.md` and `CLAUDE.md` §2.

**1. Establish who you are and where you are.** Read `.sessions/` and identify
your session and its area (`server` for Builder-A; `plugin`, `cli`, `docker` for
Builder-B). If you cannot tell which session you are, **stop and ask** — do not
guess.

Then confirm you are in your **own worktree** on your **own branch**
(CLAUDE.md §4.2):

```bash
git worktree list && git branch --show-current
```

Builder-A works in `Laika-builder-a/` on `builder-a`; Builder-B in
`Laika-builder-b/` on `builder-b`. If you are on `master` or in another session's
directory, **stop** — do not claim anything from there.

**2. Refuse to double-claim.** If a file in `.tasks/in-progress/` is already
assigned to you, stop and report it. One task at a time.

**3. Take the latest integrated state.** `git merge master` on your branch.

**4. Select.** From `.tasks/backlog/`, keep only tasks where:
- `area` is one of yours, **and**
- `assignee` is `unclaimed` (or already you), **and**
- every id in `depends-on` has a file in `.tasks/done/` on `master`.

Sort by priority (`p1` before `p2` before `p3`), then by id ascending. Take the
first. If nothing qualifies, report which tasks in your area exist and what is
blocking each — then stop, do not invent work.

**5. Check every branch before you touch it.** Another session's claim lives on
their branch, not in your working tree:

```bash
git log --all --oneline -- '.tasks/in-progress/<TASK-ID>*' \
                           '.tasks/review/<TASK-ID>*' '.tasks/done/<TASK-ID>*'
```

Any output means it is already claimed, finished, or closed. Go back to step 4
and take the next one. Never skip this — it is the whole lock.

**6. Claim it.**

```bash
git mv .tasks/backlog/<file> .tasks/in-progress/
```

Edit its frontmatter: `assignee: <your-session>`, `status: in-progress`,
`started: <ISO-8601 now>`. Then:

```bash
git add .tasks/in-progress/<file>
git commit -m "chore(tasks): claim <TASK-ID> [<TASK-ID>]"
```

No push and no merge is needed — all worktrees share one object database, so
your claim commit is visible to every other session immediately.

If the move fails or the file is gone — **another session claimed it.** Say so,
go back to step 4, and pick the next one. Never move a task out of another
session's hands. If two claims landed within seconds, the earlier commit
timestamp wins and the later session releases (CLAUDE.md §2).

**7. Report and stop.** Print the task id and title, its acceptance criteria, the
spec sections it names, and the first concrete step. Then **stop and wait** —
this command claims work, it does not start it.
