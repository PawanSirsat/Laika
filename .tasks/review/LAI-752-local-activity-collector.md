---
id: LAI-752
title: 'Local activity collector: prompt/session hooks, `laika activity` and a cheaper heartbeat (plugin/ + cli/)'
area: cli
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-15T18:20:07Z
status: review
finished: 2026-10-15T19:01:38Z
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4), on the temporary
branch `build-activity-collector`. This task touches `plugin/` and `cli/` only.
LAI-751 builds the server half (endpoints, SPEC, D-079) in parallel against the
same contract, `/tmp/laika-activity/CONTRACT.md`; this task cannot call those
endpoints yet and tests against a stub that implements the contract exactly.

A developer who has turned on "Share my local activity" (and whose org has
Developer insights on) gets per-day counts collected on their own machine:
prompts per agent kind, agent sessions started, commits not yet on any remote,
and a one-way key for each of their commits already on a remote. Nothing else
leaves the machine — never prompt text, paths, repo names, remote URLs,
branches, messages, emails or raw SHAs. The per-prompt hook is a few
milliseconds of shell and never prints. The plugin heartbeat stops costing a
git fork on every tool use while presence stays correct.

## Acceptance criteria

**Hooks (`plugin/scripts/`) — shell only**

- [x] The prompt hook appends one `p <agent> <epoch>` line to
      `~/.laika/activity/events.log` in a single append, drains stdin to
      `/dev/null` without reading it into any variable, prints nothing on
      stdout or stderr, always exits 0, runs no network, git or node, and
      measures ≤ 5 ms.
- [x] The session-start hook appends `s <agent> <epoch>`, records the
      `git rev-parse --show-toplevel` of its working directory into
      `~/.laika/activity/repos` (deduped; entries unused for 30 days pruned),
      and starts a fully detached sync when the last sync is older than
      `min_sync_interval_s`.
