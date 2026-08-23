---
id: LAI-012
title: Claude Code plugin skeleton with manifest and .mcp.json
area: plugin
assignee: builder-b
priority: p3
depends-on: []
discovered-from:
status: review
finished: 2026-08-24T01:54:08+05:30
started: 2026-08-24T01:42:42+05:30
---

## Goal

Stand up the shape of the shipped Laika plugin — manifest, folders, MCP server
declaration — so that when the `/mcp` endpoint exists in M3 the plugin is a
matter of filling in behaviour rather than inventing structure. Seeded early
because it has no dependencies and gives Builder-B parallel work during M1.

## Acceptance criteria

- [x] `plugin/.claude-plugin/plugin.json` with name, version, description,
      author, and declared components; validates against the plugin manifest
      schema.
- [x] `plugin/.mcp.json` declares the Laika MCP server over HTTP, reading the
      deployment URL and token from environment (`LAIKA_URL`, `LAIKA_TOKEN`) —
      **no secret is ever committed**, and a placeholder makes that obvious.
- [x] `plugin/hooks/`, `plugin/skills/`, `plugin/commands/` exist with a README
      in each stating what will live there and which milestone fills it.
- [x] One end-to-end vertical slice so the wiring is proven: a `/laika-status`
      command that reports configured URL and whether a token is present (it
      must **not** print the token).
- [x] `plugin/README.md`: what the plugin is, how to install it locally, how to
      configure `LAIKA_URL` and `LAIKA_TOKEN`, and what is not built yet.
- [x] The plugin loads in Claude Code without error when `LAIKA_URL` is unset —
      it degrades with a clear message rather than failing to load.

## Notes / context

Milestone: **M4**, seeded now. SPEC §7. **Builder-B owns this.**

Do not implement heartbeats or MCP tool calls yet — the endpoints do not exist
(M3/M5). Structure only, plus the one status command that proves loading works.

Keep clear in your head that `plugin/` is the **shipped** plugin for Laika's
users; the repo-root `.claude/` directory configures the three sessions building
Laika. They are unrelated, and changes to `.claude/` are PM's.

## Implementation notes for review (Builder-B)

Verified, not assumed — every criterion was checked by loading the plugin with
`claude --plugin-dir ./plugin`, not by reading the files back.

- `claude plugin validate plugin` → **passed, no warnings**.
- `/laika:status` runs end to end in both states. Unconfigured it explains what
  to set and exits 0; configured it reports URL, token shape, and the resolved
  MCP URL. A token containing a known marker was piped through both the script
  and a full Claude Code session and grepped for — it never appears in output.
- Plugin loads clean with `LAIKA_URL` and `LAIKA_TOKEN` unset: exit 0, no plugin
  or MCP error, `/laika:status` still registers.
- No token-shaped literal anywhere under `plugin/` (`grep -rnE 'lai_[A-Za-z0-9]{8,}'`).

### Two deviations PM should rule on

**1. The command is `/laika:status`, not `/laika-status`.** Claude Code namespaces
plugin commands as `/<plugin-name>:<file>`, so `commands/status.md` in a plugin
named `laika` can only be `/laika:status`. Getting the literal string
`/laika-status` would need the plugin renamed or a file named `laika-status.md`,
which yields the redundant `/laika:laika-status`. `/laika:status` is also exactly
what SPEC §5 specifies, so the criterion and the spec disagree and the spec was
followed. No action needed unless PM disagrees.

**2. `plugin/commands/README` has no `.md` extension.** The criterion asks for a
README in each of `hooks/`, `skills/`, `commands/`. In `commands/` that is a trap:
every `.md` there registers as a slash command, so `README.md` shipped a junk
`/laika:README` to every user, unconstrained by frontmatter. Confirmed by
invoking it — `${CLAUDE_PLUGIN_ROOT}` expanded, proving it went through the
command loader, not a file read. Dropping the extension keeps the README where
the criterion wants it and removes the junk command (`/laika:README` now returns
"Unknown command"). `hooks/README.md` and `skills/README.md` keep `.md` — both
verified inert.

### Discovered work

**LAI-013** (`area: docs`, `discovered-from: LAI-012`) — `docs/ROADMAP.md` puts
the heartbeat hooks in M4 but `POST /api/v1/heartbeats` in M5, so M4 ships hooks
with nothing to post to and no way to verify its own exit criterion. Not blocking:
this task ships an empty `hooks/hooks.json` and no heartbeat code, as instructed.

### Not built, deliberately

No hooks, no skills, no MCP tool calls — M3/M4/M5 per the task notes. `hooks.json`
exists but is empty so the manifest's `hooks` field resolves.
