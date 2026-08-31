---
id: LAI-419
title: The plugin's .mcp.json points at a deployment, and loads without one
area: plugin
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

`plugin/.mcp.json` must connect a Claude Code session to a Laika deployment's
`/mcp` (LAI-406, done) using the user's personal access token (LAI-402, done).

The hard requirement is the second half of the title: **the plugin must load
cleanly when unconfigured** and degrade with a clear message (SPEC §8). Someone
installs it before they have a board; that must be a mild inconvenience, not a
broken Claude Code.

## Acceptance criteria

- [ ] `.mcp.json` points at `${LAIKA_URL}/mcp` with
      `Authorization: Bearer ${LAIKA_TOKEN}`, both from the environment.
- [ ] **Committed files carry obvious placeholders** and no real URL or token.
      A test asserts no `lai_`-prefixed string appears anywhere in `plugin/`.
- [ ] **Unconfigured, the plugin loads and says why it is idle** — once, clearly,
      naming the two variables and how to set them. Not a stack trace, not a
      connection error on every tool call, and not silence so complete the user
      cannot tell it is installed.
- [ ] **Configured against a real Laika, the eight §7.1 tools appear** and one
      read tool returns real data. Verified against a running instance, not
      inferred from the file.
- [ ] A wrong or revoked token surfaces as *"your token was refused"*, not as
      *"the server is unreachable"* — LAI-224's lesson, in the plugin.
- [ ] Full gate green.

## Notes

No new dependencies.

`server/src/mcp/` and `/mcp` are CORE's; this task touches **only `plugin/`**.
If the endpoint needs to behave differently for a plugin client, that is a task
with `area: server`, not an edit here.
