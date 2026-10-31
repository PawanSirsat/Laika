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
colours show, and sends per-day numbers to the board. **Collection is the
organisation's** (D-102 amended): nothing is collected unless its Developer
insights is on, and while it is, every connected machine is — there is no
personal switch. A token cannot turn it on, so no agent can switch on its own
reporting. `on`, `status` and `sync` each say so plainly: what is collected,
that the owner and anyone they grant access can see it, and that you can see
who looked.

```bash
laika activity on                 # check Developer insights, then install the hooks and Claude Code's telemetry
laika activity on --agent copilot # also install for an agent not detected
laika activity status             # the exact JSON the next sync sends, and the last result
laika activity sync               # send now, if the board's interval allows it
laika activity emails a@b c@d     # extra author emails that count as yours (--clear)
laika activity backfill           # 30 days of token totals and a year of your pushed commits, once: shows, asks, sends
laika activity backfill --days 90 --yes ~/src/other-repo   # a shorter window, no question, one more repo
laika activity off                # remove the hooks and delete ~/.laika/activity
laika activity otel               # the same telemetry as variables, for one shell by hand (LAI-773)
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
**Unpushed work authored before collection started on this machine is never
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
authored after collection started, on days the repo's snapshots covered — so a
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
- **Since when.** From when collection started on this machine, unless you say yes to the
  last 30 days: `on` asks once (`--yes`/`--no` answer it), and `backfill`
  shows the 30 days it found — tokens per agent, days — and asks before sending
  (`--yes` does not ask). A no is kept until a later `backfill` is answered yes.
- **Scope.** With `laika-repos`, only sessions whose working directory is in a
  repo carrying the Laika block count.
- **Automated sessions' tokens count for the team, never as yours** (LAI-775,
  D-091). A session file does not say who started it, so the hook keeps the
  session id of every session started with `OMNIGENT=1`, `CI` or
  `LAIKA_ACTIVITY_SKIP` in `~/.laika/activity/skip-sessions` (0600, never
  sent), and the sync sends that session's tokens — its subagents too, which
  share its id, and its Codex and Gemini CLI files — in rows of their own
  marked `automated`. The board counts them for the organisation, the space
  and the task they are tied to (by the agent's own `start_working`, or a key
  in its branch, as yours are), and in none of your figures: not your line in
  the Usage page, not your profile card, not your plan-limit forecast. They
  still add no prompt, session or minute of drafted time. **Sessions from
  before activity was on here cannot be told apart** and are counted as yours;
  `on` and `backfill` say so before they ask.
- **Counted once across collectors.** `laika activity off` deletes everything
  here, the collector id included, and the board keeps what it was sent. So the
  30 days go with the board's answer of which days it already holds tokens for
  from another collector (`usage_days_elsewhere`, dates only): those days send
  only what came after collection started. A day that does carry older tokens goes
  marked `backfill` the first time, and the board replaces every collector's
  rows for it — a client that got this wrong still cannot count a day twice.
- **Codex per-response records** (`token_usage_record`), when a rollout has
  them, are what counts — each response once across every rollout, so a fork
  that copies its parent's history is not counted twice.
- **Sessions, by a one-way key** (LAI-773). Each day also carries its Claude
  Code tokens split per session and model, the session named only by the
  first 16 hex characters of `sha256("laika-session:" + session id)` — never
  the id — and, once Claude Code here sends its metrics to the board
  (`laika activity on` sets that up), every report names the same way the sessions whose
  telemetry is to be dropped (`excluded`): automated ones, whose tokens are the
  rows marked `automated` and in no session's split, and under `laika-repos`
  the ones outside your scope, whose tokens are left out. Without that, they
  are not named at all, since the board has nothing of theirs to drop. The
  board uses them only to put
  Claude Code's own OpenTelemetry counts beside its session files: it
  adds what the files missed — background calls — never what they already
  hold, and drops the telemetry of every session left out here.
- What was read is kept in `~/.laika/activity/usage-index.json`,
  `usage-data.json` and `usage-days/` (0600, never sent); *Delete my
  local-activity history* in the web app deletes the board's token rows too.

**OpenTelemetry** (LAI-773, LAI-867). Session files miss the calls an agent
makes outside the conversation — titles, classifiers, compaction: about 20–30%
for Claude Code on the measured machine. `laika activity on` has Claude Code
send its own counts to this board as OTLP/HTTP JSON metrics
(`claude_code.token.usage`, `claude_code.cost.usage`), from every Claude Code
on the laptop — started from a terminal, the Dock or Omnigent — with no
shell-profile line. It writes six variables into `~/.claude/settings.json`'s
`env` (telemetry on, `otlp`, `http/json`, this board's metrics endpoint,
`cumulative`, logs `none`) and an `otelHeadersHelper` naming
`~/.laika/otel-headers`, a 0700 script that reads `LAIKA_TOKEN` from
`~/.laika/env` each time it runs and prints the `Authorization` header. **The
token is never written**, into settings.json or the script. A key you already
set to another value is left as you set it, and `on` says so; `off` removes
only what `on` added, each key only while it still holds `on`'s value.
`laika activity status` says whether telemetry reaches the board — not set up,
your settings disagree, the helper fails, the board refuses (401, or 403
`local_activity_off`), or reaching it — from one request that carries no
metric. `laika activity otel` still prints the same settings as `export`
lines for anyone who wants them by hand. Logs are switched off, and the board
refuses them: they can carry prompts. The board takes the metrics only under
the same two switches.

**Sessions nobody is typing in count nothing as yours.** The hook counts
nothing — no event, no repo, no sync — when `OMNIGENT=1` (Omnigent sets it in
every process it launches), `CI` is set, or `LAIKA_ACTIVITY_SKIP` is set; it
only keeps that session's id, from its start and end payloads (never a
prompt's), so its tokens go marked `automated` (LAI-775, D-091): the team's,
never yours. `on` and `status` say so. For a sub-agent an Omnigent runner
dispatched — `OMNIGENT=1` under a runner's primary id, and not the primary
itself — the id is followed by the word `omnigent`, so its card can label
your untied minutes (D-095, below); `CI` and `LAIKA_ACTIVITY_SKIP` sessions
get no word.

**The orchestrator's primary session is yours** (D-088 item 9, LAI-787).
Omnigent sets `OMNIGENT=1` on the session you type to as well as on the
sub-agents it dispatches, so until LAI-787 the one session where you work was
skipped too. Omnigent's own variables tell them apart: a session whose
`OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` equals `OMNIGENT_RUNNER_PRIMARY_SESSION_ID`
(both set) is the runner's primary — the conversation you type in — and
counts as yours in every respect: its prompts, its start, its tokens and its
time. A sub-agent's two ids differ and it is skipped as before; `CI` and
`LAIKA_ACTIVITY_SKIP` skip a primary all the same. Each primary's id is kept,
0600 and never sent, in `~/.laika/activity/primary-sessions`, and `status`
says how many there were. One kind of prompt there is not yours: the notice
Omnigent types into a Claude Code primary itself when a sub-agent finishes, a
timer fires or a terminal goes idle. It begins `[System: `, and the hook
writes nothing for it (D-090) — though the replies Claude Code gives it are
still read from the session's transcript like any other.

**An Omnigent-native orchestrator's turns count when you started them**
(LAI-792, D-090). polly, Omnigent's own orchestrator, is no terminal session,
but it thinks with Claude Code under the Claude Agent SDK, and the SDK loads
`~/.claude/settings.json` — so the hooks `laika activity on` installed already
run at every one of its turns. The hook knows it by Omnigent's own marks: a
runner the Omnigent host launched for a `claude-sdk` session
(`OMNIGENT_RUNNER_LAUNCH_HARNESS`), the SDK's `CLAUDE_CODE_ENTRYPOINT=sdk-py`,
and no terminal. Most of its turns nobody typed: Omnigent starts one itself
whenever a sub-agent finishes, a timer fires or a terminal goes idle, and each
such prompt begins `[System: `. So on this one path the hook looks at the
start of the prompt — at most 4 KB, held only until it knows whether the
marker is there, never written, stored or sent — and writes a turn you started
as `t omnigent <epoch> <session>`, one Omnigent started as `w`, and every
turn's end as `r`; the session is Omnigent's id. The drafter keeps only your
turns, as your primary session's activity, each end a reply, and drops a `w`
and the `r` that closes it. No turn is a typed prompt. Nothing to configure
beyond `laika activity on`, **if** polly runs under the Omnigent app or host
(a host-launched runner): a polly started from the `omnigent` CLI in a
terminal carries no launch stamp and is never counted. The sub-agents it
dispatches run in terminals of their own, or are other agents, and are
skipped as before; `CI` and `LAIKA_ACTIVITY_SKIP` skip it all the same. It
writes no transcript, so it has no tokens here, and no key of its own: its
minutes take the card of a builder it dispatched while that builder runs
(D-095, *The rule* below), and are otherwise yours to assign in *My day*.
Known limits: a notice delivered
joined to your words, notice first, drops your turn (the safe direction); a
renamed marker in a later Omnigent would count its turns again — a test
quotes 0.17.0's templates so that shows up red; and a child session the
orchestrator defines itself on the `claude-sdk` harness cannot be told from
it.

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
Developer insights is on and which scope applies, so the organisation turning
it off, or you narrowing it to `laika-repos` in the web app, takes effect on the very next sync, and `status`
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

## `laika time draft` — your day, drafted on this machine (LAI-787, D-088)

Laika drafts each person's working day **on their own machine** from what this
collector already holds, and the person confirms it in the web app (*My day*).
Only blocks leave the machine; nothing anyone else sees is a computed hour.

**Needs local activity on here** (`laika activity on`): the signals are the
ones it already counts. Then each sync asks the board whether drafting is on —
the organisation's *Time* setting at `drafts` **and** your own *Draft my time*,
both set in the web app — every sync while it is, at most once an hour while
it is not. Either off: nothing is drafted or sent, and what this machine
remembered sending is forgotten; the board deletes the drafts it held.

**What a block is built from**, all local: the times of Claude Code's replies
and the session each is in (the token reader's records — automated sessions
left out, the same task rule: a session's own Laika mark, else a key in its
branch), the prompts you typed (`events.log`, Claude Code's for now — Codex
and Gemini CLI are LAI-790), the turns you started in an Omnigent
orchestrator's session (`events.log` too, LAI-792 — a lane of their own, each
end a reply, never a typed prompt; the ones Omnigent started itself are left
out, D-090), the Laika marks that start work on a task,
the commits you made on this machine in the repos sessions started in (author
time, and a task key from the subject, which is read and dropped at once), and
the reply times and task of each builder an Omnigent runner dispatched (D-095 —
for its key alone).

**Made on this machine** (LAI-864): your email cannot tell two laptops apart,
so a commit counts only when git's own reflogs here say a commit, amend,
cherry-pick, revert, `git am` or a rebase wrote it — never a fetch, pull, merge,
reset or checkout. Each sync also keeps the hashes it drafted in
`~/.laika/activity/made-here` (0600, never sent, deleted when drafting is off),
so a commit still counts after its worktree and branch are removed. One made in
a worktree that was removed before any sync ran is lost: nothing here says it
was yours.

**The rule** (measured over 14 days on the owner's machine):

- A *lane* is one session — its subagents with it — or the prompts you typed.
  Events no more than 15 minutes apart chain; after the last one before a
  longer gap a lane stays active 5 minutes.
- A minute counts **once**, however many lanes are active in it: parallel
  sessions split your time, never multiply it. A minute's tasks are the keys
  of the lanes active in it, and it is split equally between them.
- A session's untied minute takes the key of a commit you made on this machine
  in its repository with exactly one key the board serves, authored within 15
  minutes after it.
  Commits never make time.
- **A minute you were active in, with no key from any lane of yours, takes
  the card of each builder Omnigent dispatched that is active in it** (D-095):
  its key by the same task rule — its own Laika mark, else a key in its
  branch — and active by the same lane rules. Several builders at once split
  the minute equally between their keys. A minute your own lanes tied keeps
  its keys and gains none. A builder never makes a minute and adds no count:
  with you not active, nothing is drafted, and its own time is never yours.
  Only a session the hook marked as an Omnigent runner's sub-agent lends a
  key; `CI` and `LAIKA_ACTIVITY_SKIP` sessions lend none, and nor do sessions
  skipped before the hook could say which they were.
- A run of active minutes, cut at local midnight, is one block per task in it;
  the blocks of a run add up to its wall-clock minutes. At most 48 a day: the
  shortest is merged into the nearest block of the same task, or dropped.

**What leaves**, on `PUT /api/v1/me/time-drafts`, for the last 7 days whose
blocks changed: per local day and zone, each block's start, end, minutes, task
key or `null`, and counts — prompts, replies, sessions, commits, marks — and,
to a board that says it takes them (`signal_times` in its time settings), which
five minutes the block's prompts and commits fell in: `at`, `[bucket, count]`
pairs, so My day can draw its SIGNALS lane (D-096). A day whose report would
pass 16 KB with them goes without them. Never prompt or reply text, paths, a
folder's own name, repository names, a branch you did not turn on (below),
session ids, commit messages or window titles. `laika time draft [--days N]` prints the blocks for
your last days, and what they were built from — Omnigent orchestrator turns
included, since a block carries counts only — and which blocks took a
dispatched builder's card, which the body does not say; `--json` prints the
exact body. Neither writes or sends anything.

**Agent minutes are not your hours.** With Claude Code's OpenTelemetry on
(`laika activity on`), each usage report also carries every session's tokens
per task (`session_tasks`: a session's one-way key, a task key, a count), so
the board can split Claude Code's own `active_time` the way tokens are split.
The board shows it as agent minutes, never as hours.

### `laika time folder` — a name you chose for a work folder (LAI-866, D-098)

```
laika time folder name NAME [DIR]     name a folder (default: the one you are in)
laika time folder rename NAME [DIR]
laika time folder forget [DIR]
laika time folder list                the names on this machine, and the branch switch
laika time folder branch on|off       send a named folder's branch too (off by default)
```

Name a folder once — *this folder is "Acme"* — and every block drafted from it
carries **Acme**: a Claude Code session by its working directory, an Omnigent
chat by its working folder. In *To settle* an untied block then reads
**Needs a card · Acme**, and when a project you can read matches the name the
board puts the block under it.

- **The name is yours.** You type it; it is never filled in from the
  folder's own name. 1 to 60 characters, no `/` or `\`, no control character,
  no space at either end — the board refuses anything else.
- **Only the name leaves.** The folder's real name and path are read on this
  machine, to look the name up, and go no further; nor do file names, prompts,
  replies or commit messages. The branch goes only after
  `laika time folder branch on`: for a Claude Code session the branch it
  started on (the hook's `sessions` file), for an Omnigent chat the branch its
  folder was on when the chat started.
- **A folder inside a named folder takes the nearest name.** `~/work/acme`
  named *Acme* and `~/work/acme/web` named *Acme Web*: a session in
  `~/work/acme/web/src` is *Acme Web*, one in `~/work/acme/docs` is *Acme*.
- **A block whose lanes come from two differently named folders** takes the
  name with the most lane-minutes behind it — each minute of the block, each
  of your lanes active in it that went to the block counts one for its
  folder's name. A lane in an unnamed folder, and the prompts you typed, count
  for no name. **Two names tied for the most, and the block carries no name**,
  rather than one picked. The branch is chosen the same way among that name's
  lane-minutes.
- **Kept in `~/.laika/work-folders.json`**, 0600 — beside `solidtime.json`,
  not in `~/.laika/activity`, so **`laika activity off` keeps your names**:
  they are your settings, not something counted. Delete the file to forget
  them all.
- **An older board is never refused.** The name and branch go only to a board
  whose time settings say `folder_names: true`; to any other the blocks go
  without them.

The Omnigent chat's folder and branch come from the hook: at the chat's start
it appends `<epoch> <session> <branch|-> <folder>` to
`~/.laika/activity/primary-sessions` (0600, never sent), reading the branch
from the repository's `.git/HEAD` with shell builtins — no `git`, no fork. A
line from before LAI-866 has two fields, names no folder, and is read as it
always was.

## `laika time push` and `pull` — the Solidtime bridge (LAI-788, D-088)

Solidtime is the billing record. **This machine is the only thing that talks
to it**: the board never calls Solidtime, and never sees your Solidtime URL or
key.

```
laika time connect               # once: your Solidtime URL, then your API key
laika time push                  # your confirmed time → Solidtime, as KEY title
laika time pull                  # what was logged in Solidtime → Laika (35 days)
laika time status                # where it goes, and the last push and pull
```

**Connect** asks for the URL (https, or http on this machine only) and your
personal API key — from your Solidtime profile, *API tokens*; never a flag, so
it stays out of shell history. It checks the Solidtime account's email is your
Laika email, here, and keeps both in `~/.laika/solidtime.json` (`0600`). Time
from today on is pushed; `--since YYYY-MM-DD` reaches back.

**Each push and pull asks for your Laika password**, signs in, and signs out
when it is done — only to a board on https, or on this machine. The board serves a person's hours to no token, so the token
in `~/.laika/env` — the one your agents use — cannot read them or send them
anywhere.

**Push** writes each confirmed or typed entry as `KEY title` (the form
Solidtime's own browser extension writes) on the Solidtime project its space
is mapped to, billable as that project is. An entry with no start goes at
09:00 on its day, after the day's earlier ones. Nothing is written twice:
every entry this machine creates is noted in `~/.laika/solidtime-sent.json`
before the board is told, and before each one what Solidtime already holds is
read back. An edit or delete in Laika is written to Solidtime only while
Solidtime still holds what Laika last saw; if it changed there too,
Solidtime's is kept. Nothing in a closed period is rewritten, and agent
minutes are never sent: they never become entries.

**Pull** re-reads the last 35 days (`--days N`, up to 92) — Solidtime has no
webhooks and no `updated_at` — and sends the board each entry's start, end,
project, a card key read from its description and a digest. **Never the
description.** The key is the one the description starts with, else the only
one in it; the board resolves it and never guesses. An edit is a new revision
of the entry, a delete is a delete, and a change in a closed period is flagged
and not taken. Only work comes in, never breaks. **An entry that came from
Solidtime is read-only in Laika**: My day shows it without Edit or Delete —
change it in Solidtime, and the next pull brings the change.

**For owners and admins**, with a Solidtime key that sees everyone (manager
or above):

```
laika time map                   # Solidtime projects, and the space each is mapped to
laika time map "Acme build" acme [--push]     # many Solidtime projects → one space
laika time people                # confirm which Solidtime member is which person
laika time pull --all            # everyone's hours; people not on Laika are kept
```

`people` matches members by email **on this machine** and asks you to confirm
each; only the pairing — a Solidtime member id and a Laika person — reaches the
board.

**Timers**: `laika time start ONR-123` starts a Solidtime timer for a card
(`--switch` stops a running one first) and `laika time stop` stops it. Only a
person starts one: it refuses in CI, under `LAIKA_ACTIVITY_SKIP` and in an
Omnigent agent's session, and nothing starts one when an agent claims a card.

## `laika agent` — a registered agent's session, bound to its harness (LAI-542)

A registered agent (D-114, LAI-534) acts through **its own token**, never its
owner's. `laika agent` opens that agent's session on the board when a Claude
Code or Codex session starts, renews it every 30 s **only while that harness
process is alive**, and closes it when the harness session ends (proposal
§4.2, §4.7; SPEC §9.1.1).

```
laika agent login claude-code --url https://board.example < agent-token   # once; stdin, never argv
laika agent hooks on --harness claude-code                                 # opt-in
laika agent session status                                                 # what is open here
```

`login` refuses a person's token (the board answers `403 not_an_agent`), and
keeps the agent's in `~/.laika/agents/<harness>.json` (0600, directory 0700).
`LAIKA_AGENT_TOKEN` (with `LAIKA_AGENT_URL`) overrides it; `LAIKA_TOKEN` is
never read. `hooks on` merges its entries into `~/.claude/settings.json` or
`~/.codex/hooks.json` — `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `Stop` and `SessionEnd` for both, and `PostToolUseFailure` for
Claude Code, which Codex does not document — recognised by `laika-agent-hook` in the command, and
`hooks off` removes exactly those. Codex runs a new hook only after you trust
it in `/hooks`.

**Other harnesses (LAI-557).** `laika agent` also knows `cursor`,
`copilot-cli`, `copilot-vscode`, `copilot-cloud`, `gemini-cli` and
`antigravity` (`cli/src/agent-adapters.ts`, one table). Each one runs on the
same engine, with **no hooks**: no other harness's hook format has been run on
a real binary here. So `laika agent hooks on --harness gemini-cli` installs
nothing. It prints the explicit commands and exits 1:

```
laika agent login gemini-cli --url https://board.example < agent-token
laika agent session start --harness gemini-cli --harness-session <id> --pid <gemini's pid>
laika agent inbox --harness gemini-cli          # the only delivery boundary without hooks
laika agent checkpoint save --harness gemini-cli --note-file note.json
laika agent session end --harness gemini-cli --harness-session <id>
```

`--pid` is required, because the helper never guesses which `node` is the
harness. The watcher then renews the session while that process lives.
Nothing reaches the agent mid-turn: it sees new work when one of these runs.
What each harness documents (hooks, injection, credentials, headless start),
and what was and was not run on Belka, is in
[`agent-adapters/CAPABILITIES.md`](agent-adapters/CAPABILITIES.md).

### How it stays bound to the harness

| Event | What the hook does |
| --- | --- |
| `SessionStart` | finds the harness process (the nearest ancestor named `claude` / `codex`; `LAIKA_AGENT_HARNESS_PID` overrides), records its PID **and start time**, opens the session (or reuses the one already open for this harness session), starts a detached watcher, and tells the model the `session_id` to pass to `start_working` |
| `UserPromptSubmit`, `PostToolUse` | no network: opens the session if `SessionStart` never did, restarts a dead watcher while the harness lives, notes a model or version that changed for the watcher's next beat, and shows a pending lost-claim notice once |
| `SessionEnd` | hands `end` to a background process (the harness gives a hook 1–3 s); the board records `end_reason: ended` |

**Why a watcher and not `PostToolUse` beats.** Hooks fire only at a prompt or a
tool call. A model thinking for five minutes, or a person reading, fires none,
and the server expires a claim five minutes after its last renewal — so
tool-call beats alone drop working sessions. The watcher beats on a timer and
checks the harness before every beat; the hooks are the backstop. The cost is
one small background process per harness session.

**When the harness dies** — crash, `kill -9`, closed terminal — the watcher
sends nothing more and exits; the session is marked `abandoned`, not ended, so
its claims **lapse and expire** (the recovery path) rather than being released
as finished. A PID the OS later reuses is not mistaken for the harness: the
start time must match too. Nothing reclaims automatically; a lost claim is
shown to the model once, bounded to three tasks. **Only an `expired` claim may
be taken back**, by an explicit reclaim (`start_working` with `reclaim: true`);
a `released` one — which is also how a claim the task's selected agent does not
back ends (LAI-586) — or a `transferred` one is over, and the notice says not to
reclaim it: the board would refuse.

**What the session says about itself** (D-118, LAI-588) — self-reported, and
deciding nothing on the board. The start sends `harness` (`claude-code` or
`codex`, from the hook) and, when they can be told, `harness_version` and
`model`; a heartbeat sends either again only when it changed (a `/model`
switch, or a version first read after the start), and no body otherwise. Both
are read from what the harness itself wrote: the hook input's `model`, and its
transcript (`transcript_path`) — Claude Code's `version` and last reply's
`message.model`; Codex's `session_meta` `cli_version` and last `turn_context`
`model` — reading at most 256 KB from each end of the file, and only a regular
file. **Nothing found is nothing sent**: a field is left out, never sent empty
or guessed, and one the board's shape would refuse is left out too.

**Network failures** retry the same session and never open another. A start
carries an `Idempotency-Key` written to the state file before the first
attempt, and every retry of it — in the same hook or the next — sends the same
key, so a start whose answer was lost after the board made the session gets
that session back (the board replays a keyed `POST` for 24 h, SPEC §6.3). **A
success whose body did not arrive whole, or names no valid session, is the same
ambiguous case**: retried with the key, never taken as done. **The key lives
as long as the logical start is unconfirmed.** A 5xx, a 408 or a 429 is retried;
even a refusal, or any mix of drops and errors across hooks, leaves the same key
for the next attempt, because an earlier attempt may have made the session. A
new key is minted only for a new harness process, or after a confirmed session
has ended. Concurrent starts
take a lock *before* reading the state, so a second starter waits and then
finds the first one's session.

**The token** is sent as a header and handed to background children on stdin.
It is never in argv, a child's environment, a state file
(`~/.laika/agent-sessions/`, 0600), the helper log, or hook output.

**Every subprocess the helper starts**, and the environment each gets:

| Subprocess | Started by | Environment |
| --- | --- | --- |
| `readlink`, `find`, `head` | `plugin/scripts/laika-agent-hook`, locating the entry | the harness's, **minus `LAIKA_AGENT_TOKEN` and `LAIKA_TOKEN`**, unset before any of them runs; stdin is `/dev/null`. The launcher's first command is `set +x +v +a`, so `sh -x`, an inherited `SHELLOPTS=xtrace` or `allexport` neither prints nor exports the token, and its scratch variables are unset before use, so a name already exported cannot carry it |
| `node agent-main hook <event> <harness>` | the launcher: the one consumer | `LAIKA_AGENT_TOKEN` restored for it alone if the harness passed one, never `LAIKA_TOKEN`; the hook JSON on stdin |
| `ps -o ppid=,stat=,lstart=,comm= -p <pid>` | the liveness check and the harness walk | a fixed `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `LC_ALL=C`, `LANG=C`, and nothing of the caller's |
| `node agent-main.(ts\|js) _watch <harness> <id>` | `SessionStart`, and a hook restarting a dead watcher | an allowlist: `HOME`, `PATH`, `TMPDIR`, `LANG`, `LC_ALL`, `LAIKA_AGENT_HEARTBEAT_SECONDS`; the credential on stdin |
| `node agent-main.(ts\|js) _end <harness> <id>` | `SessionEnd` | the same allowlist; the credential on stdin |

**A zombie is dead.** A harness that has exited but not yet been reaped keeps
its PID and start time. The liveness check also reads the process state, and
`Z`, `X` or an exiting `E` count as gone.

**What reaches the model is checked.** The session id must be a ULID, or it is
not repeated. A lost claim is named only when its ids are ULIDs, its generation
is a positive integer, and its state is `paused`, `released`, `expired` or
`transferred`; anything else is dropped. At most three are named, quoted, in a
line that says they are board data rather than instructions, and a hook's whole
context is capped at 1,200 characters. Lost claims are kept in the state file as
data and checked again when shown; text an older helper kept there is dropped
unread.

**Alive, dead, or unknown.** The liveness check has three answers. *Dead*
needs evidence: the kernel says there is no such process (`kill(pid, 0)`
answers `ESRCH`), the start time differs (the PID was reused), or the state is
a zombie, dead or exiting. **A failed `ps` is never evidence by itself** — it
exits 1 with nothing printed for a missing PID, but also when it cannot
allocate or initialise — so every failed run asks the kernel, and a process
that exists (`kill` succeeds, or `EPERM`) is *unknown*, not alive: renewal
still needs a `ps` answer with the right start time. *Unknown* —
`ps` timed out (5 s), was killed, failed, or printed something unreadable —
renews nothing that beat and abandons nothing: the session is kept and checked
again at the next beat. A check that never comes back simply lets the lease
expire.

### Receiving a hand-off (LAI-548)

The receiving agent's side of SPEC §4.73, in the order D-116 item 8 requires:
**fetch, verify, check out, and only then accept.**

```
laika agent handoff inbox                 # live offers to this agent (GET /agents/me/inbox)
laika agent handoff show <offer>          # checkpoint, verification, approval, and the note
laika agent handoff prepare <offer>       # fetch the tag, verify the SHA, make a fresh worktree
laika agent handoff accept <offer>        # only after prepare: send verified_commit_sha
laika agent handoff decline <offer> --reason "busy"
```

`laika agent inbox` and `laika agent accept <offer>` are the same commands.

- **`prepare`** reads the offer and the checkpoint's newest ref, finds the
  remote of this repository whose URL is **exactly** the project's configured
  repo on github.com (`--remote` to name one) — `https://[user@]github.com/
  <owner>/<repo>`, `ssh://git@github.com/…` or `git@github.com:…`, checked
  after `insteadOf` and compared whole, never by suffix — and fetches exactly
  that ref into a private ref, `refs/laika/handoff/<offer>` — no `+`, no tags,
  no submodules. The fetch goes to the URL, rebuilt from what was checked,
  never to the remote's name, so no configured refmap applies; rewrites of
  that URL are neutralised, and every other ref and `FETCH_HEAD` are compared
  before and after. A local mirror is fetched from only when the operator's
  environment names its directory (`LAIKA_HANDOFF_LOCAL_REMOTE_ROOT`) and its
  real path is exactly `<root>/<owner>/<repo>.git`; the tests use this. It refuses,
  printing **"Save needs attention"** and recording that on this machine,
  when the fetch fails (a deleted tag), the ref is an annotated tag, or it
  resolves to anything but the checkpoint's full SHA. Only then does it make
  a **new** worktree beside the checkout (`--into` to choose) on a dedicated
  branch, `<LAI-NNN>-handoff-<suffix>`, at that commit. The primary
  checkout's HEAD, index and files are never written. A `pending`,
  `uncertain` or `ref_deleted` checkpoint is refused before any fetch, in
  SPEC §4.70's words. A prepare that stopped part-way (a crash, a kill)
  leaves its record as `preparing`. **A retry never deletes anything**: it
  takes the first worktree path, branch and private ref that are all free
  (`…-handoff-<suffix>-2`, `-3`, …), leaves whatever an earlier attempt left
  exactly as it is, and prints each leftover with the command that would
  remove it, for you to run once nothing you need is in it. Every path and
  name in those commands is single-quoted, so they paste as printed; a
  symbolic ref is removed as itself (`symbolic-ref --delete`,
  `update-ref --no-deref -d`), never through to what it names. Read them
  before running them: `worktree remove` refuses modified or untracked
  files but deletes **ignored** ones (a `.env`) without asking, and
  `branch -d` refuses only a branch not merged into its upstream or `HEAD`.
  **Choosing names:** a name counts as taken if anything is there — a
  branch or ref, a **symbolic ref, even one pointing at a branch that does
  not exist** (which `show-ref` does not list), a leftover reflog, or a file
  or directory at its path.
  **Writing refs:** the fetch writes no ref at all — it brings the objects,
  and the tag's value is read with `ls-remote` by its exact name. The
  private ref and the branch are each created in one create-only step,
  `git update-ref --no-deref <ref> <sha> <zero>`, with nothing checked in
  between, and the worktree is added on that branch (never `worktree add
  -b`, which follows a symbolic ref). git refuses that step for an existing
  ref or a symbolic ref naming a branch that exists, and never writes
  through a symbolic ref. A **dangling** one depends on the git: the CI
  runner's refuses it (`dangling symref already exists`); Apple git 2.50.1
  replaces it with the plain ref, and has no command that both verifies and
  creates one ref. After
  the writes, every other ref is compared with before, both refs must be
  plain refs at the checkpoint, and the new worktree's `HEAD` must name the
  branch.
- **`accept`** refuses unless `prepare` succeeded here, and checks again that
  the private ref and the worktree are still at the verified SHA. It then
  sends that SHA, with this harness's live session when there is exactly
  one, and prints the next step only after the board has transferred the
  claim. It never retries: `422 checkpoint_mismatch` is reported as it is;
  `409 checkpoint_unverified` is worded *"Verification pending"* (or the
  state the checkpoint is now in); `409 offer_taken` marks the offer lost
  and **locks the worktree** with that reason (`git worktree list` shows it),
  so nobody continues from it. A lock that fails is reported as failed.
- **Untrusted text.** The note and the reason are printed inside a block
  whose markers carry a random nonce, bounded per field, with control
  characters shown as `\u{…}` rather than sent to the terminal. Nothing from
  the note, the branch name or the repo is executed: git runs from an argv
  array, every call has hooks and fsmonitor switched off (so checking out the
  sender's commit runs none of its hooks), and git sees only an allowlisted
  environment — the same allowlist as the sender's helper (LAI-547), so no
  token reaches it. **No attribute is read from the sender's tree**
  (`--attr-source` is the empty tree, the global and system attributes files
  are off, and a repository whose own `info/attributes` sets anything is
  refused), so a `.gitattributes` cannot select a `filter`, `diff` or `merge`
  driver to run; Git LFS pointers stay pointers. **Replace refs are never
  followed** (`GIT_NO_REPLACE_OBJECTS`), so `HEAD` at the checkpoint SHA is
  that commit's tree, and the new worktree must show no difference from it.
  Needs git 2.41 or later; an older git refuses `--attr-source`, so this
  fails closed. Bidirectional and zero-width format characters in the note
  are escaped as well.
- What this machine learned is kept in `~/.laika/agent-handoffs/<offer>.json`
  (0600): the verified SHA, the worktree, and `prepared`, `accepted`, `lost`,
  `declined` or `needs_attention`.

### Harness capability matrix

Claude Code and Codex only. Cursor, Copilot (CLI, VS Code, cloud), Gemini CLI
and Antigravity are in [`agent-adapters/CAPABILITIES.md`](agent-adapters/CAPABILITIES.md),
under the same four cells; none of them has a Verified-and-tested cell.

Cells: **Verified-and-tested** (run on the version shown, against a real
board), **Documented-not-tested** (in the harness's docs, not run here),
**Unsupported**, **Unverified**. Docs read 2026-10-28:
code.claude.com/docs/en/hooks, learn.chatgpt.com/docs/hooks.

| Capability | Claude Code 2.1.280 | Codex 0.162.1 |
| --- | --- | --- |
| Agent credential | Verified-and-tested (`laika agent login`, own file; not `headers`) | Documented-not-tested (same file, or `LAIKA_AGENT_TOKEN` in the env Codex passes to hooks) |
| `SessionStart` opens the session | Verified-and-tested (`claude -p`) | Documented-not-tested |
| Harness found by PID walk from the hook | Verified-and-tested (real `claude` process) | Documented-not-tested (expects a process named `codex*`) |
| Detached watcher outlives the hook | Verified-and-tested (13 beats over a 15 s `claude -p`) | Documented-not-tested |
| Inject (`hookSpecificOutput.additionalContext`) at `SessionStart` | Verified-and-tested (the model repeated the session id) | Documented-not-tested |
| `UserPromptSubmit` / `PostToolUse` backstop | Documented-not-tested (installed and run by `claude -p`; no observable effect when the session is live) | Documented-not-tested |
| Inject at `PostToolUse` / `UserPromptSubmit` (lost-claim notice) | Documented-not-tested (the output is unit-tested, not shown to a real model) | Documented-not-tested |
| `SessionEnd` ends the session | Verified-and-tested (`end_reason: ended`) | Documented-not-tested (advisory, best-effort: a missed end leaves the claim to expire) |
| Renewal stops when the harness dies | Verified-and-tested with a fake harness named `claude` killed mid-session (`agent-session-e2e.test.ts`) | Documented-not-tested. The engine is shared and that test covers it, but that is evidence about the shared code, **not certification of Codex**: no Codex process was killed |
| Headless | Verified-and-tested (`claude -p --settings`) | Unverified: `codex exec` needs hook trust, given only interactively in `/hooks` or by `--dangerously-bypass-hook-trust`, which this run was not permitted to use |
| Receive a hand-off (`laika agent handoff prepare` / `accept`) | Documented-not-tested in a harness: the commands are harness-independent and are tested against a real board and real git (`agent-handoff-e2e.test.ts`), not yet run from inside a Claude Code session | Documented-not-tested (same commands, `--harness codex`; no Codex process ran them) |
| Untrusted note shown to the model | Documented-not-tested: its markers and contents are asserted in tests, not shown to a real model | Documented-not-tested |

What is **not** guaranteed: a harness that exits without firing `SessionEnd`
(a crash, Codex's advisory end) leaves the session open on the board until its
claims expire; the watcher can be killed by the OS (sleep, an OOM) and nothing
renews until the next prompt or tool call restarts it; and a start that keeps
failing for more than 24 h (the key's replay window) opens a new session when it
finally gets through.

## `laika agent checkpoint` — save the task's work so another agent can continue it (LAI-547)

A checkpoint is a save an agent makes **on purpose** inside a task its session
holds (D-115): a work-in-progress commit on the task's own branch, pushed with
one lightweight tag, then registered on the board. A receiver continues from it
(LAI-548). The board never fetches anything: a checkpoint is `verified` only by
GitHub's signed push notice (D-116, D-116a).

```
laika agent checkpoint save --note-file note.json   # commit, push the branch, push ONE tag, register
laika agent checkpoint note < note.json              # keep a note for the next (automatic) save
laika agent checkpoint status                        # retries anything unregistered, then shows verification
laika agent checkpoint reverify <id>                 # a fresh tag at the same commit (D-116 item 7)
laika agent checkpoint consent status|on|off         # automatic saves: off until the agent's owner turns them on
laika agent checkpoints prune --dry-run [--days 90]  # list tags past retention; deletes nothing
```

### The order

1. **Commit** the work in progress on the task branch: **tracked changes
   only**. A new file is saved only when it is named with `--file NEW`
   (repeatable) — a scratch file, a dump or a local build is not work in
   progress just because it is in the worktree. Automatic saves never add a
   new file.
2. **Write the record** — the checkpoint id (a ULID the helper mints), the
   idempotency key and the exact body it will register — to
   `~/.laika/agent-checkpoints/records/<id>.json` (0600), before anything is sent.
3. **Push the branch** (`<sha>:refs/heads/<branch>`), then **push the tag**
   `refs/tags/laika-ckpt/<LAI-NNN>/<id>` at the same commit, **alone in its own
   push** — GitHub sends no push event for more than three tags at once.
   Lightweight, never annotated: an annotated tag's notice names the tag
   object, and the board would read the save as `uncertain`.
4. **Register** (`POST /tasks/:id/checkpoints`, with the claim's generation).
   If the board does not answer — a 5xx, a timeout, an answer lost on the way —
   the record stays at `tag_pushed`, and the next `save`, `status` or hook sends
   it again **with the same key and the same body**, so the board answers with
   the one checkpoint it already has. A `save` of a commit already pushed
   answers with that checkpoint's real state — registered and "Verification
   pending", or still unregistered (exit 1) — never "nothing new". A refusal
   (a lost claim, the wrong repo) is recorded and not retried.

After registering it prints **"Verification pending"**. `status` asks the
board each time: **"Verified"** once GitHub's notice arrived, and after ten
minutes pending (`LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS`, measured by the
board's clock) **"Verification pending — no push notice from GitHub yet"**,
with the hint to check the webhook's *Recent Deliveries* and use *Redeliver*,
or to `reverify`.

### What it refuses

Each is a refusal **before** the step that would change anything; exit code 2.

| Rule | How |
| --- | --- |
| Only a task worktree | a linked `git worktree`; the primary checkout only with `git config laika.checkpoint.allowPrimary true` in that repo |
| Only the task's own branch | not detached, never `master`, `main` or the remote's default branch, and named after the task (`LAI-547-…`) or the branch the task records. At the push itself **every place the push goes** is asked what its default is **now** — each URL from `git remote get-url --push --all <remote>` (every `pushurl`, or every `url`, after git's one rewrite: `pushInsteadOf` before `insteadOf`), asked as itself with `git -c url.<url>.insteadOf=<url> ls-remote --symref <url> HEAD` so `insteadOf` cannot send the question somewhere else, and refused if a configured `insteadOf` value is that URL exactly, or if it is also a remote's name (`ls-remote` reads a name before a path); a local path is asked as the `file://` URL of the repo the push reaches — its physical path, `realpath(3)` of the path joined to the worktree as written, so `link/..` goes where the filesystem and git take it, and a path that does not resolve is refused — not the clone's cached `origin/HEAD` and not just the fetch URL; a destination whose `HEAD` names no branch, or that does not answer, is refused |
| Never while git is busy | `index.lock`, `HEAD.lock`, a merge, rebase, cherry-pick, revert or bisect in progress; the helper's own lock beside the git dir keeps two saves apart |
| Never while a tool is running (automatic saves) | `PreToolUse` marks a tool as running, with the harness process it runs in (and the subagent, from `agent_id`), and `PostToolUse` or Claude Code's `PostToolUseFailure` clears it. A marker counts **while that process lives, whatever its age**, and is stale only once it is dead or its PID reused. `Stop` clears only what it shows is finished: Claude Code's `Stop` lists `background_tasks`, one `{ id, type, status, … }` per task in flight, **every one read** (a list of more than 1000 is not judged: nothing is cleared and a session-level marker holds saves off until a later readable `Stop` shows nothing running; a running entry with no `id` does the same). While **any** of them has a status that is not a known finished one (or none), nothing is cleared and each such task is marked, so a save waits for it; only an empty list, or one whose every task is finished, clears the main turn's markers. A subagent's marker is left to its own `PostToolUse`, and a `Stop` that does not carry the list (Codex's) clears nothing. The save waits up to 30 s for quiet, then takes the session's **interlock** right before staging — held to the commit only, never across the network, under a **10 s budget** written into the lock as a deadline — and checks again under it, before staging and before committing; a tool that appears, or a budget nearly spent, stops the save before its commit, and the index goes back **exactly** as it was (snapshotted with `git write-tree`, so a hunk you staged by hand stays staged). A hook reads its input as a stream, whole, within 5 s and up to 4 MB, or not at all. A `PreToolUse` it cannot read (too large, cut off, a writer that never closes) still counts as a tool that runs: it marks the sessions of the harness above it (every live one of that harness when it cannot tell), cleared at the next readable `Stop` that shows nothing running, and is denied if a save holds the interlock. `PreToolUse` writes its marker, then waits while a live save holds the interlock — until it lets go, or its deadline and 1 s more pass — and then **denies** the tool (`permissionDecision: "deny"`, documented by both harnesses) rather than let it run; the hook's timeout is 30 s, over that wait. The lock names its holder by PID **and** start time, so a reused PID holds nothing |
| Never `git add -A` | each tracked change, and each `--file` new file, is staged by name as a `:(literal)` pathspec; ignored files are never candidates, and listing one, or a file with no change, is refused |
| Never a secret | a secret-shaped name (`.env`, `*.pem`, `*.key`, `id_rsa`, `.npmrc`, `credentials.json`, …), a file over 1 MB (`--max-file-bytes`), or added lines matching a secret pattern (Laika's own `lai_` tokens, private keys, AWS, GitHub, Slack, Stripe, Google and API keys, bearer headers, passwords in URLs). **One refused file refuses the whole save, and is named** |
| Never a force push, never a stray ref | every push is one explicit refspec with no `+`; `--force` appears nowhere. `-c push.followTags=false --no-follow-tags --recurse-submodules=no`, so a repo's `push.followTags` cannot carry its annotated tags along. A remote that moved on is refused: fetch, merge, save again |
| Never the repo's own code | **every** git call runs with `core.fsmonitor=false`, `core.hooksPath=/dev/null` and `core.untrackedCache=false` — `git status` would otherwise start the repo's fsmonitor command — and the commit and pushes with `--no-verify`: a hook is repo content, and repo content is never run |

### The note

JSON with any of `work_done`, `next_step`, `decisions`, `open_questions` and
`failing` (known failing tests or builds; a failing test does not stop a
save), each at most 4000 characters. It is kept **apart from the manifest**
(the paths and line counts git reports), and it records **which commit it
describes**: a note given to `save` describes that save; a note kept with
`note` describes the save made from the HEAD it was written over, and any
later save carries it as an earlier save's, which the board labels *"Note
describes an earlier save"*. **A note that matches a secret pattern is
refused.** That is a mitigation, not a guarantee: no pattern can prove free
text holds nothing sensitive, and the note is shown to everyone who can read
the task.

### Automatic saves

**Off until the agent's owner consents** (`laika agent checkpoint consent on`,
signed in with the owner's password in a terminal — the agent's token cannot
consent for itself; SPEC §4.75). With consent, `laika agent hooks on`'s hooks
start a background save after ~10 mutating tool calls (`Edit`, `Write`,
`MultiEdit`, `NotebookEdit`, `Bash`, Codex's `apply_patch` and shell tools) or
~2 minutes after the first unsaved one, at `Stop`, and before the session ends
(the end waits for it, because the save needs the live claim). The background
save reads consent from the board **every time**; withdrawn, nothing is
saved, and manual saves keep working. A save that is refused is not retried
for two minutes. `Stop` prints nothing, so it never keeps a turn going, and
`PreToolUse` prints only that deny — never an `allow`, which would skip your
own permission rules.

If a harness never sends a readable Stop after an unreadable hook input,
automatic saves stay paused for the rest of that session (fail-safe: you lose
saves, never work).

The background child gets an allowlisted environment: the session helper's,
plus `SSH_AUTH_SOCK`, `GIT_SSH_COMMAND`, `GIT_SSH`, `XDG_CONFIG_HOME`, `USER`
and `LOGNAME` so git can reach the remote — never a token. **git itself, and
everything it starts** (credential helpers, ssh, a remote's `receive-pack`),
gets an allowlist too: `PATH`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`,
`XDG_CONFIG_HOME`, `GH_CONFIG_DIR`, `SSH_AUTH_SOCK`, `GIT_SSH_COMMAND`,
`GIT_SSH`, with `LC_ALL=LANG=C` and `GIT_TERMINAL_PROMPT=0` — so no
`AWS_SECRET_ACCESS_KEY`, `GH_TOKEN` or Laika token reaches it, and a
background push fails rather than waits for a password. A credential helper
that needs `GH_TOKEN` from the environment therefore does not get it; one that
reads its own stored login (`gh auth`, the keychain) works. The agent's token
is handled exactly as the session helper handles it (above): a header, a
child's stdin, never argv, a record or the log — and a background save acts
with the credential on its stdin, so an agent logged in by `LAIKA_AGENT_TOKEN`
alone saves too.

**The owner's password** (consent on/off) is read into a buffer, sent, and
the buffer and the request body are zeroed once the board answers. The
prompt hands it over as a JavaScript string first, which no code can wipe.

**Prune.** `laika agent checkpoints prune --dry-run` lists the `laika-ckpt/`
tags on the remote whose task the board shows as done or cancelled at least
`--days` (90) ago. There is no other mode: Laika never deletes a tag, and an
operator deletes them deliberately under the tag ruleset's bypass (D-116 item
2).

### Capability matrix, checkpoints

Same cells as the session matrix above. "Tested" here means against a real
board on its own port and a real bare remote (`agent-checkpoint-e2e.test.ts`);
the harness rows are about the harness itself.

| Capability | Claude Code 2.1.280 | Codex 0.162.1 |
| --- | --- | --- |
| Manual `checkpoint save` / `status` / `reverify` (the CLI, any harness) | Verified-and-tested (the CLI run by the test with a `claude-code` credential, as an agent's Bash tool runs it) | Documented-not-tested: the CLI is the same for both, but the tests used a `claude-code` credential, not a Codex one |
| Push, then one tag alone, then register; retry with the same key | Verified-and-tested (the remote's `pre-receive` log shows one ref per push) | Documented-not-tested (the same engine; no Codex run) |
| Consent read before every automatic save | Verified-and-tested | Documented-not-tested (the same engine; no Codex run) |
| `PreToolUse` / `PostToolUse` drive the trigger and the in-flight check | Documented-not-tested: the hook entry was run with Claude Code's documented payloads by the test, not fired by a real `claude` process | Documented-not-tested. Codex runs a new hook only after you trust it in `/hooks`, which this run could not do |
| `Stop` saves what is unsaved; a running `background_tasks` entry keeps every marker | Documented-not-tested: the hook entry was run with the documented `background_tasks` payload (`{ id: 'task-001', type: 'shell', status: 'running' }`) by the test, not fired by a real `claude` | Documented-not-tested: Codex's `Stop` documents no `background_tasks`, so it clears no marker |
| `PreToolUse` deny while a save overruns its deadline | Documented-not-tested: the deny output is the documented shape and asserted, not shown to a real `claude` | Documented-not-tested (the same documented shape) |
| Save before `SessionEnd` ends the session | Documented-not-tested | Documented-not-tested (Codex's end is advisory: a missed end leaves the save to the next session) |
| GitHub's push notice verifies the save | Unverified here: the bare remote sends no webhook. LAI-545's criteria cover it against a real repository (LAIKA-797) | Unverified here (same) |

What is **not** guaranteed: a save the hooks never trigger (a harness that does
not fire `Stop`, a crash before `SessionEnd`) is simply not made — the work is
still on disk and the next session's save picks it up; a remote that is down
leaves the record to be pushed by a later run; and a note's secret check can
miss a secret it has no pattern for.

## `laika agent watch` — ask for a checkpoint before the machine dies (LAI-552)

Opt-in: nothing starts it but you. Run it in a terminal beside the harness.

```sh
laika agent watch                       # battery ≤ 15 % unplugged, or memory pressure for 60 s
laika agent watch --battery-percent 25 --memory-seconds 120 --interval-seconds 15
laika agent watch --offer-to <agent id> # also offer the task on, once the save is verified
laika agent watch --once                # print the two readings and exit
```

**When it fires.** The battery at or below `--battery-percent` (default 15)
**while unplugged**; or memory pressure elevated on every reading for
`--memory-seconds` (default 60) — one normal reading restarts the count, so a
spike is not sustained. **Hysteresis:** each condition fires once and is then
disarmed. The battery re-arms when it is plugged in or climbs 5 points above
the threshold; memory re-arms after 30 s of normal readings. Both firing on one
tick make **one** request.

**What a trigger does.** It requests the hooks' automatic save — the same
`autoCheckpoint` the hooks run, for every live agent session on this machine
that holds a claim. So the same rules hold: the owner's **consent** is read from
the board first, it waits for quiet (no tool running, no git operation), it
saves only the task's own branch and never `master`. It **writes no
continuation note** — that is the agent's (`laika agent checkpoint note`).
Then, only with `--offer-to`, it offers the task to that agent through
`POST /tasks/:id/handoff-offers` under the save's claim generation — and only
once the board calls the checkpoint `verified` (it waits up to
`--offer-wait-seconds`, default 120). **An offer pauses your claim** until it is
accepted, declined or expires, which is why it is never the default.

**What it reports.** Only what the board confirmed. Each line is one of:
no live claim here (nothing saved, nothing offered); consent off or unreadable
(nothing saved); busy (nothing saved); refused (the reason is in
`~/.laika/agent-sessions/helper.log`); saved here but **not registered** (with
the error; `laika agent checkpoint status` retries it); registered; offered, or
not offered and why. A save is never called successful unless the board
registered it.

**What it reads.**

| Metric | macOS | Linux | Anything else |
| --- | --- | --- | --- |
| Battery | `pmset -g batt` | `/sys/class/power_supply/*` with `type` `Battery`: `capacity`, and `status` `Discharging` as unplugged | `unsupported` |
| Memory pressure | `sysctl -n kern.memorystatus_vm_pressure_level` (1 normal; 2 warn and 4 critical are elevated) | `/proc/pressure/memory`, `some avg10` at or above `--psi-percent` (default 10) | `unsupported` |

**Not `memory_pressure`**: run without flags, that tool *allocates memory*
until the machine is under pressure. The sysctl is the kernel level it reports,
without the side effect.

**What the tools are given.** `pmset` and `sysctl` run by absolute path
(`/usr/bin/pmset`, `/usr/sbin/sysctl`), never looked up on `PATH`, with an
environment built from nothing: `PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
`LANG=C`, `LC_ALL=C`. No token of any name — the agent's `LAIKA_AGENT_TOKEN`
included — reaches them. A save's git calls keep the checkpoint helper's own
allowlist.

**Which checkpoint is reported and offered.** Exactly the one the save made or
matched, by its id. A session holding two tasks never reports or offers the
other task's checkpoint, however new it is.

A metric that cannot be read is printed as `unsupported (why)` — no battery,
no PSI in the kernel, another OS — or `unavailable (why)` when its command or
file failed. **Never as a number**, and it never fires anything.

### Capability matrix, watcher

Same cells as the session matrix above.

| Capability | macOS | Linux | Windows, other |
| --- | --- | --- | --- |
| Battery reading | Verified-and-tested (`--once` on Belka, macOS 27.2: `battery: 59%, plugged in`); the parser is tested on `pmset` text for both power sources | Documented-not-tested: the reader is tested against a fake `/sys` tree, not run on a Linux machine | Unsupported |
| Memory pressure reading | Verified-and-tested (`--once` on Belka: `kernel level 1, normal`); levels 2 and 4 tested on injected text only, never observed here | Documented-not-tested: the parser is tested on PSI text, not run on a Linux machine | Unsupported |
| Thresholds, hysteresis, one request per firing | Verified-and-tested with injected readings and an injected clock (`agent-watch.test.ts`) | the same (the logic does not depend on the OS) | — |
| A trigger's save and offer | Documented-not-tested end to end: the reporting is tested with the save and the board faked (no claim, consent off, refused, unregistered, pending, verified, offer refused); the save itself is `autoCheckpoint`, tested in `agent-checkpoint-e2e.test.ts` | the same | — |
| Fires on a real low battery or real memory pressure | Unverified: no battery was drained and no pressure was induced | Unverified | — |
