---
id: LAI-012
title: Claude Code plugin skeleton with manifest and .mcp.json
area: plugin
assignee: builder-b
priority: p3
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-24T01:42:42+05:30
---

## Goal

Stand up the shape of the shipped Laika plugin — manifest, folders, MCP server
declaration — so that when the `/mcp` endpoint exists in M3 the plugin is a
matter of filling in behaviour rather than inventing structure. Seeded early
because it has no dependencies and gives Builder-B parallel work during M1.

## Acceptance criteria

- [ ] `plugin/.claude-plugin/plugin.json` with name, version, description,
      author, and declared components; validates against the plugin manifest
      schema.
- [ ] `plugin/.mcp.json` declares the Laika MCP server over HTTP, reading the
      deployment URL and token from environment (`LAIKA_URL`, `LAIKA_TOKEN`) —
      **no secret is ever committed**, and a placeholder makes that obvious.
- [ ] `plugin/hooks/`, `plugin/skills/`, `plugin/commands/` exist with a README
      in each stating what will live there and which milestone fills it.
- [ ] One end-to-end vertical slice so the wiring is proven: a `/laika-status`
      command that reports configured URL and whether a token is present (it
      must **not** print the token).
- [ ] `plugin/README.md`: what the plugin is, how to install it locally, how to
      configure `LAIKA_URL` and `LAIKA_TOKEN`, and what is not built yet.
- [ ] The plugin loads in Claude Code without error when `LAIKA_URL` is unset —
      it degrades with a clear message rather than failing to load.

## Notes / context

Milestone: **M4**, seeded now. SPEC §7. **Builder-B owns this.**

Do not implement heartbeats or MCP tool calls yet — the endpoints do not exist
(M3/M5). Structure only, plus the one status command that proves loading works.

Keep clear in your head that `plugin/` is the **shipped** plugin for Laika's
users; the repo-root `.claude/` directory configures the three sessions building
Laika. They are unrelated, and changes to `.claude/` are PM's.
