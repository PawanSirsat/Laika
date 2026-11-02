---
id: LAI-1074
title: 'tool add / doctor MCP follow-ups: a kept entry decides the identity, doctor tells helper from literal, empty token, quit first, symlinked ~/.claude.json'
area: cli
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1072
status: backlog
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

- [ ] N1: a CLI test with an existing literal-token `laika` entry: kept byte
      for byte, the output says the kept entry decides (also under
      `laika-claude`) and prints the switch, and never says this tool's
      credential is in use.
- [ ] N2: doctor names the tool-credential entry, and warns on a literal
      token or a `${VAR}` header, without printing the token; tests.
- [ ] N3: the helper prints nothing and exits non-zero with no token; test.
- [ ] N4: quit-first wording before the write; a read-back after it; a
      symlinked `~/.claude.json` stays a symlink with the entry in its target;
      tests.
- [ ] cli typecheck, eslint, prettier exit 0; PR into `master`, CI green.
