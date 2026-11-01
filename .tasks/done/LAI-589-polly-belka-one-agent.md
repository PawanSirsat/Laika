---
id: LAI-589
title: Polly · Belka — the manager and its workers act as one agent
area: docs
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-585
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-29T06:31:59Z
started: 2026-10-28T20:55:09Z
---

## Goal

On Belka, polly (the Omnigent manager) and every worker it starts reach the
board as one registered agent, **Polly · Belka**. Claude Code and Codex opened
by hand stay **Claude Code · Belka** and **Codex · Belka**. This follows the
contract in `docs/proposals/LAI-532-agent-identity-model.md` (PR #121): one
agent per harness per device. The owner approved it on 2026-10-29.

This is local configuration on Belka plus board edits. **No repo code
changes.** The task file exists because §2 allows no work without one; the
work itself lands outside the repo, in `~/.laika/agents/`. Board card:
LAIKA-840.

## Acceptance criteria

- [x] Report which marker tells Omnigent-launched sessions apart from
      hand-started ones before anything relies on it. Check four cases:
      Claude Code sub-agent, Codex sub-agent (private `CODEX_HOME`), the polly
      primary, and a hand-started Terminal session. Use the same marker as
      `plugin/scripts/laika-activity-hook`.
- [x] Register 'Polly · Belka' (harness Omnigent (polly), device Belka) with
      full access to project `laika` only. If no browser is free, write the
      exact clicks for Pawan instead.
- [x] `~/.laika/agents/mcp-headers.sh` sends Polly · Belka's token when the
      marker is set, and the harness's own token otherwise. It fails closed: if
      Polly's credential is missing, it sends no header, and never sends the
      personal token or another agent's.
- [x] `laika_whoami` checked in both directions, for Claude Code and for Codex.
- [x] Write the exact safe sequence for polly's own Laika connection, with its
      rollback. Omnigent's agent folders are not edited.
- [x] Polly · Belka is the selected agent on LAIKA-785 and on its open
      children not tagged `host-strelka`.
- [x] Put the rollback commands on the card.

## Notes / context

- Marker: `OMNIGENT=1`. Measured on 2026-10-29 from process environments
  (names only; no values that could be secrets were printed).
- Never print, log or put a token on a command line. Use 0600 files or stdin.
  Back up every changed file as `<file>.bak-2026-10-29b`, mode 0600.
- Omnigent's agent YAMLs are not touched. An unresolved `${VAR}` there blocks
  every polly message (15 Oct incident, `~/.laika/omnigent-laika.yaml.disabled`).

## Evidence (2026-10-29)

- **Marker:** `OMNIGENT=1`, as in `plugin/scripts/laika-activity-hook`. Present on
  Omnigent Claude Code and Codex sub-agents and on the polly primary; absent from a
  hand-started Terminal session. Codex strips it from `http_headers_helper`'s
  environment, so `~/.laika/agents/omnigent-marker` reads it from the nearest
  harness process.
- **Polly · Belka:** agent `01M635B62FE71AN9FXEZEJW9ND` (harness `omnigent`,
  device Belka, `laika` full). polly registered it through runbook §A, and also
  rotated Claude Code · Belka (§B): the old token answers 401, the new one 200.
- **whoami** (fresh `claude -p` / `codex exec`, read from the tool result):

  | session | agent |
  | --- | --- |
  | Claude Code, `OMNIGENT=1` | Polly · Belka `01M635B62FE71AN9FXEZEJW9ND` |
  | Codex, `OMNIGENT=1` | Polly · Belka `01M635B62FE71AN9FXEZEJW9ND` |
  | Claude Code, direct | Claude Code · Belka `01M61ZHHD074WDQKMRRCG6G7JW` |
  | Codex, direct | Codex · Belka `01M61ZPA9F4D6BG8P2KWDK4ENB` |
  | polly's stdio bridge | Polly · Belka `01M635B62FE71AN9FXEZEJW9ND` |

  Before Polly existed, both `OMNIGENT=1` runs got no board connection (401),
  never another agent's token.
- **Selected agent:** Polly · Belka is set on LAIKA-785 and 21 of its 22 open
  children that are not tagged `host-strelka` (PATCH `selected_agent_id` only;
  each read back with the assignee unchanged; a `[belka]` comment on each).
  **LAIKA-840 itself was refused** with 409 *"claim lapsed and is waiting for
  recovery"*: the expired claim is Claude Code · Belka's, and the server lets
  only that agent reclaim it. 15 `host-strelka` children were skipped. No target
  card had a live agent-session claim; LAIKA-785's only claim is Pawan's own
  person claim.
- **Dependencies:** LAIKA-841 and LAIKA-842 are now blocked by LAIKA-843
  instead of LAIKA-840.
- **polly's own connection:** a stdio bridge is recommended over
  `launchctl setenv` (runbook §D). Omnigent's folders were not edited.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #125.
