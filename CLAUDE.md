# Laika — working agreement for all sessions

Laika is a self-hosted project board where humans and Claude Code agents share one
source of truth. Three sessions build it in parallel: **CHIEF**, **CORE**,
**SHELL**. These rules exist so we never collide. They are not advisory.

| Session | Command | Branch | Directory | In one line |
| --- | --- | --- | --- | --- |
| **CHIEF** | `/chief` | `master` | `Laika/` | Holds the plan. Writes tasks, reviews, merges. No code. |
| **CORE** | `/core` | `core` | `Laika-core/` | The engine — API, database, policy, MCP. |
| **SHELL** | `/shell` | `shell` | `Laika-shell/` | Everything wrapped around it — UI, plugin, CLI, container. |

Each command boots that identity, takes the latest `master`, reports where things
stand, and starts the session's next job. `/<name> status` reports without acting.

**These sessions were renamed on 2026-08-31 (D-035)** — CHIEF was PM, CORE was
Builder-A, SHELL was Builder-B. The old names remain correct **wherever they were
already written**: `.tasks/done/`, `logs/`, and existing `DECISIONS.md` entries
are records of what happened and are not rewritten, by the same append-only rule
that governs decisions. Read an old name as its new one.

## 0. Before any work

1. Read `docs/SPEC.md`.
2. Read your own identity file in `.sessions/` (`chief.md`, `core.md`, or
   `shell.md`). It tells you who you are and what you own.
3. Read the task file you are about to work on, top to bottom, including
   `depends-on`.

If you do not know which session you are, stop and ask. Do not guess.

## 1. Roles and ownership

| Session | Owns (may edit) | Must never edit |
| --- | --- | --- |
| **CHIEF** | `docs/`, `.tasks/`, `logs/chief-*.md`, `.sessions/chief.md`, `.claude/`, `CLAUDE.md` | any application code |
| **CORE** | `server/` **except `server/web/`** | `server/web/`, `plugin/`, `cli/`, `docker/`, `docs/`, other sessions' logs |
| **SHELL** | `server/web/`, `plugin/`, `cli/`, `docker/` | the rest of `server/`, `docs/`, other sessions' logs |

**`server/web/` is the frontend and belongs to SHELL** (D-016). Everything
else under `server/` — API, database, policy, MCP — is CORE's. The split is
API versus UI, not directory depth: SHELL never touches `server/src/`, and
CORE never touches `server/web/`. `server/public/` is build output and
belongs to nobody; it is gitignored (LAI-016).

**D-031 retires the D-028 split: SHELL owns all of `server/web/` again**,
including `api/sprints.ts`, and CORE is back to `server/**`. The paragraph
below is kept as the record of what D-028 did and is no longer in force.

~~**Temporary, D-028 — both builders are on the UI.**~~ `server/web/` splits by
screen: `routes/screens/sprints/`, `timeline/` and `dashboard/` **and
`api/sprints.ts`** are **CORE's**;
everything else under `server/web/` — the shell, sidebar, `route-table.ts`,
theme, shared components, the board and the auth screens — stays **SHELL's**.
CORE adds files inside its own screen folders and edits no shared file.
Reverts when the UI has caught up with the API.

One file is shared. The **`WEB_*` maps** in
`server/test/tooling/structure.test.ts` are **SHELL's** (D-026); the rest of
that file is CORE's. Ownership there follows what a section *describes*, not
the directory the file sits in — the same principle D-016 settled for
`server/web/`.

Every session may edit its own log file and move its own task files, and nothing
else outside the table.

**CHIEF writes no application code, ever.** If CHIEF identifies code that needs
writing, CHIEF writes a task file instead.

**CHIEF never changes a design token, a colour, or any value in `docs/design/`**
(D-020). That directory is the owner's imported visual reference. CHIEF may measure
it, report a failure, and recommend a fix — CHIEF may not decide one. A measured
problem becomes a task for the owner, exactly as a builder files rather than
crossing into another area.

**Scope exceptions are granted only by a task file.** A task may widen your area
if it names the exact files, one by one (LAI-001 does this for repo-root config).
A task that says "and whatever else is needed" grants nothing.

**A task may authorise a *named* cross-area edit** (D-033, amended by D-034) —
a SPEC section by number, a single exemption entry, a specific mapping; never a
file, never a directory. The condition is that the task **names what will be
touched** and the reviewer sees it, not that a drift check forced it.

