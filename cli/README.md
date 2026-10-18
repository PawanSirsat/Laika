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
laika activity backfill           # 30 days of token totals and a year of your pushed commits, once: shows, asks, sends
laika activity backfill --days 90 --yes ~/src/other-repo   # a shorter window, no question, one more repo
laika activity off                # remove the hooks and delete ~/.laika/activity
laika activity otel               # the variables that send Claude Code's own token counts too (LAI-773)
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
| Claude Code | `~/.claude/settings.json` (merged) | `UserPromptSubmit`, `SessionStart` (`startup\|clear`), `SessionEnd`, `Stop` |
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
**Unpushed work authored before sharing was turned on on this machine is never
reported**, and pushed work from before then only through the look-back below
(D-080).

**The look-back** (LAI-757, D-080). Once per repo, the first time a sync sees
it, and whenever you run `laika activity backfill`: your pushed commits of the
last 365 days (`--days N` for fewer), by the same rules as above, as the same
one-way keys per day, in reports marked `lookback` (SPEC §6.4). `backfill`
prints what it found — commits, days, a count per month — and asks before
sending (`--yes` does not ask); paths given after it are counted too, even if
no agent session ran there. Answer no and the automatic look-back will not send
those repos either, until a later `backfill` is answered yes. If git cannot read
a repo, it is not marked done: it is tried again later, backing off as a failed
sync does. Commits a snapshot can count are left to it — those
authored after sharing went on, on days the repo's snapshots covered — so a
commit counted local and pushed later is never counted twice; one pushed only
after its day left every snapshot stays local, as before. Commits under your
git identity count even if an agent typed them: git cannot tell. Reports stay
within 16 KB, at most four a run, paced to the board's report bucket; what does
not fit goes with the next syncs, and `status` says how far it got. Run twice,
nothing changes on the board: keys are a set there. Each repo's look-back is
recorded in `~/.laika/activity/lookback.json` (0600, never sent), so the
automatic one never repeats; `off` deletes it with the rest.

**Token usage** (LAI-769, D-084). The same sync reads the token counts your
agents' own session files already record — Claude Code transcripts
(`~/.claude/projects`, or `$CLAUDE_CONFIG_DIR`), Codex rollouts
(`~/.codex/sessions`, or `$CODEX_HOME`) and Gemini CLI sessions
(`~/.gemini/tmp`) — and sends, per local day, agent and model, the input,
output, cache-write and cache-read tokens, in a report marked `usage` on the
same endpoint, after the snapshot (SPEC §6.4) — and the Laika task they were
spent on, by its key, when the collector knows it. From each record only its
usage numbers, model id and time are kept; **never** what was said, tool
input, paths, branches or session ids. Copilot CLI, Cursor and Windsurf keep
no token counts on the machine, so they have none to send.

- **Which task** (LAI-770, D-084 item 5). A session's tokens go to the task
  its agent **marked** — its own `start_working`, or `update_status` into an
  in-progress status — until another mark, a `finish_task`, or a move of that
  task out of progress: a session that moved between tasks is split by time,
  and a subagent's own marks are its own. Only the call's tool name, the
  task's key and whether the status is in progress are kept; a call the
  board refused is no mark. Without a mark, a key in the branch name counts
  when its prefix is one the board serves (`LAI-42-fix-login`; never
  `release-2026`). The prefixes the board serves include those of the
  outside ids its cards carry (LAI-780), so a mark or a branch named for a
  repo's `LAI-780` or a Jira key such as `DATA_ENG-12` counts as the card's
  own key does. Claude Code records the branch on every line and Codex in
  its session's metadata, and for the rest the session-start hook keeps the
  session's id and branch in `~/.laika/activity/sessions` (0600, never
  sent; `off` deletes it). Anything else is unattributed and says so. The 30
  days counted once are sent unattributed (D-084 item 11). A collector from
  before this reads its files once more, in the background sync.

- **Counted once.** Claude Code writes one reply's usage on several lines and
  copies history into a forked session's file: each reply counts once, by its
  message id across every file, at the largest value of each field (summing
  every line over-counts about 2.1×). Codex keeps a running total: a day is the
  difference across it. Gemini CLI rewrites its file each turn: it is read
  again when it changes, each message once.
- **Cheap.** Files are read from where the last sync stopped, to the last
  complete line; a directory is listed again only when its mtime moved. With
  nothing new, the step costs a few `stat`s — measured 17–19 ms in a fresh
  process over 785 transcripts. Claude Code's replies are kept one file per
  local day (`~/.laika/activity/usage-days/`, LAI-776), so new bytes in one
  transcript cost that transcript's new bytes, the data file and the one day
  they are on — measured 29–38 ms over 779 transcripts and 47,071 replies,
  where reading and rewriting every day took 100–111 ms. The first read of a
  busy machine takes seconds (2.1 GB in 4.2 s), in the background sync, never
  in a hook.
