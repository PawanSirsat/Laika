# cli/ — owned by **Builder-B**

The `laika` CLI (`laika init`, `laika whoami`, `laika connect`, `laika activity`). Installed on
PATH by `plugin/scripts/install.sh` from a Laika checkout.

If you need a change here, write a task file in `.tasks/backlog/` with
`area: cli`.

## `laika connect <agent>`

Points a coding agent at the board's MCP endpoint (`<LAIKA_URL>/mcp`).

```bash
laika connect --list            # every agent, and what connect does for it
laika connect cursor            # user scope: ~/.cursor/mcp.json
laika connect cursor --project  # this folder: .cursor/mcp.json
laika connect omnigent --dir ./my-agent
```

**Credentials.** It reuses `~/.laika/env` when that holds both `LAIKA_URL` and
`LAIKA_TOKEN`. Otherwise it takes both from the environment, or asks for the
URL and then the token — the same order as `install.sh`, so piped answers work.
It then writes `~/.laika/env` in `install.sh`'s format (directory 0700, file
0600). The token is never printed.

**Environment.** Most clients read the token from `LAIKA_TOKEN`, so connect
appends one block, once, to the rc file `install.sh` would pick from `$SHELL`
(`~/.zshrc`, `~/.bashrc`, else `~/.profile`). It loads `~/.laika/env`. Open a
new terminal afterwards. GUI apps such as Cursor and VS Code inherit the
variable only when you start them from that terminal (`cursor .`, `code .`).

**What it writes.** Codex, Cursor, Gemini CLI, OpenCode, Antigravity, Omnigent
(with `--dir` or `--project`), and Claude Code and VS Code with `--project`.
Every other agent gets a snippet printed for it. Those files refer to the
variable in each client's own syntax and hold no token. The exception is
**Antigravity**: it has no env-var expansion, so the token is written inline
to `~/.gemini/config/mcp_config.json` (0600). `--project` is refused for
Antigravity, because a project file can be committed.

**Other people's files.** Connect only touches the `laika` entry. A file that
is not valid JSON (including JSONC with comments) is refused, and nothing at
all is written. The first time connect changes an existing file, it saves the
original once and never overwrites that backup: beside a user-scope file as
`<file>.bak`, and under `~/.laika/backups/` for a project file, so no backup
lands in a repository. If the entry is already the same, connect writes
nothing. If a Codex config already defines the `laika` server in any form (a
`[mcp_servers.laika]` table, an inline table or a dotted key), connect leaves
the file alone; if it mentions `laika` in a way connect cannot place, it also
leaves it alone and prints the block for you to add.

**Credentials.** `LAIKA_URL` and `LAIKA_TOKEN` in the environment win over
`~/.laika/env` and update it. A file holding the token (`~/.laika/env`,
Antigravity's config) is written through a 0600 temp file and a rename, so it
never holds the token under a wider mode. The shell rc only *sources*
`~/.laika/env`; it never contains the token.

`laika whoami` prints an `Agents` line naming which agents have a `laika` entry
at user scope. It only checks that the entry exists, not that it works.

## `laika activity` — local activity for the heatmap (LAI-752)

Counts, on this machine, what the profile heatmap's **Local** and **GitHub**
colours show, and sends per-day numbers to the board. Nothing is collected
unless **both** switches are on: the organisation's Developer insights (an owner
or admin) and the developer's own "Share my local activity" (only from a
signed-in browser — a token cannot turn it on, so no agent can switch on its own
reporting).

```bash
laika activity on                 # check both switches, then install the hooks
laika activity on --agent copilot # also install for an agent not detected
laika activity status             # the exact JSON the next sync sends, and the last result
laika activity sync               # send now, if the board's interval allows it
laika activity emails a@b c@d     # extra author emails that count as yours (--clear)
laika activity off                # remove the hooks and delete ~/.laika/activity
```

**What is sent** (`PUT /api/v1/me/local-activity`), per local day for the last
14 days: prompts per agent kind, agent sessions started, your commits on no
remote (`commits_local`), and for each of your commits already on a remote a
one-way key — the first 16 hex characters of `sha256("laika-commit:" + sha)` —
so a commit seen from two machines counts once. **Never** prompt text, file
names, repo names or paths, remote URLs, branch names, commit messages, author
emails or commit ids. `status` prints the body before you ever send it.

**Which agents.** `on` installs for Claude Code always, and for every other
agent that has a `laika` server at user scope — what `laika connect` writes, or
the file its snippet names. Each hook was checked against the agent's own docs
or source:

