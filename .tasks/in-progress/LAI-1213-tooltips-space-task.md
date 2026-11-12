---
id: LAI-1213
title: 'Icons, tooltips and reasons across the space views and the task drawer/Workroom'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1193, LAI-1204, LAI-1205, LAI-1209]
status: in-progress
started: 2026-11-12T16:00:00Z
---

## Goal

The owner asked for icons and tooltips *"not only to this dialog but for other
pages"*. LAI-1209 did the dialogs; this does the same for the space views —
Board, List, Timeline, Calendar, Sprints, Dashboard, Activity, Meeting review
(screen bodies and the shared space header/toolbar) — the TaskDrawer / task
panel, and the Workroom page (`/task/:key`). It reuses LAI-1193's Tooltip,
LAI-1204's Button/IconButton/Icon registry and LAI-1209's shortcut formatter,
InfoHint, disabled-reason and Escape rules; it builds no new tooltip or icon
system.

Scope is `server/web/` only, UI only, existing API, no new dependency, no
`theme.css` change. Built on `ui-merge-train` (all open UI PRs merged in order)
and merges after #335. LAI-1214 (Home, shell, org, insights, developer, spaces)
runs in parallel: the sidebar and app header are its; the space
header/toolbar is this task's.

## Acceptance criteria

- [ ] Untruncated census of the area — icon-only buttons/links, bare `title=`,
      disabled controls with no reason, typed glyphs, unlabelled status
      markers — written to `.polly/specs/tooltips-census-space-task.md` with
      before and after counts.
- [ ] Every icon-only control in the area has an accessible name and the
      shared Tooltip, with its shortcut (LAI-1209's formatter) where one
      exists.
- [ ] Bare `title=` replaced by the Tooltip; any kept is documented with why.
- [ ] Disabled controls say why (Button disabled-with-reason, or a linked
      visible reason).
- [ ] Typed glyphs (✕ ⋯ ↑ ↓ ⚠ …) become Icon-registry icons; glyphs added to
      the registry as needed.
- [ ] Secondary explanations use InfoHint, never the only copy of critical
      information; small decorative leading icons where they aid scanning
      (drawer/Workroom section headers, sprint/due/estimate meta).
- [ ] LAI-1209's follow-up popovers that fall in this area (BoardInsights,
      BoardToolbar popovers, MembersPopover, ViewSettings, CardFilter,
      WhoDidThis, SprintsScreen, board-motion, CopyButton) and the blocker
      chip's bare `title=` are done.
- [ ] Guard test: icon-only buttons in the area's files have names; exemption
      list exact and explained.
- [ ] Playwright per screen family: icon-only controls named, tooltip on hover
      and focus, disabled reasons, CSP violations 0; each key behaviour
      mutated once and seen red.
- [ ] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards),
      server structure + task-file-state tests each exit 0; PR into
      `integration-ui-transformation` with CI green; screenshots dark/light at
      1440/390 in `.polly/screenshots/tooltips-space-task/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
assets, theme tokens only, no new dependency): `impeccable`,
`emil-design-eng`, `break-ui`.

Dispatched by polly; files from CHIEF's block (LAI-1213).
