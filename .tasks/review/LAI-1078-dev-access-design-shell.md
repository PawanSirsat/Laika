---
id: LAI-1078
title: 'Developer access design: visual kit, side panel, Tools tab, Advanced holds Activity, aliases'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from: LAI-1075
status: review
started: 2026-11-02T10:23:59+05:30
finished: 2026-11-02T10:48:43+05:30
---

## Why

Foundation slice of the owner's V3 design pass (plan
`~/.claude/plans/we-have-match-this-lovely-torvalds.md`, owner decisions
2026-11-02): the design's layout and shapes in Laika's own tokens, a Details
side panel for everything a one-line row has no room for, and the tabs
Overview · Project setup · Devices · Tools · Advanced.

## Acceptance criteria

- [x] `v3/design.css`: the design's primitives (card, hero, section title,
      flow row, stat row, record, note block, detail tiles, option tiles,
      rail card, wizard bands, orb, aside), tokens only, no new token. Every
      class is `dx-…`; rules that restyle Connect's shared `conn-*` parts are
      scoped under a `dx-` class. `connect-golden` stays green untouched.
- [x] Small React primitives for the repeated structures, so the later
      slices compose rather than re-draw: `SectionTitle`, `NoteBlock`,
      `DetailTiles`, `DesignChip`, `DxIcon`, `DesignWizard`.
- [x] `components/SidePanel.tsx`: right panel on a desktop, bottom sheet
      ≤ 900px, `role="dialog"`, focus in/trapped/restored, Escape, scrim, ×.
      Its browser tests come with its first use, in LAI-1080.
- [x] `WizardCard` takes an optional eyebrow suffix (`kind`); without it the
      markup is byte-identical (golden 9/9).
- [x] V3 tabs: Overview · Project setup · Devices · Advanced. Advanced shows
      Personal credentials, then Share local activity (`id="activity"`).
      The Tools tab moved to LAI-1080, so it arrives with a real list.
- [x] `developerAlias` in v3: `activity` → `advanced&section=activity`, which
      scrolls to the card and focuses its title. The tool aliases moved to
      LAI-1080 with the Tools tab. Classic and preview untouched.
- [x] Page description is the design's sentence.
- [x] Tests: alias table, tab labels, Advanced's two cards and the focus,
      390px per tab; `page-tabs`, `developer-access-v3`,
      `developer-advanced`, `advanced` updated.
- [x] SPEC §11.4.2 describes the V3 page (named edit).

## Notes

- SHELL, `server/web/` only, plus the named SPEC §11.4.2 edit.
- Never edit `connect/connect.css`, `components/wizard/*.css`,
  `styles/type.css`, `styles/theme.css` or the unscoped rules in
  `developer.css` (Connect's golden test).
- PR into `integration-dev-access-design`.
- Scope moved, owner's plan unchanged: the Tools tab, its aliases and the
  side panel's tests are LAI-1080's (a tab with nothing real in it would have
  shipped to the integration branch for nothing).
- Built on the owner's direct instruction (2026-11-02), by CHIEF on Belka.
