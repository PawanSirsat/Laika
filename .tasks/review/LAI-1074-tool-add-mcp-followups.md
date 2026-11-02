---
id: LAI-1074
title: 'tool add / doctor MCP follow-ups: a kept entry decides the identity, doctor tells helper from literal, empty token, quit first, symlinked ~/.claude.json'
area: cli
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-1072
status: review
finished: 2026-11-02T03:03:54Z
started: 2026-11-02T02:55:32Z
---

The non-blocking items from the review of PR #225 (LAI-1070/1071/1072), batched.

1. **N1.** When `tool add` keeps an existing user-scope `mcpServers.laika` in
   `~/.claude.json` (for example one holding a literal personal token), its
   output must not say Claude Code — or `laika-claude` — now uses the tool's
   credential. It says the kept entry decides who Claude Code acts as,
   including under `laika-claude`, and shows how to switch to the
   tool-credential entry.
2. **N2.** `laika doctor` tells a `laika` MCP entry that reads the tool's
   credential (`headersHelper`) apart from one holding a literal token or an
   environment variable, and warns on the latter.
3. **N3.** The `headersHelper` fails cleanly on an empty token
   (`[ -n "$t" ] &&` before `printf`).
4. **N4.** Tell the person to quit Claude Code **before** `tool add`, which
   rewrites `~/.claude.json`; read the file back after writing and say so if
   the entry is gone; a symlinked `~/.claude.json` is written through to its
   target, never replaced by a file.

## Acceptance

- [x] N1: a CLI test with an existing literal-token `laika` entry: kept byte
      for byte, the output says the kept entry decides (also under
      `laika-claude`) and prints the switch, and never says this tool's
      credential is in use.
- [x] N2: doctor names the tool-credential entry, and warns on a literal
      token or a `${VAR}` header, without printing the token; tests.
- [x] N3: the helper prints nothing and exits non-zero with no token; test.
- [x] N4: quit-first wording before the write; a read-back after it; a
      symlinked `~/.claude.json` stays a symlink with the entry in its target;
      tests.
- [ ] cli typecheck, eslint, prettier exit 0; PR into `master`, CI green.

## Submitted (2026-11-02)

All four on branch `LAI-1074-tool-add-mcp-followups`, one PR. Beyond the
letter: an entry an **earlier** `tool add` wrote (PR #225's helper, without
N3's guard) is recognised as the tool's own and updated, not kept — otherwise
N3 would have sent everyone who already ran #225 down N1's "kept" path. The
web's Claude Code note (`server/web/.../tool-catalog.ts`) also says quit first
and that a kept entry decides; `tool-catalog.test.ts`'s pinned source line
follows the `mcpOn` → `mcp` rename. Shared reads moved to
`cli/src/claude-mcp.ts` (doctor cannot import `tool-add.ts`: `device.ts`
imports `doctor.ts`). CI box open until the PR's run is in.