**A named edit is not a design change to someone else's file.** If the work turns
out to need reshaping how their code does something, it stops being a crossing
and goes back to them.

**If you need a change outside your area, do not make it.** Write a task file in
`.tasks/backlog/` describing the change, with the correct `area:`, and continue
with what you can do without it. If it blocks you, add its id to your current
task's `depends-on`, move your task back to `.tasks/backlog/`, and say so in your
log.

## 2. Task protocol

Work **only** from task files. No task file, no work.

Two narrow exceptions, both CHIEF-only: repo maintenance the owner asks for
directly (workflow, docs, git config) and this bootstrap. Those carry `[ops]` or
`[bootstrap]` in the commit's id slot and are recorded in `logs/chief-*.md` instead
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

**Finishing. Move it first, then edit it.** The order matters and this
instruction had it backwards until 2026-08-31:

```bash
git mv .tasks/in-progress/LAI-00X-*.md .tasks/review/   # 1. move
# 2. now edit: tick every criterion `- [x]`, status: review, finished: <ts>
git add .tasks/review/LAI-00X-*.md                      # 3. stage the edits
git commit -m "..."
git show --stat HEAD                                    # 4. read it back
```

**`git mv` stages the rename from the *index*, not from your working tree.** Edit
the file first and `git mv` commits the **pre-edit** blob, leaving your ticks
behind as an unstaged modification. Measured, not assumed:

| | committed blob | worktree | `--stat` |
| --- | --- | --- | --- |
| edit → `git mv` → commit | **pre-edit** | edited | `1 file changed, **0 insertions(+), 0 deletions(-)**` |
| `git mv` → edit → `git add` → commit | edited | edited | `1 file changed, 3 insertions(+), 2 deletions(-)` |

**`0 insertions(+), 0 deletions(-)` on a task-file commit is the tell.** It means
a pure rename landed and every edit you made is still sitting unstaged.

**Verify from `git show`, never from the file on disk.** `grep`-ing the working
tree cannot tell *edited and committed* from *edited and not staged* — it shows
what you just typed either way. Read the field back out of the commit:

```bash
git show HEAD:.tasks/review/LAI-00X-*.md | grep -E '^status:|^finished:|^- \['
```

Then write your log entry.

This has now cost two tasks (LAI-070, LAI-224). The same trap applies to the
**claim** commit above, which is why step 4 there moves before step 5 edits.

**Only CHIEF moves `.tasks/review/` → `.tasks/done/`.** Builders never mark their
own work done. If CHIEF sends a task back, it returns to `.tasks/in-progress/` with
review notes appended to the file — read them, fix, and move it to review again.

**CHIEF does not add criteria to work already submitted.** Once a task is in
`.tasks/review/`, its acceptance criteria are frozen. If CHIEF wants more, it is a
**new task** — never an edit to the one in flight. This happened on LAI-059: CHIEF
widened the backlog copy on `master` while the builder's copy sat in review, so
the builder either failed a review against criteria that did not exist when they
built it, or had to reopen their own finished task. Neither is theirs to absorb.

The same holds for a task in `.tasks/in-progress/`: CHIEF may append **review
notes**, and nothing else (§6).

**How a send-back travels between branches.** A task in review lives on the
builder's branch; `master` has no copy, because CHIEF merges only on accept. So CHIEF
writes the send-back **on `master`**, at `.tasks/in-progress/`, with the notes
appended and the failed criteria unticked. Git sees an added file, not a rename,
so **the builder ends up with two copies** after their next `git merge master`.
The builder resolves it: `git rm .tasks/review/LAI-0XX-*.md`, keep the
`in-progress` copy, carry on. CHIEF's copy is always the authoritative one —
`.tasks/` resolves in CHIEF's favour (§4.2).

Accepting is the other way round and needs no such step: CHIEF merges the builder's
branch first, which brings the file to `master` at `.tasks/review/`, and the
`git mv` to `.tasks/done/` is then an ordinary rename.

**A note on an `in-progress` task conflicts instead — and that is more dangerous.**
A send-back writes to a *different* path from the builder's copy, so git sees an
added file and both survive. A review note on a task still in `.tasks/in-progress/`
lands at the **same path**, so git reports a **conflict**, and "resolve `.tasks/`
in CHIEF's favour" then means *discard the builder's edits to that file* —
silently, including ticked criteria and `finished:`.

