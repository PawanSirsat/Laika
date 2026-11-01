---
id: LAI-1014
title: 'A Copilot slug in AGENT_CLIENTS, so a Copilot CLI or cloud agent is not labelled "Other"'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-557
status: backlog
---

## Goal

A registered agent's §4.63 `harness` must be an `AGENT_CLIENTS` slug or
`other` (`server/src/auth/agent-clients.ts`). The list has no Copilot entry,
so a GitHub Copilot CLI or Copilot cloud agent registers as `other`, and its
D-120 label reads *Other · Belka* / *Other · Cloud*.

LAI-557's `laika agent` adapters already report the **session** harness as
`copilot-cli`, `copilot-vscode` and `copilot-cloud` (a free slug, §4.65), and
tell the person to register the agent as `other` (CLI, cloud) or `vscode`
(Copilot in VS Code connects to MCP as `Visual Studio Code`, D-076).

## Scope

- Add a Copilot slug (CORE decides: one `copilot`, or one per surface) to
  `AGENT_CLIENTS`, with the normaliser match for the MCP `clientInfo.name`
  Copilot CLI sends (not measured: Copilot CLI is not installed on Belka).
- The web client mirrors the list (drift check): SHELL's half.
- Then `cli/src/agent-adapters.ts` sets `agentHarness` for `copilot-cli` and
  `copilot-cloud` to it.

## Acceptance criteria

- [ ] A Copilot agent can be registered under a Copilot harness and its label
      reads `Copilot · <device>`.
- [ ] The `clientInfo.name` match is from a measured capture, or the row says
      it is matched on the product name (as Kiro, Goose and Amp are).
- [ ] Repo-root gate exits 0.

## Role / machine

CORE + SHELL (§4.4, two owners). Filed by SHELL from LAI-557 on Belka.