- [x] The session-end hook starts the detached sync and returns at once
      (well inside Claude Code's 1.5 s).
- [x] `~/.laika/activity` is 0700 and its files 0600. Every hook is a no-op
      unless the cached sharing state in `~/.laika/activity/state.json` is on.

**`laika activity sync` (node, no new dependencies)**

- [x] Aggregates `events.log` per local day for the last 14 days: prompts per
      agent kind and sessions.
- [x] For each remembered repo in scope (`agent-repos` = all remembered;
      `laika-repos` = only repos carrying the Connect "Share with your
      project" block), counts by **author** date per local day for the last 14
      days the developer's commits (that repo's `user.email` plus the list set
      with `laika activity emails`): on any remote → pushed keys (contract
      hash), on no remote → `commits_local`. Mailmap off, a wide `--since`
      then filtered by `%at`; repos without remotes, worktrees and deleted
      repo paths (dropped) are handled.
- [x] Sends `PUT /api/v1/me/local-activity` per the contract; honours 403
      `local_activity_off` (stop, clear the local log, recheck after 24 h),
      429 `Retry-After`, a 5 s timeout and backoff; never syncs more often
      than `min_sync_interval_s`; refreshes `state.json` from
      `GET /api/v1/me/activity-sharing` at most every 24 h; compacts
      `events.log` to the last 15 days after a success; a lock keeps two syncs
      from running at once; errors go only to `~/.laika/activity/last-error`.
- [x] Nothing on the contract's "Never sent" list is ever sent.

**`laika activity on|off|status|sync|emails`**

- [x] `on` checks sharing with the GET (not enabled → prints how to turn it on
      in the web app and stops), then installs hooks for Claude Code and every
      other agent `laika connect` configured on this machine.
- [x] `off` removes only our hook entries and deletes `~/.laika/activity`.
- [x] `status` prints exactly the JSON body the next sync would send, plus the
      last sync result.
- [x] Per-agent install for Claude Code (`UserPromptSubmit`, `SessionStart`,
      `SessionEnd`), Codex, Gemini CLI, Copilot CLI, Goose, Kiro and Cline with
      the hook names the research verified; merged the way `laika connect`
      merges (backup once, idempotent, unreadable or ambiguous files refused
      with manual steps printed); our entries are marked so `off` removes only
      them. An agent whose hook mechanism cannot be verified is skipped with a
      clear message. Devin CLI running Claude Code hooks is not double counted.

**Heartbeat**

- [x] The plugin heartbeat sends at most once per session per N seconds, N at
      most a third of the server's presence window, decided before any git
      call; presence stays correct, and a test proves it.

**Tests (temporary HOME for every one)**

- [x] Real temporary git repos with a bare remote: pushed vs unpushed, amend
      after push, squash-merge then `fetch --prune`, a `.mailmap`, two author
      emails, a worktree, a repo without a remote, a deleted repo.
- [x] Hooks print nothing, exit 0 with the server down, and never store prompt
      text (a unique marker string appears in no file under the temp HOME);
      per-prompt hook timing measured.
- [x] The request body is validated against the contract; stub-server tests
      for 200, 403 `local_activity_off`, 429 and timeout.
- [x] Install/remove round trip for each agent's config format from fixtures.
- [x] Each test shown to fail without the code it covers.

**Docs and gate**

- [x] `plugin/README.md` and `cli/README.md` updated; `docs/` untouched (LAI-751
      owns SPEC and DECISIONS). The CLI commands and hook names are listed
      below for merging into SPEC.
- [x] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0, run separately after
      the last edit.

## Notes / context

- Contract: `/tmp/laika-activity/CONTRACT.md` (binding; shapes are not
  changed here). Facts: `/tmp/laika-heatmap-research/REPORT.md`.
- No new dependencies. `server/` and `server/web/` are read only (the
  presence window and the Connect block marker are read from them).
- Nothing is pushed and no PR is opened; the orchestrator merges after review.

## For SPEC (LAI-751 merges these; this task does not edit `docs/`)

**CLI commands** (`cli/README.md` has the full text):

| Command | Does |
| --- | --- |
| `laika activity on [--agent <id>]` | `GET /api/v1/me/activity-sharing`; if both switches are on, creates `~/.laika/activity` and installs the hooks for Claude Code and every agent with a `laika` server at user scope (plus any named) |
| `laika activity off` | removes only our hook entries, deletes `~/.laika/activity` |
| `laika activity status` | the exact JSON the next `PUT /api/v1/me/local-activity` sends, and the last result |
| `laika activity sync [--background] [--quiet]` | sends the snapshot if `next_sync_at` has passed; `--background` re-spawns detached (setsid) |
| `laika activity emails [<email>…] \| --clear` | extra author emails, kept locally, never sent |

**Hook names installed** (`plugin/scripts/laika-activity-hook <prompt|session-start|session-end> <agent>`):

| Agent (id sent) | File | Prompt | Session start | Session end |
| --- | --- | --- | --- | --- |
| Claude Code (`claude-code`) | `~/.claude/settings.json` | `UserPromptSubmit` | `SessionStart` matcher `startup\|clear` | `SessionEnd` |
| Codex CLI (`codex`) | `~/.codex/hooks.json` | `UserPromptSubmit` | `SessionStart` matcher `startup` | `SessionEnd` |
| Gemini CLI (`gemini-cli`) | `~/.gemini/settings.json` | `BeforeAgent` | `SessionStart` | `SessionEnd` |
| Copilot CLI (`other`) | `~/.copilot/hooks/laika-activity.json` | `userPromptSubmitted` | `sessionStart` | `sessionEnd` |
| Goose (`goose`) | `~/.agents/plugins/laika-activity/` | `UserPromptSubmit` | `SessionStart` | `SessionEnd` |
| Kiro CLI v3 (`kiro`) | `~/.kiro/hooks/laika-activity.json` | `UserPromptSubmit` | `SessionStart` | `SessionEnd` |
| Cline | — | skipped: hooks folder not verifiable, no session end | | |

**Heartbeat**: `PostToolUse`/`Stop` post at most once per session per 90 s
(was per repo+branch per 300 s); `SessionStart` always posts. SPEC §8's
"throttled `PostToolUse`" line can say "per session, 90 s — under a third of
§9.3's 5-minute window".

## Contract notes

- **Agent ids.** The contract says the ids are "the same ids `laika connect` and
  the Connect wizard use", then lists `gemini` and `copilot` as examples. Those
  two are not such ids: Gemini CLI is `gemini-cli`, `copilot` is only an alias
  of `vscode` (VS Code + Copilot), and Copilot CLI has no id. The collector
  follows the rule: it sends `gemini-cli`, and `other` for Copilot CLI. If
  LAI-751 validates against the literal examples, these disagree — reconcile
  before merging both. No shape was changed.
- **collector_id** is "created once per machine". It is also replaced whenever
  local history is discarded (403 `local_activity_off`, the daily check saying
  off, `laika activity off`), so a re-enable the same day can never overwrite
  the earlier collector's snapshot for that day. Same shape, same rule for the
  server; worth a line in SPEC.
- **Merge commits** are not counted (neither local nor pushed). The contract
  does not say; recorded here so SPEC can.

## Evidence

- Prompt hook, `/bin/zsh -f`, fresh process per run, median of 41: 4.2–4.5 ms
  against 3.1 ms for the bare interpreter (`cli/test/activity-hook.test.ts`
  prints it). `/bin/sh` with its `cat` and `date`: ~8.3 ms. Under zsh the prompt
  path still works with `PATH` empty: it forks nothing.
- Mutation run (a harness that requires each anchor to match exactly once,
  checksums the edit, runs the named tests unmutated first, and restores in a
  `finally`): **49 of 49 mutations turn their test red** — hook silence, drain,
  `$USER_PROMPT`, the collect gate, Devin, the no-fork path, repo dedupe and
  prune, the sync launch and its due check; the heartbeat's window, per-session
  key and git-free throttle; mailmap, author date, worktrees, amend, squash,
  email matching, the window, `since`, the key, `other`, scope, deleted repos,
  16 KB; 403, 429, the timeout, the interval, the daily check, compaction, key
  memory, backoff, collector rotation, the lock; and every install/remove rule.
  Two first-round survivors were honest findings, fixed in the code comments:
  `--no-use-mailmap` alone is not what keeps a `.mailmap` out (`%ae` is), and
  the common-dir dedupe alone is not what counts a worktree once (SHA and
  authorship keys also do).
- Commits: `92361af` (heartbeat), `2bc915b` (collector).

## Review round 1

An independent same-vendor review found one blocking and six non-blocking
issues. All are fixed in `c44e85a`; the acceptance criteria above are frozen
and unchanged, and the task stays in review. Each fix has a test, and each test
was shown red with its fix reverted (a harness that requires every anchor to
match exactly once, checksums the edit, runs the test unmutated first, counts a
cancelled test as red, and restores in a `finally`): **18 of 18 reverts red.**

| # | Finding | Fix | Test (red without the fix) |
| --- | --- | --- | --- |
| 1 | Background syncs could pile up: a 5-minute-old lock was taken from a live holder, `next_sync_at` moved only when a sync finished, and a hung mount blocked sync calls | Lock records pid + start time and is taken only from a dead holder or a reused pid; `next_sync_at` is claimed when a sync starts; a 2-minute deadline aborts in-flight git (async, killed) and requests, repo paths are checked asynchronously, and a CLI run exits at the deadline | `activity-sync`: live holder with a 6-minute-old lock stays busy; reused pid is taken; next sync claimed while the GET hangs; hung sync abandoned at its deadline and writes nothing after; a stuck `git` is killed. `activity-command`: CLI exits at the deadline |
| 2 | `--path-format=absolute` is echoed by git < 2.31, so every repo looked like the first | `rev-parse --git-common-dir`, made absolute and resolved here; anything but one plain path is refused | `activity-census`, "older git": two repos counted with old-git output; garbage output counts nothing |
| 3 | Credentials came from whichever session started the sync; another board got the counts and its 403 wiped them | The board is recorded at `on`; syncs go only there with its token (`~/.laika/env` first); a session pointed elsewhere is refused with no send and no wipe; `on` against another board starts over | `activity-sync`, "one board": three tests |
| 4 | Narrowing to `laika-repos` took up to 24 h | The switch and scope are read before every send, and by `status` | `activity-sync`: scope narrowed at the board applies to the next body, pushed keys included |
| 5 | No backoff after an exception | Every failure backs off, doubling from the interval, capped at 6 h | `activity-sync`: exceptions back off 600 s, 1200 s, then the 6 h cap |
| 6 | Owner decision: pushed keys must respect "counting since" | Pushed keys only for commits authored at or after `since` | `activity-census` and the 403 resume test in `activity-sync` |
| 7 | Mutations survived: `--no-merges`, a widened `isOurs` | — | `activity-census`: a merge commit is not counted; `activity-command`: a person's own hook that mentions laika survives `off` |

Contract notes accepted without change: `gemini-cli`, `other` for Copilot CLI,
a new collector id when history is cleared, merge commits not counted. The
contract now names `gemini-cli` and Copilot CLI as `other` itself.

Behaviour changes worth a SPEC line: the switch and scope are read on every
sync (not at most daily); syncs are bound to the board `on` was run against;
nothing authored before sharing was turned on is reported, pushed or not.

## Review round 2

Re-review verdict APPROVE, with three non-blocking findings, all fixed in
`c3c5d5f` (and `36bb24a`, which brings the round-1 live-holder test's own lock
writer into UTC — the first full gate after `c3c5d5f` caught it); criteria
unchanged, still in review.

1. **Lock check depended on the time zone.** `ps -o lstart` prints in the
   caller's zone, so a live holder started under another `TZ` looked like a
   reused pid. `ps` now runs with `TZ=UTC LC_ALL=C`. Test (red before the fix):
   a holder started under `Pacific/Kiritimati`, checked from
   `Pacific/Pago_Pago`, keeps the lock.
2. **The deadline sent SIGTERM only.** `execFile`'s abort sent SIGTERM and
   cleared its 10 s SIGKILL timer. The abort now sends SIGKILL itself. Test (red
   before the fix): a fake `git` that ignores SIGTERM is gone within 5 s.
3. **Fixed waits in the launch tests.** They now poll for the condition, up to
   30 s, and read only a complete environment dump; assertions unchanged.
   `cli/test/activity-hook.test.ts`: 5 runs in a row, 26/26 each, at load ~23;
   once with a CPU hog on every core, 26/26.