So: **CHIEF says in the note what the builder must re-apply.** The builder
resolves the conflict by taking CHIEF's copy and then re-doing their own
frontmatter and ticks on top. Neither side should assume the merge preserved
both.

This happened on LAI-224. Nothing was lost, only because the builder had not yet
ticked anything when the note arrived.

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

**Before filing, check whether it already exists.** Sessions cannot see each
other's unmerged backlogs, so the same finding gets filed two or three times:

```bash
git log --all --name-only --format= -- .tasks/ | grep -i '<keyword>'
```

If someone already filed it, add what you know to your log and move on. **If you
are not sure, file it anyway** — CHIEF closes duplicates in one review line, and a
discovery nobody writes down costs whatever it breaks later. Duplicate filings
are a cheap failure; lost discoveries are not.

**CHIEF dedupes at review time, and the first filing wins** — regardless of which
session filed it, including CHIEF's own.

**Take the id from your own range** (D-017). "Next unused number" is not a lock —
two sessions filing at the same time both pick it, and it collided twice on day
one:

| Session | Range | Second block (D-036) |
| --- | --- | --- |
| CHIEF | `LAI-001` – `LAI-099` — **full** | `LAI-400` – `LAI-499` |
| CORE | `LAI-100` – `LAI-199` | `LAI-500` – `LAI-599` |
| SHELL | `LAI-200` – `LAI-299` | `LAI-600` – `LAI-699` |

`LAI-300` – `LAI-399` is reserved for a fourth session (D-017) and is not
anyone's to take. Move to your second block only when your first has no free
number left — CHIEF's has none, so CHIEF files from `LAI-400`.

Use the lowest unused number **in your own range**, checked across every branch:

```bash
git log --all --name-only --format= -- .tasks/ | grep -o 'LAI-[0-9]*' | sort -u
```

Ids issued before 2026-08-24 (`LAI-001`–`LAI-026`) keep their numbers whoever
created them. **Never renumber an existing task** — ids are referenced by
`depends-on`, `discovered-from` and commit messages, and renumbering is what
LAI-015 had to clean up.

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
| CHIEF | `Laika/` | `master` |
| CORE | `Laika-core/` | `core` |
| SHELL | `Laika-shell/` | `shell` |

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

Prefer `merge` over `rebase` here — your branch is shared state that CHIEF reads
during review, and rebasing it rewrites commits another session may already have
looked at.

**Integration is CHIEF's job.** Builders never merge into `master` and never check
out `master`. CHIEF merges a builder branch when accepting the task:

```bash
git merge --no-ff core
```

**Never** create a worktree, delete one, or check out another session's branch.
If you think you need one, say so — that is a CHIEF decision.

### 4.3 Running instances — three sessions, one machine, one set of ports

Worktrees keep our **files** apart. Nothing keeps our **ports** apart, and a
process another session started will answer you exactly as if it were yours.

**A health check answering does not mean *your* server is answering.** CORE hit
this on LAI-402: they started a verification server on `3370`, it failed
`EADDRINUSE` and exited 1, and `GET /health` still returned `200` — because
SHELL held that port. The tell was `uptime_ms: 1115605`: eighteen minutes, on a
process started one second earlier. Without that field they would have run
first-boot setup against another session's instance and created an org in
someone else's database.

So, before trusting a single measurement against a local instance:

```bash
lsof -ti tcp:<port>            # is anything already there?
# start the server, then:
curl -s localhost:<port>/api/v1/health   # uptime_ms must match how long ago you started it
```

**Read `uptime_ms` and confirm it is seconds, not minutes.** A wrong answer here
does not look like an error — it looks like success, which is why it is worth a
rule rather than care.

**Kill by port, and only your own.** `lsof -ti tcp:<port>` then `kill` that pid.
**Never `pkill -f node`, never a broad pattern** — it takes out the other two
sessions' servers and whatever the owner is running, and the failure surfaces to
them as unrelated flakiness minutes later.

**Pick a port nobody else is on** and say which one in your log. Do not touch the
shared demo instance on `localhost:3000`; if you need a seeded instance, start
your own on your own port with its own database file, and remove it afterwards.

---

## 5. Code rules

**Structure, naming and layering live in `docs/CONVENTIONS.md`** — where files go,
what they are called, and which layer may import which. Read it before adding a
file. The rules below are the ones that are true of every line of code.

