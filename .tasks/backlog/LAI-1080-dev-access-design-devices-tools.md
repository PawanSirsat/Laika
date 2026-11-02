---
id: LAI-1080
title: 'Developer access design: one-line Devices and Tools lists, with Device and Tool details panels'
area: shell
assignee: unclaimed
priority: p2
depends-on: [LAI-1078]
discovered-from: LAI-1075
status: backlog
---

## Why

The owner's V3 design shows one line per device and per tool; today every
tool expands inline with its helper status, What's new, credential and the
full checkpoints panel. Owner decision 2026-11-02: the extras move into a
Details side panel addressed by the URL.

## Acceptance criteria

- [ ] Devices: section title, "+ Add device", one record per device (icon,
      name, kind · tools · last seen, chip, "Add tool →", "Details"); conflicts
      and the board-update note as note blocks; "Show revoked" kept.
- [ ] Device Details (`?tab=devices&device=<id>`): kind, origin, last seen,
      fingerprint, helper-updates summary, cloud note, imported confirm, its
      tools (each opens Tool Details), conflicts with Rename, Disconnect.
- [ ] Tools: section title, "+ Add tool", one record per active tool (mark,
      "Tool · Device", projects · last seen, readiness chip, Update available
      chip, "Set up project →" or "Finish setup →", "Details").
- [ ] Tool Details (`?tab=tools&agent=<id>`): status and check lines, helper
      (version, How to update, What's new), projects + change access,
      credential + Reconnect, Save checkpoints automatically, Rename for
      conflicts, Disconnect. No extra request per open.
- [ ] The **Tools** tab joins `DEVELOPER_V3_TABS` after Devices (moved here
      from LAI-1078, so it arrives with a real list): Overview · Project setup ·
      Devices · Tools · Advanced. It hosts the Add tool wizard. `developerAlias`
      in v3: `agents` → tools, `devices&agent=` → `tools&agent=`,
      `devices&add=tool…` → `tools&add=tool…` (with `reconnect=`, `exchange=`),
      old `connect` with wizard state → tools; every in-app link to a tool row
      or Add tool (Overview, Advanced's *Upgrade connection*, Project setup)
      follows.
- [ ] Back, Escape and the scrim close a panel; focus returns to the row.
      `SidePanel` (LAI-1078's `components/SidePanel.tsx`) gets its browser
      tests here, with its first use: focus in, Tab trapped, Escape, scrim,
      ×, focus back, bottom sheet at 390px, both themes.
- [ ] *Ready* only from `readiness()` evidence.
- [ ] Tests: `developer-devices-v3`, `developer-update-status` moved to the
      panels; new panel tests; both themes; 390px.

## Notes

- SHELL, `server/web/` only. PR into `integration-dev-access-design`.