| Agent | Where | Events |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` (merged) | `UserPromptSubmit`, `SessionStart` (`startup\|clear`), `SessionEnd` |
| Codex CLI | `~/.codex/hooks.json` (merged) | `UserPromptSubmit`, `SessionStart` (`startup`), `SessionEnd` |
| Gemini CLI | `~/.gemini/settings.json` (merged) | `BeforeAgent`, `SessionStart`, `SessionEnd` |
| Copilot CLI | `~/.copilot/hooks/laika-activity.json` (or `$COPILOT_HOME`) | `userPromptSubmitted`, `sessionStart`, `sessionEnd` |
| Goose | `~/.agents/plugins/laika-activity/` | `UserPromptSubmit`, `SessionStart`, `SessionEnd` |
| Kiro CLI v3 | `~/.kiro/hooks/laika-activity.json` | `UserPromptSubmit`, `SessionStart`, `SessionEnd` |
| Cline | **skipped** | its source and release notes disagree on the hooks folder, and it has no session end |

Codex runs a new hook only after you trust it in `/hooks`. Copilot CLI before
1.0.22 fires `sessionStart` on every prompt. Kiro reads global hooks in its CLI
v3 only. Copilot CLI is not one of the agent ids `laika connect` knows, so its
prompts are sent as `other`.

**Other people's files** are handled the way `laika connect` handles them: a
file that is not valid JSON, or whose `hooks` is not the expected shape, is
refused and the entry to add is printed; the first change leaves `<file>.bak`
once (0600); an identical install writes nothing. Ours are recognised by the
script name `laika-activity-hook` in the command, so `off` removes exactly those
and nothing else. If Codex's `config.toml` already defines hook handlers, `on`
leaves `hooks.json` alone and prints the entries, because Codex would merge the
two and warn on every start.

**Which repos.** Only repos an agent session started in on this machine — the
session-start hook remembers each one's top level in `~/.laika/activity/repos`
(never sent; forgotten after 30 days unused). Nothing scans the disk. With the
scope `laika-repos` (chosen in the web app), only repos carrying the Connect
screen's "Share with your project" block count — recognised by its line *"This
project is tracked on a Laika board."* in `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
or any other file the Connect screen names.

**Whose commits.** That repo's `git config user.email`, plus `laika activity
emails`, matched exactly and case-insensitively. Mailmap is off, so a repo's
`.mailmap` cannot make someone else's commit yours. Days are your machine's
local days by **author** date (git's `--since` is the committer date, so a wide
window is asked for and filtered by author time). Merge commits are not
counted. A repo and its worktrees are counted once. A rewritten commit — an
amend, a rebase, a cherry-pick — keeps its author and author time, and is not
counted again: neither as local work while the original is on a remote, nor as
a second pushed key once force-pushed. Commits whose remote branch was deleted
after a squash merge are not counted as local again either — provided a sync saw
them on the remote first (a branch pushed and squash-merged between two syncs is
counted as local until it is deleted, and only inside the 14-day window).
**Nothing authored before sharing was turned on on this machine is reported** —
pushed or not: the consent covers work from then on (D-079).

**Which board.** The one `laika activity on` was run against, recorded in
`state.json`, with that board's token (from `~/.laika/env` first). A session
whose environment points at a different board sends nothing — neither to that
board nor to the recorded one — and wipes nothing; `status` says why. Running
`on` against another board starts over: what was counted for one board is never
sent to another.

**How often.** Never more often than the board's `min_sync_interval_s`. The
session-start and session-end hooks start the sync in the background when it is
due, and the sync claims the next slot the moment it starts, so a sync that
hangs still holds the next one off. Every sync first asks the board whether
sharing is on and which scope applies, so turning it off or narrowing it to
`laika-repos` in the web app takes effect on the very next sync, and `status`
asks too. A 429 waits for `Retry-After`; any failure — an error answer, a board
that cannot be reached, or a crash in the count — backs off, doubling from the
interval, to at most 6 hours; a request gives up after 5 s. The board's
refusals use SPEC §6.3's envelope, with the reason in `details.reason`: a 403
whose reason is `local_activity_off` stops collection, clears the local log,
starts a new collector id (so its days never overwrite the old one's), and
checks again after 24 hours. Any other 403 (a token refused a scope,
`session_required`) and any 422 (`day_out_of_range`, `invalid_tz`) is a
failure: it is written to last-error with its reason, backs off, and wipes
nothing. Errors go only to `~/.laika/activity/last-error`, shown by `status`.

**Time zone.** Days are the machine's local days, and `tz` is its IANA zone. If
the system's zone is not one Node knows (a `TZ` such as `Garbage/Zone` makes
Node report none at all), days are counted and sent in `UTC` instead.

**One at a time, and never stuck.** A lock file records the sync's pid and
start time. A live sync keeps it however long it runs; only a lock whose
process is gone (or whose pid now belongs to another process) is taken over.
Every sync has a 2-minute deadline: git runs asynchronously and is killed at
the deadline, repo paths are checked without blocking, and a CLI sync that
reaches it exits rather than wait on a call stuck on a dead network mount.
