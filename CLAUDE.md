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
| **Builder-A** | `server/` **except `server/web/`** | `server/web/`, `plugin/`, `cli/`, `docker/`, `docs/`, other sessions' logs |
| **Builder-B** | `server/web/`, `plugin/`, `cli/`, `docker/` | the rest of `server/`, `docs/`, other sessions' logs |

**`server/web/` is the frontend and belongs to Builder-B** (D-016). Everything
else under `server/` — API, database, policy, MCP — is Builder-A's. The split is
API versus UI, not directory depth: Builder-B never touches `server/src/`, and
Builder-A never touches `server/web/`. `server/public/` is build output and
belongs to nobody; it is gitignored (LAI-016).

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
   in `.tasks/done/` **on `master`**.
2. Take the latest integrated state first: `git merge master`.
3. **Check every branch, not just your own** — sessions work on separate
   branches, so a rival claim will not be in your working tree:
   ```bash
   git log --all --oneline -- '.tasks/in-progress/LAI-00X*' \
                              '.tasks/review/LAI-00X*' '.tasks/done/LAI-00X*'
   ```
   Any output means someone has already claimed, finished, or closed it. **Pick a
   different task.** This check is instant and exact — all worktrees share one
   object database (§4.2), so there is nothing to fetch and no excuse to skip it.
4. `git mv .tasks/backlog/LAI-00X-*.md .tasks/in-progress/`
5. Edit its frontmatter: `assignee: <your-session>`, `status: in-progress`,
   `started: <ISO-8601 timestamp>`.
6. Commit that move **before writing any code**:
   `chore(tasks): claim LAI-00X [LAI-00X]`
   The commit is the claim. It is visible to every other session the instant it
   exists — no push, no merge required.
7. If the move fails, the file is gone, or step 3 turns up a rival claim —
   **another session has it. Pick a different task.** Never force it, never move
   a file back out of someone else's hands.

**Simultaneous claims.** If two sessions claim the same task within seconds of
each other, the **earlier commit timestamp wins**. The later session moves its
copy back to `.tasks/backlog/`, resets `assignee: unclaimed`, commits, and says so
in its log. Do not negotiate, do not both continue.

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

### 4.2 Worktrees — one checkout per session

Each session has its **own working directory on its own branch**. This is not
optional and it is not cosmetic: when three sessions shared one checkout, a single
`git add -A` in any of them swept up every other session's uncommitted work, and
the file-move claim lock was not a lock at all.

| Session | Directory | Branch |
| --- | --- | --- |
| PM | `Laika/` | `master` |
| Builder-A | `Laika-builder-a/` | `builder-a` |
| Builder-B | `Laika-builder-b/` | `builder-b` |

All three are worktrees of **one repository** — one `.git`, one object database,
one set of refs. That is what makes the cross-branch claim check in §2 instant and
authoritative: a commit in any worktree is visible to all of them immediately,
with nothing to fetch.

**Work only in your own directory.** If your shell is in someone else's worktree,
stop and change directory. `git worktree list` tells you where you are.

**Stay current.** Before claiming a task, and any time `master` moves:

```bash
git merge master          # from your own worktree, on your own branch
```

Prefer `merge` over `rebase` here — your branch is shared state that PM reads
during review, and rebasing it rewrites commits another session may already have
looked at.

**Integration is PM's job.** Builders never merge into `master` and never check
out `master`. PM merges a builder branch when accepting the task:

```bash
git merge --no-ff builder-a
```

**Never** create a worktree, delete one, or check out another session's branch.
If you think you need one, say so — that is a PM decision.

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
### 5.1 UI rules

- **A UI task carries `depends-on` for the API task(s) that define its
  endpoints.** No screen is built before the endpoints it calls exist. If a
  screen needs data no endpoint returns, it stays in `.tasks/backlog/` — you do
  not stub the data and you do not add the endpoint from the UI task. See
  SPEC §11.4.2 for the screen → endpoint map and §11.4.2.1 for what each screen
  must contain.
- **Exception — API-independent UI may start immediately.** The app shell,
  sidebar, theme system, routing, form layout, and empty/loading/error states
  depend on no endpoint and are not gated. These are marked in their task files;
  everything else waits.
- **Functional React wired to the real API. Never hardcode mockup data.** Mira
  Kellner, `laika.kvelld.internal`, "13/34 done" are fixtures in the mockup. Every
  number, name and count in the shipped UI comes from an API response. A
  hardcoded value is a defect even when it looks right.
- **Match `docs/design/` for style, never for markup.** Colours, spacing, type,
  dark **and** light, and the `WORK` / `REVIEW` / `SETTINGS` sidebar. Take the
  design tokens verbatim from `docs/design/README.md`. Do not copy the
  prototype's inline-styled HTML — it is a mockup rendered by a foreign runtime.
- **Do not ship a `SYSTEM` sidebar group.** It exists in the prototype so every
  screen is reachable in one file. Login, first boot and the project picker are
  pre-auth or org-level routes, not nav destinations.
- **`LAI-` is the task key prefix.** Any `LK-`, `SKY-` or `TBT-` in a design file
  is stale — rename on sight. `Laika Prototype.dc.html` is already correct; the
  other design files are not.
- **Do not reproduce the prototype's artifacts.** No overlapping labels, no
  floating pills colliding with content, no `postgres` in the first-boot status
  (Laika is SQLite — D-001), no "Forgot?" or magic-link sign-in (neither is
  specified — SPEC §14, q11). The full list is in `docs/design/README.md`.
- **Self-host the fonts.** The mockup pulls Plus Jakarta Sans and JetBrains Mono
  from Google Fonts. A self-hosted board that calls Google on every page load
  contradicts SPEC §13.4.
- **Both themes, every time.** A component that only works in light is not done.

## 6. Boundaries that are never crossed

- Never edit another session's log file.
- Never edit another session's identity file in `.sessions/`.
- Never edit a task file that is in another session's `.tasks/in-progress/`
  claim, except PM appending review notes.
- Never move a task to `.tasks/done/` unless you are PM.
