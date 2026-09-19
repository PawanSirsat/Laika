---
id: LAI-610
title: docs/design prototype is stale against the design project
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-605
status: backlog
---

## Goal

`docs/design/Laika Prototype.dc.html` matches the design project again. The
repo copy (refreshed 2026-09-18, commit 5a90083) has since diverged from the
project "Skynet Kanban UI Enhancement"
(`a931b00e-ce58-4723-9699-b7cb2f1567e9`): the remote adds `--accink`/`--purink`
ink tokens, changes chip alphas and dark hue values, renames the top-bar
template list `members` → `barMembers`, and adds responsive rules and an
insights section. SHELL is implementing against the remote (LAI-605), so the
repo reference misleads until re-imported.

## Acceptance criteria

- [ ] `docs/design/Laika Prototype.dc.html` re-imported from the design
      project, byte-faithful.
- [ ] `docs/design/README.md` notes the import date and source project id.

## Notes / context

- D-020: `docs/design/` is the owner's imported reference — CHIEF measures,
  never edits values; the re-import is a mechanical replacement of the owner's
  own file at the owner's direction.
- The design MCP's `get_file` caps reads at 256 KiB and the current file is
  larger — whoever re-imports needs the owner to export/save the file, or a
  chunked route; SHELL's fetch hit the cap and reconstructed the tail (noted
  in LAI-605).
