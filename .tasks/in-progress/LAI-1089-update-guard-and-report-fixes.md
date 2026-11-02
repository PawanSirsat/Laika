---
id: LAI-1089
title: 'laika update: the MCP guard compares only Laika''s entries; skipped credential files, a dirty checkout and origin edges are said and tested'
area: cli
assignee: shell/belka
priority: p1
depends-on: [LAI-1085]
discovered-from: LAI-1085
status: in-progress
started: 2026-11-02T12:38:09Z
---

## Why

Found live on Belka (owner, 2026-11-02), all in `laika update`:

1. **An update that moves the checkout always rolls back while any Claude
   Code session runs.** The post-switch guard hashes the *whole* of each MCP
   config (`mcpFiles` / `mcpBefore` in `cli/src/update.ts`), and Claude Code
   rewrites `~/.claude.json` every few seconds. Observed:
   `! an MCP config changed during the update: ~/.claude.json` → rollback,
   exit 1.
2. **A credential file that matches no tool name is skipped silently.**
   Omnigent · Belka's credential is `~/.laika/agents/polly.json` (LAI-589);
   the report loop reads only `<harness>.json`, and nothing says so.
3. **A checkout with local changes is reported as the board's exact build**:
   `versionAt` ignores `dirty` from `laika version --json`.
4. Origin matching between a credential and the board has no test for its
   edges.
5. `cli/README.md` does not document the mixed report line, the
   failed-before-sent line, or the cases above, and line 226 runs past 80
   columns.

## Acceptance

- [ ] The guard compares, for each MCP config it watches (`~/.claude.json`
      and every `USER_CONFIG` file), **only the Laika entries**: in
      `~/.claude.json` the top-level `mcpServers.laika` and every
      `projects[<dir>].mcpServers.laika`; `mcpServers.laika` in the Cursor,
      Gemini CLI and Antigravity files; `mcp.laika` in OpenCode's; the
      `mcp_servers.laika` table (any TOML spelling) in Codex's. Nothing else
      in those files is kept, compared or printed; only the path is printed.
- [ ] Tests: unrelated keys changing in those files during the update (Claude
      Code's own state, another server's entry, a Codex project trust level)
      do not roll back; a change to a Laika entry (top-level, per-project,
      Codex table) still rolls back, naming the file.
- [ ] Whenever `laika update` looks for credentials to report with, it prints
      one line naming each `~/.laika/agents/*.json` it did not report for and
      why — file names only. A file whose name is no tool's is **not opened**
      (`polly.json` is LAI-1088's to read; how it is written or read does not
      change here).
- [ ] A checkout `laika version --json` calls `dirty` sends no report, and the
      output line says so — on the already-current path and after a switch.
- [ ] Tests for origin matching: the same host on another port and http
      against https are not this board; a trailing slash is.
- [ ] Each fix has a test that goes red when the fix is undone (mutation
      checked, recorded in the log).
- [ ] `cli/README.md` documents the mixed `sent for X; not sent for Y (500)`
      line, `it failed before anything was sent`, the skipped-files line and
      the dirty case, and its update section is wrapped to 80 columns.

## Notes

- `cli/` only (SHELL). No new dependency.
- LAI-1088 (`origin/LAI-1088-generic-harness-ready`, another session) adds an
  optional `harness` argument to `sendClientReport` and owns `polly.json`;
  keep clear of `client-report.ts` and of the `sendClientReport` call, and
  merge master if it lands first.
- Belka load rule: one test file at a time, one worker, no full suite
  locally; CI runs the gate.
