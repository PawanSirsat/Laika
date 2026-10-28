---
id: LAI-589
title: Polly · Belka — the manager and its workers act as one agent
area: docs
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-585
status: in-progress
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

- [ ] Report which marker tells Omnigent-launched sessions apart from
      hand-started ones before anything relies on it. Check four cases:
      Claude Code sub-agent, Codex sub-agent (private `CODEX_HOME`), the polly
      primary, and a hand-started Terminal session. Use the same marker as
      `plugin/scripts/laika-activity-hook`.
- [ ] Register 'Polly · Belka' (harness Omnigent (polly), device Belka) with
      full access to project `laika` only. If no browser is free, write the
      exact clicks for Pawan instead.
- [ ] `~/.laika/agents/mcp-headers.sh` sends Polly · Belka's token when the
      marker is set, and the harness's own token otherwise. It fails closed: if
      Polly's credential is missing, it sends no header, and never sends the
      personal token or another agent's.
- [ ] `laika_whoami` checked in both directions, for Claude Code and for Codex.
- [ ] Write the exact safe sequence for polly's own Laika connection, with its
      rollback. Omnigent's agent folders are not edited.
- [ ] Polly · Belka is the selected agent on LAIKA-785 and on its open
      children not tagged `host-strelka`.
- [ ] Put the rollback commands on the card.

## Notes / context

- Marker: `OMNIGENT=1`. Measured on 2026-10-29 from process environments
  (names only; no values that could be secrets were printed).
- Never print, log or put a token on a command line. Use 0600 files or stdin.
  Back up every changed file as `<file>.bak-2026-10-29b`, mode 0600.
- Omnigent's agent YAMLs are not touched. An unresolved `${VAR}` there blocks
  every polly message (15 Oct incident, `~/.laika/omnigent-laika.yaml.disabled`).
