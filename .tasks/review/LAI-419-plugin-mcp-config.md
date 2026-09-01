---
id: LAI-419
title: The plugin's .mcp.json points at a deployment, and loads without one
area: plugin
assignee: shell
priority: p2
depends-on: []
discovered-from:
started: 2026-09-01T22:25:00+05:30
finished: 2026-09-01T23:05:00+05:30
status: review
---

## Goal

`plugin/.mcp.json` must connect a Claude Code session to a Laika deployment's
`/mcp` (LAI-406, done) using the user's personal access token (LAI-402, done).

The hard requirement is the second half of the title: **the plugin must load
cleanly when unconfigured** and degrade with a clear message (SPEC §8). Someone
installs it before they have a board; that must be a mild inconvenience, not a
broken Claude Code.

## Acceptance criteria

- [x] `.mcp.json` points at `${LAIKA_URL}/mcp` with
      `Authorization: Bearer ${LAIKA_TOKEN}`, both from the environment.
      **This already exists and looks right** — LAI-012 wrote it. Verify it
      against a running board rather than rewriting it, and if it is correct say
      so and tick it. Rewriting a correct file to feel like the criterion was met
      is how a review loses the ability to tell the two apart.
- [x] **Committed files carry obvious placeholders** and no real URL or token.
      A test asserts no `lai_`-prefixed string appears anywhere in `plugin/`.
- [x] **Unconfigured, the plugin loads and says why it is idle** — once, clearly,
      naming the two variables and how to set them. Not a stack trace, not a
      connection error on every tool call, and not silence so complete the user
      cannot tell it is installed.

      **If Claude Code offers no hook for saying it once**, say so and file it
      rather than approximating — a message on every tool call is the failure
      this criterion names, and choosing it because it was the only lever
      available makes the plugin worse, not compliant. Silence plus a clear
      `README` is the honest fallback and it is acceptable; a nagging plugin is
      not.
- [x] **Configured against a real Laika, all ten §7.1 tools appear** and one
      read tool returns real data. Verified against a running instance, not
      inferred from the file. **Ten, not eight** — this criterion said eight
      until 2026-09-01, which was the same stale count the ROADMAP already
      corrected once; `server/src/mcp/` registers ten and §7.1 lists ten.
      **Assert the count and the names**, so the next drift is loud.
- [x] A wrong or revoked token surfaces as *"your token was refused"*, not as
      *"the server is unreachable"* — LAI-224's lesson, in the plugin.
- [x] Full gate green.

## Notes

No new dependencies.

`server/src/mcp/` and `/mcp` are CORE's; this task touches **only `plugin/`**.
If the endpoint needs to behave differently for a plugin client, that is a task
with `area: server`, not an edit here.


---

## Submitted — SHELL, 2026-09-01

Root gate `EXIT 0` — 1836 server, 644 web, **56** cli. Five mutations, all red.

### AC1: verified, not rewritten

`.mcp.json` is correct as LAI-012 wrote it and **I have not touched a character
of it.** Verified against a running board on `:3371` rather than by reading:
`initialize` returned `serverInfo: laika 0.1.0`, `tools/list` returned eleven
tools, and `list_ready_tasks` returned the task I had just created.

### AC4: it is **eleven**, not ten — and this is the third wrong count

The criterion corrects *eight* to *ten*. Measured against both sources today,
**both numbers are wrong**:

| source | tools |
| --- | --- |
| §7.1's table, first column only | **11** |
| `server/src/mcp/` `registerTool` calls | **11** |
| live `tools/list` over `/mcp` | **11** |

`add_comment` · `create_task` · `finish_task` · `get_project_context` ·
`get_task_context` · `laika_whoami` · `list_projects` · `list_ready_tasks` ·
`log_unlisted_work` · `start_working` · `update_status`

**`CLAUDE.md` §2 also has it wrong** — it records *"ten listed and eleven
served"* as one of the examples of this exact failure. Not mine to edit; flagged
for CHIEF.

So the test **asserts the names from both sides and requires them to match**,
rather than a number. A count in prose drifts silently; a name that disappears
fails. It also asserts both readers parsed something, because two empty lists
compare equal.

**Parsing §7.1 needs the first column only.** A plain grep for backticked
identifiers returns 22 — the later columns name fields like `blocked_by` and
`context_md`. That is how a count gets this wrong, and it is written into the
parser.

### AC3: silence, measured, and chosen rather than settled for

A real session with neither variable set: **exit 0, and nothing printed at all**
— no warning, no connection error, no mention of the MCP server, even under
`--debug`.

**The escape hatch applies and I am taking it explicitly.** The only lever for an
unprompted message is a `SessionStart` hook, which fires in **every repository
you open** — the defect LAI-418's own criteria name for the heartbeat, decided in
this repo once already, in this direction. A nagging plugin is worse than a quiet
one.

So the message is **pulled**: `/laika:status` names both variables and how to set
them, and never prints the token. `plugin/README.md` now says this is deliberate
and why, rather than leaving silence to look like an oversight.

### Found while here: the README claimed shipped work was unbuilt

Its *"What is not built yet"* table listed **MCP tools**, **heartbeat hooks** and
**`npx laika init`** as waiting — all three have shipped. A document contradicting
AC4 on the page where somebody goes to check. Replaced with what is built, and
LAI-420/LAI-421 named for what is not.
