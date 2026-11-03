---
id: LAI-1101
title: 'laika tool add omnigent leaves Omnigent connected with its own credential, and a Laika notice can wake an Omnigent session (auto-pickup slice D)'
area: shell
assignee: shell/belka
priority: p1
depends-on: []
discovered-from: LAI-1039
started: 2026-11-03T14:20:32+05:30
status: in-progress
finished:
---

## Why

Slice D of `.polly/plans/auto-pickup-capacity.md` (D-117a, D-126 — PR #251).
Fixes the plan's F4 (`tool add` half), F7 and F8.

On a fresh laptop, `laika tool add omnigent` does not leave Omnigent able to
reach the board as its own agent. The working wiring (LAI-589's
`polly-mcp-bridge`, `omnigent-marker`, `session-reopen`) exists only in
Belka's `~/.laika/agents/`. `laika connect omnigent` still writes
`${LAIKA_URL}` / `${LAIKA_TOKEN}`, the pattern behind the 15 Oct "policy
evaluation error" incident (an unset `${VAR}` in an Omnigent agent MCP yaml
denies every turn), and it uses the personal token. `tool add codex` reads its
token from `LAIKA_AGENT_TOKEN_CODEX`, which a launcher-started child never has
(D-117 item 6).

## Scope

SHELL: `cli/` only.

- Changed: `cli/src/tool-add.ts`, `cli/src/agents.ts`, `cli/src/connect.ts`,
  `cli/src/agent.ts`, `cli/src/agent-hooks.ts`, `cli/src/agent-adapters.ts`,
  `cli/README.md` (Omnigent and Codex lines only).
- New: `cli/src/agent-mcp-bridge.ts`, `cli/src/agent-omnigent.ts` (daemon
  discovery, version gate, session wake — the module the launcher, slice B,
  calls; its signature is agreed in the PR description), `cli/docs/omnigent.md`.
- Tests: `cli/test/agent-mcp-bridge.test.ts`, `tool-add-omnigent.test.ts`,
  `agent-hooks-omnigent.test.ts`, `agent-omnigent.test.ts`, and the existing
  tests of the files changed.

Belka is a live Omnigent host: nothing here restarts Belka's Omnigent or edits
`~/.omnigent` or an installed agent on Belka. Tests use a temp HOME, fakes and
loopback servers.

## Acceptance criteria

- [ ] Spikes run first and reported in the log and PR: whether stopping
      `omni polly -p` stops the server-side turn, and whether the Laika hook
      path fires inside a polly run.
- [ ] `laika tool add omnigent` copies a polly agent dir (never edits inside
      site-packages) to `~/.laika/omnigent/laika-polly/`, writes
      `tools/mcp/laika.yaml` as `transport: stdio` with an absolute `command`
      and `args`, refuses to write any `${`, backs up what it replaces, runs
      `omni agent add <dir>` only after confirmation, and prints that Omnigent
      must be restarted fully.
- [ ] `laika agent mcp-bridge` relays newline-delimited JSON-RPC between stdio
      and the board's `/mcp`, carrying `Mcp-Session-Id` and reading JSON and
      SSE answers, with the token read once from the Omnigent tool's own
      credential file; no credential sends nothing to the board and answers
      every request with a JSON-RPC error.
- [ ] `laika connect omnigent`'s sidecar contains no `${`.
- [ ] `tool add codex` writes `http_headers_helper` and no longer exports the
      token from the shell rc.
- [ ] `OMNIGENT=1` is detected from the nearest harness ancestor (the
      `omnigent-marker` rule), and an Omnigent session ends at Stop and reopens
      on its next turn (the `session-reopen` rule).
- [ ] `cli/src/agent-omnigent.ts` finds the local Omnigent server from
      `~/.omnigent/daemons/*.json`, refuses anything but loopback, is gated to
      Omnigent 0.19.x, finds the target through `GET /v1/sessions`, and POSTs
      fixed words plus validated fields to `/v1/sessions/{id}/events` with
      `Content-Type: application/json` and no `Origin`, never retrying after a
      4xx or 5xx.
- [ ] Each of these mutations turns a named assertion red, anchor confirmed:
      `${` written into the Omnigent yaml; a non-loopback wake URL; the version
      gate skipped; the bridge sending without a credential.
- [ ] The CLI's tests, lint and format pass for the files touched; CI's Gate
      is green on the PR.
