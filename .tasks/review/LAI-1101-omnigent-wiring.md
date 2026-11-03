---
id: LAI-1101
title: 'laika tool add omnigent leaves Omnigent connected with its own credential, and a Laika notice can wake an Omnigent session (auto-pickup slice D)'
area: shell
assignee: shell/belka
priority: p1
depends-on: []
discovered-from: LAI-1039
started: 2026-11-03T14:20:32+05:30
status: review
finished: 2026-11-03T15:14:17+05:30
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
  `cli/src/agent.ts` (the hooks; `agent-hooks.ts` was not changed),
  `cli/src/agent-adapters.ts`,
  `cli/README.md` (Omnigent and Codex lines only).
- New: `cli/src/agent-mcp-bridge.ts`, `cli/src/agent-omnigent.ts` (daemon
  discovery, version gate, session wake — the module the launcher, slice B,
  calls; its signature is agreed in the PR description), `cli/docs/omnigent.md`.
- Added while building (named here so the reviewer sees them):
  `cli/src/agent-omnigent-marker.ts` (the marker, kept out of the wake
  module so the hook path loads only it), `cli/src/mcp-headers.ts` (the
  headers helpers and "does this harness's MCP follow Omnigent runs", out of
  `tool-add.ts` so the hook path need not load it — review B1), and the
  Omnigent section of `cli/agent-adapters/CAPABILITIES.md`, which said
  "does nothing else".
- Tests: `cli/test/agent-mcp-bridge.test.ts`, `tool-add-omnigent.test.ts`,
  `agent-hooks-omnigent.test.ts`, `agent-omnigent.test.ts`, and the existing
  tests of the files changed.

Belka is a live Omnigent host: nothing here restarts Belka's Omnigent or edits
`~/.omnigent` or an installed agent on Belka. Tests use a temp HOME, fakes and
loopback servers.

## Acceptance criteria

- [x] Spikes run first and reported in the log and PR: whether stopping
      `omni polly -p` stops the server-side turn, and whether the Laika hook
      path fires inside a polly run.
- [x] `laika tool add omnigent` copies a polly agent dir (never edits inside
      site-packages) to `~/.laika/omnigent/laika-polly/`, writes
      `tools/mcp/laika.yaml` as `transport: stdio` with an absolute `command`
      and `args`, refuses to write any `${`, backs up what it replaces, runs
      `omni agent add <dir>` only after confirmation, and prints that Omnigent
      must be restarted fully.
- [x] `laika agent mcp-bridge` relays newline-delimited JSON-RPC between stdio
      and the board's `/mcp`, carrying `Mcp-Session-Id` and reading JSON and
      SSE answers, with the token read once from the Omnigent tool's own
      credential file; no credential sends nothing to the board and answers
      every request with a JSON-RPC error.
- [x] `laika connect omnigent`'s sidecar contains no `${`.
- [x] `tool add codex` writes `http_headers_helper` and no longer exports the
      token from the shell rc.
- [x] `OMNIGENT=1` is detected from the nearest harness ancestor (the
      `omnigent-marker` rule), and an Omnigent session ends at Stop and reopens
      on its next turn (the `session-reopen` rule).
- [x] `cli/src/agent-omnigent.ts` finds the local Omnigent server from
      `~/.omnigent/daemons/*.json`, refuses anything but loopback, is gated to
      Omnigent 0.19.x, finds the target through `GET /v1/sessions`, and POSTs
      fixed words plus validated fields to `/v1/sessions/{id}/events` with
      `Content-Type: application/json` and no `Origin`, never retrying after a
      4xx or 5xx.
- [x] Each of these mutations turns a named assertion red, anchor confirmed:
      `${` written into the Omnigent yaml; a non-loopback wake URL; the version
      gate skipped; the bridge sending without a credential.
- [x] The CLI's tests, lint and format pass for the files touched; CI's Gate
      is green on the PR.

## Result

PR #252. On head `162dbe58`, every job of Gate — test, lint, format passed:
cli, lint/format, server 1–4 and web 1–4. Spikes, the verification and the
mutation runs are in the PR description and in
`logs/shell-2026-11-03-LAI-1101.md`.

## Review round 1 (2026-11-03), fixed as new commits

CHIEF's review of PR #252 failed on B1, and named fixes #1, #2, #3, #5/#6,
#8, #9, #10 and #12. All are fixed in the commits after `97834880`; the
tests and mutations for each are in `logs/shell-2026-11-03-LAI-1101.md`.

- **B1:** the hooks switch to `omnigent.json` only where that harness's MCP
  entry is the switching helper (b). `tool add omnigent` switches the entries
  an earlier `tool add` wrote, and names any other (a).

## Review round 2 (2026-11-03), fixed as new commits after `883ef747`

- **B2:** on an Omnigent device, polly's own turns (`OMNIGENT=1`,
  `CLAUDE_CODE_ENTRYPOINT=sdk-py`) use `omnigent.json` whatever any entry
  says, because their MCP is the bridge. Workers keep the B1 rule.
- **N1:** the identity is decided once and recorded in the session state.
- **N3:** `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are honoured.
- **N4:** the switching helper is matched by shape, and its text pinned.
- **N5:** a restart line for Codex, other keys kept, and `isToolEntry`
  limited to the exact revisions.
- **N2:** documented as a known limitation.

Details and tests are in `logs/shell-2026-11-03-LAI-1101.md`.
