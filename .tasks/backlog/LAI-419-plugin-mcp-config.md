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
      **This already exists and looks right** — LAI-012 wrote it. Verify it
      against a running board rather than rewriting it, and if it is correct say
      so and tick it. Rewriting a correct file to feel like the criterion was met
      is how a review loses the ability to tell the two apart.
- [ ] **Committed files carry obvious placeholders** and no real URL or token.
      A test asserts no `lai_`-prefixed string appears anywhere in `plugin/`.
- [ ] **Unconfigured, the plugin loads and says why it is idle** — once, clearly,
      naming the two variables and how to set them. Not a stack trace, not a
      connection error on every tool call, and not silence so complete the user
      cannot tell it is installed.

      **If Claude Code offers no hook for saying it once**, say so and file it
      rather than approximating — a message on every tool call is the failure
      this criterion names, and choosing it because it was the only lever
      available makes the plugin worse, not compliant. Silence plus a clear
      `README` is the honest fallback and it is acceptable; a nagging plugin is
      not.
- [ ] **Configured against a real Laika, all ten §7.1 tools appear** and one
      read tool returns real data. Verified against a running instance, not
      inferred from the file. **Ten, not eight** — this criterion said eight
      until 2026-09-01, which was the same stale count the ROADMAP already
      corrected once; `server/src/mcp/` registers ten and §7.1 lists ten.
      **Assert the count and the names**, so the next drift is loud.
- [ ] A wrong or revoked token surfaces as *"your token was refused"*, not as
      *"the server is unreachable"* — LAI-224's lesson, in the plugin.
- [ ] Full gate green.

## Notes

No new dependencies.

`server/src/mcp/` and `/mcp` are CORE's; this task touches **only `plugin/`**.
If the endpoint needs to behave differently for a plugin client, that is a task
with `area: server`, not an edit here.
