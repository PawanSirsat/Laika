# Laika — working agreement for all sessions

Laika is a self-hosted project board where humans and Claude Code agents share one
source of truth. Three sessions build it in parallel: **PM**, **Builder-A**,
**Builder-B**. These rules exist so we never collide. They are not advisory.

## 0. Before any work

1. Read `docs/SPEC.md`.
2. Read your own identity file in `.sessions/` (`pm.md`, `builder-a.md`, or
   `builder-b.md`). It tells you who you are and what you own.
3. Read the task file you are about to work on, top to bottom, including
   `depends-on`.

If you do not know which session you are, stop and ask. Do not guess.

## 1. Roles and ownership

| Session | Owns (may edit) | Must never edit |
| --- | --- | --- |
| **PM** | `docs/`, `.tasks/`, `logs/pm-*.md`, `.sessions/pm.md`, `.claude/`, `CLAUDE.md` | any application code |
| **Builder-A** | `server/` | `plugin/`, `cli/`, `docker/`, `docs/`, other sessions' logs |
| **Builder-B** | `plugin/`, `cli/`, `docker/` | `server/`, `docs/`, other sessions' logs |

Every session may edit its own log file and move its own task files, and nothing
else outside the table.

**PM writes no application code, ever.** If PM identifies code that needs
writing, PM writes a task file instead.

**Scope exceptions are granted only by a task file.** A task may widen your area
if it names the exact files, one by one (LAI-001 does this for repo-root config).
A task that says "and whatever else is needed" grants nothing.

**If you need a change outside your area, do not make it.** Write a task file in
`.tasks/backlog/` describing the change, with the correct `area:`, and continue
with what you can do without it. If it blocks you, add its id to your current
task's `depends-on`, move your task back to `.tasks/backlog/`, and say so in your
log.

## 2. Task protocol

Work **only** from task files. No task file, no work.

Two narrow exceptions, both PM-only: repo maintenance the owner asks for
directly (workflow, docs, git config) and this bootstrap. Those carry `[ops]` or
`[bootstrap]` in the commit's id slot and are recorded in `logs/pm-*.md` instead
of a task file. Builders have no equivalent exception.

**Claiming (the move is the lock).**
1. Pick ONE file from `.tasks/backlog/` whose `area` is yours, whose
   `assignee` is `unclaimed` or you, and whose `depends-on` ids are all present
   in `.tasks/done/`.
2. `git pull --rebase` first.
3. `git mv .tasks/backlog/LAI-00X-*.md .tasks/in-progress/`
4. Edit its frontmatter: `assignee: <your-session>`, `status: in-progress`,
   `started: <ISO-8601 timestamp>`.
5. Commit that move **before writing any code**:
   `chore(tasks): claim LAI-00X [LAI-00X]`
6. If the move fails, or the file is already gone, or the rebase shows someone
   else moved it — **another session claimed it. Pick a different task.** Never
   force it, never move a file back out of someone else's hands.

**One task in progress per session.** Finish or release before claiming another.

**Finishing.** Tick every acceptance criterion in the file (`- [x]`), set
`status: review` and `finished: <timestamp>`, `git mv` it to `.tasks/review/`,
and commit. Then write your log entry.

**Only PM moves `.tasks/review/` → `.tasks/done/`.** Builders never mark their
own work done. If PM sends a task back, it returns to `.tasks/in-progress/` with
review notes appended to the file — read them, fix, and move it to review again.

## 3. Logging

After **every** task and at the end of **every** session, append to
`logs/<session>-<YYYY-MM-DD>.md`:

- timestamp (ISO-8601)
- task id
- what changed — the actual file paths
- decisions made, and why
- anything discovered: surprises, dead ends, things the spec got wrong

Format and a worked example live in `.claude/skills/laika-logging/SKILL.md`.

If you discover new work mid-task, **do not do it**. Create a new task file in
`.tasks/backlog/` with `discovered-from: <the-task-id-you-are-on>` in its
frontmatter, and mention it in your log entry.

## 4. Git

- Small commits. One logical change each.
- Message format: `<type>(<area>): <summary> [<task-id>]`
  e.g. `feat(server): add task CRUD endpoints [LAI-004]`
  Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- **Always `git pull --rebase` before committing.** Three sessions push to one
  branch; rebase is what keeps the task-file lock honest.
- Builders commit **only files inside their own area** (plus their own log and
  their own task file). Never `git add -A` from the repo root — stage explicit
  paths.
- Never amend, rebase-edit, revert, or force-push another session's commits.

### 4.1 GitHub account — personal only

This repo belongs to **`PawanSirsat`** (github.com/PawanSirsat/Laika) — the
owner's **personal** account. A second, work account (`PawanSirsat21`) exists on
this machine and is the **global** git default. Every commit here must be
attributed to the personal one.

The repo already carries local config that overrides the global default. Do not
change it, and do not commit with `--global` identity:

```
user.name   Pawan Sirsat
user.email  48860105+PawanSirsat@users.noreply.github.com
origin      https://PawanSirsat@github.com/PawanSirsat/Laika.git
```

**Check before your first push of a session** — this costs two seconds and
prevents commits landing under the wrong account:

```bash
git config --local user.email     # must end in +PawanSirsat@users.noreply.github.com
git log -1 --format='%an <%ae>'   # must match
gh auth status                    # must show account PawanSirsat
```

If the email shows `PawanSirsat21`, stop. Fix it and re-author before pushing:

```bash
git config --local user.email "48860105+PawanSirsat@users.noreply.github.com"
git commit --amend --no-edit --reset-author   # unpushed commits only
```

Auth is GitHub CLI as the credential helper, logged in as `PawanSirsat`. If a
push asks for a password, or `gh auth status` shows the wrong account, do **not**
paste a token or switch the global config — tell the owner. If both accounts are
ever added to `gh`, `gh auth switch --user PawanSirsat` selects the right one.

Never push to any remote other than `origin`, and never add a second remote.

## 5. Code rules

- **TypeScript strict everywhere.** `strict: true`, no implicit `any`, no
  `@ts-ignore` without a comment naming the task id that will remove it.
- **All database access goes through Drizzle.** No raw SQL strings in route
  handlers, no second query builder, no ORM smuggled in as a "small helper".
- **Every API endpoint calls the `can()` policy module** before it reads or
  writes anything. `can(actor, action, resource)`. An endpoint without a `can()`
  call is a bug, not a shortcut — including internal, admin, and MCP paths.
- **No new dependencies without a task that says so.** If a task's Notes do not
  name the package, it does not get added. Write a task instead.
- Formatting and lint are enforced by the repo config, not by taste. Run them
  before you move a task to review.

## 6. Boundaries that are never crossed

- Never edit another session's log file.
- Never edit another session's identity file in `.sessions/`.
- Never edit a task file that is in another session's `.tasks/in-progress/`
  claim, except PM appending review notes.
- Never move a task to `.tasks/done/` unless you are PM.
