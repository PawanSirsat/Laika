---
id: LAI-249
title: 'The sidebar takes the prototype''s exact geometry: collapse, popover, footer'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-248]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase A1 of the owner-approved prototype rebuild (2026-09-18). LAI-248 gave the
sidebar the right *structure* (SPACES + ORG + SETTINGS); this task gives it the
prototype's exact *geometry and behaviour*, from
`docs/design/Laika Prototype.dc.html` (the sidebar renders at lines ~2198–2270):

- **212px expanded / 56px collapsed**, `transition: width .16s ease`; collapsed
  shows the two-letter keys and icons only.
- **Header**: 28px `--tx` circle logo (dot-and-rays), wordmark "Laika"
  14px/800/-.02em, org line 9px/600 JetBrains Mono `--tx3` from `GET /org` —
  never a fixture.
- **SPACES is collapsible** with a caret; the group head toggles it.
- **"More spaces" opens a popover** (not a route): all spaces as rows —
  colour-keyed square, name, mono meta — closing with "View all spaces" →
  `/projects`.
- **Footer**: 26px avatar, name 11px/700, role badge 8.5px/800 in `--pur`, and
  the theme toggle as the design's `☾ Switch to dark` / `☀ Switch to light`
  row.

## Acceptance criteria

- [ ] Sidebar widths measured in a browser test: 212px expanded, 56px
      collapsed, and the collapsed rail still shows every space key.
- [ ] The header logo toggles collapse; the org line renders the org's real
      name from `GET /org`.
- [ ] SPACES collapses and expands; the caret reflects state.
- [ ] The More-spaces popover lists **all** projects (not the recent three),
      opens from the row, closes on outside click and Escape, and its
      "View all spaces" goes to `/projects`.
- [ ] Footer shows the signed-in user's initials-avatar, name, role badge, and
      the theme toggle in the design's row form (closes LAI-242's complaint —
      note it for CHIEF's dedupe).
- [ ] `theme/initials.ts` is the single initials implementation (closes
      LAI-215 — note for dedupe); `use-spaces.ts` stays the sidebar's one
      `listProjects` consumer (LAI-226 — note for dedupe).
- [ ] Old `Sidebar.tsx` and `UserChrome.tsx` are deleted; replacements live in
      `src/components/sidebar/` with structure-map entries updated in the
      `WEB_*` maps only.
- [ ] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

New files: `src/components/sidebar/{Sidebar,SpacesSection,SpacesPopover,
SidebarFooter}.tsx` + `sidebar.css`. Style comes from the prototype; markup
never does (§5.1). No new dependencies.

Absorbed backlog ids, for CHIEF to close against this: **LAI-242, LAI-215,
LAI-226.** CHIEF's **LAI-247** (`--tx3` contrast guard) is adjacent, not
absorbed — check its state at claim time and leave it to its own task unless
CHIEF says otherwise.
