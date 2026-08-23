---
description: PM only — review every task in .tasks/review/ against its acceptance criteria
---

**PM session only.** If you are a builder, stop: you cannot move tasks to done.

For **each** file in `.tasks/review/`, oldest first:

**1. Read the task.** Goal, every acceptance criterion, notes, `depends-on`.

**2. Read the actual diff**, not the summary. The work is on the builder's
branch, not on `master`:

```bash
git log --all --oneline --grep="<TASK-ID>"
git log master..builder-a --oneline          # or builder-b
git diff master...builder-a -- <the area that task owns>
```

Also read the builder's log entry for that task in `logs/<session>-*.md`.

**3. Check each criterion against the diff.** A ticked box is a claim, not
evidence. For each one, find the code that satisfies it. Where a criterion says
"tested", find the test and confirm it asserts the thing.

**4. Check the boundaries.**
- Did the diff touch only files that session owns? (Root-level files only if the
  task explicitly named them, file by file.)
- Commit messages in `<type>(<area>): <summary> [<task-id>]` format?
- `can()` called on every endpoint the diff added? All DB access through Drizzle?
  TypeScript strict, no unexplained `@ts-ignore`? New dependencies named in the
  task?
- Log entry written, with real file paths and actual decisions?

**5. Decide.**

*Accept* — every criterion is met and the boundaries hold. **PM is the sole
integrator** (CLAUDE.md §4.2): merge the builder's branch, then close the task.
```bash
git merge --no-ff builder-a        # or builder-b — whichever owns the task
git mv .tasks/review/<file> .tasks/done/
```
If the merge conflicts, resolve it in PM's favour for `docs/`, `.tasks/`,
`.claude/` and `CLAUDE.md`, and in the builder's favour inside their own area.
A conflict outside those bounds means a boundary was crossed — send it back.
Set `status: done` and `reviewed: <ISO-8601>` in the frontmatter. Append a short
`## Review` section noting what you verified. Commit:
`chore(tasks): accept <TASK-ID> [<TASK-ID>]`

*Send back* — anything is unmet, unverifiable, or out of bounds:
```bash
git mv .tasks/review/<file> .tasks/in-progress/
```
Set `status: in-progress`, untick the criteria that are not actually met, and
append:
```markdown
## Review notes — <ISO-8601>
- [ ] <specific, checkable thing to fix — not "improve error handling">
```
Commit: `chore(tasks): review changes requested <TASK-ID> [<TASK-ID>]`

Send back for unmet criteria, missing tests, or crossed boundaries. Do **not**
send back over style preferences the task never asked for — if you want a
different approach, that is a new task.

**6. File what you found.** Anything real but out of scope becomes a new backlog
task with `discovered-from: <TASK-ID>`. Never widen a task during review.

**7. Log it.** Append one entry per reviewed task to `logs/pm-<today>.md`: task
id, accepted or returned, what you verified, what you filed. Then print a summary
of accepted / returned / newly filed.