- **Within one sync interval** (LAI-776). Claude Code's `Stop` hook — the end of
  every turn — starts the background sync once one is due, so a session that
  runs for hours sends its tokens as it goes, not when it ends. A turn that is
  not due costs what a prompt costs: under zsh, no process at all. The other
  agents sync on their sessions' start and end. A machine where activity was
  turned on before this hook existed gets it by running `laika activity on`
  again, which adds what is missing and leaves the rest as it is.
- **Totals replace.** Only days whose totals changed since the board last took
  them are sent, each whole; the board replaces that machine's day, so a retry
  never counts twice.
- **Since when.** From when you turned sharing on, unless you say yes to the
  last 30 days: `on` asks once (`--yes`/`--no` answer it), and `backfill`
  shows the 30 days it found — tokens per agent, days — and asks before sending
  (`--yes` does not ask). A no is kept until a later `backfill` is answered yes.
- **Scope.** With `laika-repos`, only sessions whose working directory is in a
  repo carrying the Laika block count.
- **Automated sessions' tokens are not yours** (LAI-775, the owner's
  decision). A session file does not say who started it, so the hook keeps the
  session id of every session started with `OMNIGENT=1`, `CI` or
  `LAIKA_ACTIVITY_SKIP` in `~/.laika/activity/skip-sessions` (0600, never
  sent), and the sync leaves that session's files out — its subagents too,
  which share its id. **Sessions from before activity was on here cannot be
  told apart** and are counted; `on` and `backfill` say so before they ask.
- **Counted once across collectors.** `laika activity off` deletes everything
  here, the collector id included, and the board keeps what it was sent. So the
  30 days go with the board's answer of which days it already holds tokens for
  from another collector (`usage_days_elsewhere`, dates only): those days send
  only what came after sharing went on. A day that does carry older tokens goes
  marked `backfill` the first time, and the board replaces every collector's
  rows for it — a client that got this wrong still cannot count a day twice.
- **Codex per-response records** (`token_usage_record`), when a rollout has
  them, are what counts — each response once across every rollout, so a fork
  that copies its parent's history is not counted twice.
- **Sessions, by a one-way key** (LAI-773). Each day also carries its Claude
  Code tokens split per session and model, the session named only by the
  first 16 hex characters of `sha256("laika-session:" + session id)` — never
  the id — and, once Claude Code here sends its metrics to the board
  (`laika activity otel`), every report names the same way the sessions whose
  tokens are left out (`excluded`): automated ones, and under `laika-repos`
  the ones outside your scope. Without that, they are not named at all, since
  the board has nothing of theirs to drop. The board uses them only to put
  Claude Code's own OpenTelemetry counts beside its session files: it
  adds what the files missed — background calls — never what they already
  hold, and drops the telemetry of every session left out here.
- What was read is kept in `~/.laika/activity/usage-index.json`,
  `usage-data.json` and `usage-days/` (0600, never sent); *Delete my
  local-activity history* in the web app deletes the board's token rows too.

**OpenTelemetry, optional** (LAI-773). Session files miss the calls an agent
makes outside the conversation — titles, classifiers, compaction: about 20–30%
for Claude Code on the measured machine. `laika activity otel` prints the
variables that make Claude Code send its own counts to this board as OTLP/HTTP
JSON metrics (`claude_code.token.usage`, `claude_code.cost.usage`), the board's
address filled in and `$LAIKA_TOKEN` left as a reference — the token is never
printed. Only the exports go to stdout, so `eval "$(laika activity otel)"`
works. Logs are switched off, and the board refuses them: they can carry
prompts. The board takes the metrics only under the same two switches.

**Sessions nobody is typing in count nothing.** The hook counts nothing — no
event, no repo, no sync — when `OMNIGENT=1` (Omnigent sets it in every process
it launches), `CI` is set, or `LAIKA_ACTIVITY_SKIP` is set; it only keeps that
session's id, from its start and end payloads (never a prompt's), so its
tokens are left out too (LAI-775). `on` and `status` say so.

**Which board.** The one `laika activity on` was run against, recorded in
`state.json`, with that board's token (from `~/.laika/env` first). A session
whose environment points at a different board sends nothing — neither to that
board nor to the recorded one — and wipes nothing; `status` says why. Running
`on` against another board starts over: what was counted for one board is never
sent to another.

**How often.** Never more often than the board's `min_sync_interval_s`. The
session-start and session-end hooks — and Claude Code's end of each turn, while
collection is on — start the sync in the background when it is due, and the sync claims the next slot the moment it starts, so a sync that
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
