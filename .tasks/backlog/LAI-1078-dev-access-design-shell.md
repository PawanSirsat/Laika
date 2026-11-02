---
id: LAI-1078
title: 'Developer access design: visual kit, side panel, Tools tab, Advanced holds Activity, aliases'
area: shell
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1075
status: backlog
---

## Why

Foundation slice of the owner's V3 design pass (plan
`~/.claude/plans/we-have-match-this-lovely-torvalds.md`, owner decisions
2026-11-02): the design's layout and shapes in Laika's own tokens, a Details
side panel for everything a one-line row has no room for, and the tabs
Overview · Project setup · Devices · Tools · Advanced.

## Acceptance criteria

- [ ] `v3/design.css`: the design's primitives (card, hero, section title,
      flow row, stat row, record, note block, detail tiles, option tiles,
      rail card, wizard bands, orb, aside), every rule scoped under `.dx`,
      tokens only, no new token. `connect-golden` stays green untouched.
- [ ] Small React primitives for the repeated structures, so the later
      slices compose rather than re-draw.
- [ ] `components/SidePanel.tsx`: right panel on a desktop, bottom sheet
      ≤ 900px, `role="dialog"`, focus in/trapped/restored, Escape, scrim, ×.
- [ ] `WizardCard` takes an optional eyebrow suffix; without it the markup
      is byte-identical.
- [ ] V3 tabs: Overview · Project setup · Devices · Tools · Advanced. Tools
      is a placeholder that lists tools until LAI-1080 lands. Advanced shows
      Personal credentials, then Share local activity (`id="activity"`).
- [ ] `developerAlias` in v3: `activity` → advanced (activity card), `agents`
      → tools, `devices&agent=` → `tools&agent=`, `devices&add=tool…` →
      `tools&add=tool…`; old `connect` with wizard state → tools. Every
      in-app link updated; classic and preview untouched.
- [ ] Page description is the design's sentence.
- [ ] Tests: alias table, tab labels, side panel focus/Escape/scrim, both
      themes, 390px; `page-tabs`, `developer-access-v3`,
      `developer-advanced` updated.
- [ ] SPEC §11.4.2 describes the V3 page (named edit).

## Notes

- SHELL, `server/web/` only, plus the named SPEC §11.4.2 edit.
- Never edit `connect/connect.css`, `components/wizard/*.css`,
  `styles/type.css`, `styles/theme.css` or the unscoped rules in
  `developer.css` (Connect's golden test).
- PR into `integration-dev-access-design`.