- **TypeScript strict everywhere.** `strict: true`, no implicit `any`, no
  `@ts-ignore` without a comment naming the task id that will remove it.
- **All database access goes through Drizzle.** No raw SQL strings in route
  handlers, no second query builder, no ORM smuggled in as a "small helper".
- **Every API endpoint calls the `can()` policy module** before it reads or
  writes anything. `can(actor, action, resource)`. An endpoint without a `can()`
  call is a bug, not a shortcut — including internal, admin, and MCP paths.

  **The one exception is a pure dispatcher, and it is narrow.** A handler that
  reads and writes *nothing* — whose entire job is to hand the request to
  something that does — calls no `can()`, because there is no resource to name
  and the question would have to be asked again downstream with the right one in
  hand. `/mcp` is the case: it is a transport, and each tool calls the service
  that calls `can()` exactly as a route does (LAI-406).

  Three conditions, all required:

  1. It touches no data at all — not a read, not a count, not an existence check.
  2. **It still enforces that an actor exists.** An unauthenticated caller must
     not reach whatever it dispatches to.
  3. Every path it dispatches to calls `can()` itself. If any does not, the
     exception does not apply and the dispatcher is not the place to fix it.

  If satisfying the rule would mean **inventing an action §3.1 does not have**,
  that is the signal you are looking at a dispatcher. If instead you are reaching
  for a plausible-sounding existing action, you are not — write the `can()` call.
- **No new dependencies without a task that says so.** If a task's Notes do not
  name the package, it does not get added. Write a task instead.
- **An assertion must be specific enough that a broken setup cannot satisfy it.**
  A bare `rejects.toThrow()` asserts only that *something* went wrong, and
  something always goes wrong. LAI-406 had three auth tests passing while proving
  nothing: `serve()` returned before the socket was bound, every client failed
  `EADDRNOTAVAIL`, and *"refuses a client with no token"* was being satisfied by a
  connection that never reached Laika. Assert the **`code`** (§6.3), the message,
  the status — something only the real path can produce. Same family as the
  `mint(body, undefined)` default-parameter bug in LAI-402: an assertion loose
  enough that the setup being broken satisfies it.

  **The corollary: a setup step with no assertion cannot fail at all.** LAI-407's
  dependency fixture `POST`ed `depends_on` where the route wants
  `depends_on_task_id`. The route correctly answered `422` and **nothing looked**,
  because the call was a bare `await api(...)` — so two tests then asserted
  against a dependency graph that had never been built. Route every setup write
  through a helper that asserts its status. The same defect one layer earlier,
  and the third time in one week a green test was testing nothing.

  **And the tool you verify with needs verifying too — check that your check
  ran.** A mutation harness whose anchor matched nothing ran the suite against
  **unmutated** code and printed `red` anyway (LAI-405); two of CHIEF's review
  mutations did the same thing the same day. A harness that cannot tell *"did not
  fail"* from *"did not run"* is not evidence, and it is the worst place for this
  defect to live, because a mutation run is the thing you trust **when the tests
  pass**. Confirm the edit landed — checksum the file, grep for the new text,
  print `ANCHOR FAILED` loudly — before believing a red or a green.

- Formatting and lint are enforced by the repo config, not by taste. Run them
  before you move a task to review.
- **`pnpm format` checks the whole repo; `pnpm format:fix` writes only what your
  worktree changed** (LAI-026). The fixer builds its file list from
  `git diff HEAD` plus untracked files, so in a worktree it is inherently
  ownership-respecting: it cannot rewrite a file you did not touch, and it needs
  no ownership map to keep up with D-016. Run both before moving a task to review.

  `pnpm format` staying repo-wide is deliberate — a check that only looks where
  it is already clean is not a check. It can therefore report a file in someone
  else's area; that is a task for them, not something to fix from your worktree.

  Neither script touches Markdown. Prose here is hand-wrapped to 80 columns and
  Prettier repaginates tables.
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
- **Demo data lives in `src/demo/` and cannot ship (D-032).** To render a screen
  whose endpoint does not exist yet, a demo module is allowed — one file per
  missing endpoint, each naming the endpoint that retires it, each fed screen
  saying so on the screen, and **a test asserting no demo string survives into
  the built bundle**. A demo module beside a real endpoint is a defect.
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
  claim, except CHIEF appending review notes.
- Never move a task to `.tasks/done/` unless you are CHIEF.
