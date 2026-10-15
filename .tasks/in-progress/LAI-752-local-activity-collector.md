---
id: LAI-752
title: 'Local activity collector: prompt/session hooks, `laika activity` and a cheaper heartbeat (plugin/ + cli/)'
area: cli
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-15T18:20:07Z
status: in-progress
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

- [ ] The prompt hook appends one `p <agent> <epoch>` line to
      `~/.laika/activity/events.log` in a single append, drains stdin to
      `/dev/null` without reading it into any variable, prints nothing on
      stdout or stderr, always exits 0, runs no network, git or node, and
      measures ≤ 5 ms.
- [ ] The session-start hook appends `s <agent> <epoch>`, records the
      `git rev-parse --show-toplevel` of its working directory into
      `~/.laika/activity/repos` (deduped; entries unused for 30 days pruned),
      and starts a fully detached sync when the last sync is older than
      `min_sync_interval_s`.
- [ ] The session-end hook starts the detached sync and returns at once
      (well inside Claude Code's 1.5 s).
- [ ] `~/.laika/activity` is 0700 and its files 0600. Every hook is a no-op
      unless the cached sharing state in `~/.laika/activity/state.json` is on.

**`laika activity sync` (node, no new dependencies)**

- [ ] Aggregates `events.log` per local day for the last 14 days: prompts per
      agent kind and sessions.
- [ ] For each remembered repo in scope (`agent-repos` = all remembered;
      `laika-repos` = only repos carrying the Connect "Share with your
      project" block), counts by **author** date per local day for the last 14
      days the developer's commits (that repo's `user.email` plus the list set
      with `laika activity emails`): on any remote → pushed keys (contract
      hash), on no remote → `commits_local`. Mailmap off, a wide `--since`
      then filtered by `%at`; repos without remotes, worktrees and deleted
      repo paths (dropped) are handled.
- [ ] Sends `PUT /api/v1/me/local-activity` per the contract; honours 403
      `local_activity_off` (stop, clear the local log, recheck after 24 h),
      429 `Retry-After`, a 5 s timeout and backoff; never syncs more often
      than `min_sync_interval_s`; refreshes `state.json` from
      `GET /api/v1/me/activity-sharing` at most every 24 h; compacts
      `events.log` to the last 15 days after a success; a lock keeps two syncs
      from running at once; errors go only to `~/.laika/activity/last-error`.
- [ ] Nothing on the contract's "Never sent" list is ever sent.

**`laika activity on|off|status|sync|emails`**

- [ ] `on` checks sharing with the GET (not enabled → prints how to turn it on
      in the web app and stops), then installs hooks for Claude Code and every
      other agent `laika connect` configured on this machine.
- [ ] `off` removes only our hook entries and deletes `~/.laika/activity`.
- [ ] `status` prints exactly the JSON body the next sync would send, plus the
      last sync result.
- [ ] Per-agent install for Claude Code (`UserPromptSubmit`, `SessionStart`,
      `SessionEnd`), Codex, Gemini CLI, Copilot CLI, Goose, Kiro and Cline with
      the hook names the research verified; merged the way `laika connect`
      merges (backup once, idempotent, unreadable or ambiguous files refused
      with manual steps printed); our entries are marked so `off` removes only
      them. An agent whose hook mechanism cannot be verified is skipped with a
      clear message. Devin CLI running Claude Code hooks is not double counted.

**Heartbeat**

- [ ] The plugin heartbeat sends at most once per session per N seconds, N at
      most a third of the server's presence window, decided before any git
      call; presence stays correct, and a test proves it.

**Tests (temporary HOME for every one)**

- [ ] Real temporary git repos with a bare remote: pushed vs unpushed, amend
      after push, squash-merge then `fetch --prune`, a `.mailmap`, two author
      emails, a worktree, a repo without a remote, a deleted repo.
- [ ] Hooks print nothing, exit 0 with the server down, and never store prompt
      text (a unique marker string appears in no file under the temp HOME);
      per-prompt hook timing measured.
- [ ] The request body is validated against the contract; stub-server tests
      for 200, 403 `local_activity_off`, 429 and timeout.
- [ ] Install/remove round trip for each agent's config format from fixtures.
- [ ] Each test shown to fail without the code it covers.

**Docs and gate**

- [ ] `plugin/README.md` and `cli/README.md` updated; `docs/` untouched (LAI-751
      owns SPEC and DECISIONS). The CLI commands and hook names are listed
      below for merging into SPEC.
- [ ] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0, run separately after
      the last edit.

## Notes / context

- Contract: `/tmp/laika-activity/CONTRACT.md` (binding; shapes are not
  changed here). Facts: `/tmp/laika-heatmap-research/REPORT.md`.
- No new dependencies. `server/` and `server/web/` are read only (the
  presence window and the Connect block marker are read from them).
- Nothing is pushed and no PR is opened; the orchestrator merges after review.
