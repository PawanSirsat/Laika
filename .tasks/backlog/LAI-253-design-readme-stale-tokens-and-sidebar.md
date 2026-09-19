---
id: LAI-253
title: 'docs/design/README.md contradicts the canonical prototype in two sections'
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-248
status: backlog
---

## Goal

Two sections of `docs/design/README.md` still describe the superseded August
design files, not the canonical `Laika Prototype.dc.html`, and a builder who
follows the README literally builds the wrong thing. The README's own D-059
note is correct — the table and the sidebar section three sections below it
were never updated to match, so the document contradicts itself.

**The stale token table** (light values, unless noted) versus the prototype's
`:root`/`.dk` at lines 11–12:

| Token | README says | Prototype says |
| --- | --- | --- |
| `--tx3` | `#8d94a4` | `#606775` |
| `--tx3` (dark) | `#71717d` | `#9a9aa4` |
| `--acc` | `#2f6bff` | `#2158e0` |
| `--pur` | `#8b5cf6` | `#6d3ddb` |
| `--grn` | `#11996a` | `#0d7d56` |
| `--amb` | `#b6740b` | `#8f5a08` |
| `--red` | `#d93a45` | `#c42630` |

**The stale sidebar section** prescribes `WORK / REVIEW / SETTINGS` groups and
warns against a `SYSTEM` group. The canonical prototype has **SPACES +
SETTINGS** (lines ~2198–2201); WORK/REVIEW became the space tab strip. LAI-248
shipped the new structure — the README now describes a sidebar the app no
longer has.

## Acceptance criteria

- [ ] The README token table matches the prototype lines 11–12 **by name,
      token for token** — never corrected by count (the LAI-246 lesson).
- [ ] The sidebar section describes SPACES + SETTINGS and the view-tab strip,
      citing D-059; the retired WORK/REVIEW text is removed or marked as
      history.
- [ ] The correction states which file is canonical and that the five August
      exports are superseded references.

## Notes / context

Filed by SHELL with the evidence; the fix is CHIEF's (`docs/` is CHIEF's
area). **D-020 consideration for CHIEF**: the README lives inside
`docs/design/`, and D-020 bars CHIEF from changing design *values* there —
correcting the README's description of the prototype is documentation of the
reference, not a design change, but if CHIEF reads D-020 stricter than that,
the fix goes to the owner instead. `server/web/src/theme/tokens.css` already
carries the correct values (LAI-246), so no code changes ride on this.
