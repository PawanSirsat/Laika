---
id: LAI-1213
title: 'Icons, tooltips and reasons across the space views and the task drawer/Workroom'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1193, LAI-1204, LAI-1205, LAI-1209]
status: review
started: 2026-11-12T16:00:00Z
finished: 2026-11-12T23:30:00Z
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

- [x] Untruncated census of the area — icon-only buttons/links, bare `title=`,
      disabled controls with no reason, typed glyphs, unlabelled status
      markers — written to `.polly/specs/tooltips-census-space-task.md` with
      before and after counts.
- [x] Every icon-only control in the area has an accessible name and the
      shared Tooltip, with its shortcut (LAI-1209's formatter) where one
      exists.
- [x] Bare `title=` replaced by the Tooltip; any kept is documented with why.
- [x] Disabled controls say why (Button disabled-with-reason, or a linked
      visible reason).
- [x] Typed glyphs (✕ ⋯ ↑ ↓ ⚠ …) become Icon-registry icons; glyphs added to
      the registry as needed.
- [x] Secondary explanations use InfoHint, never the only copy of critical
      information; small decorative leading icons where they aid scanning
      (drawer/Workroom section headers, sprint/due/estimate meta).
- [x] LAI-1209's follow-up popovers that fall in this area (BoardInsights,
      BoardToolbar popovers, MembersPopover, ViewSettings, CardFilter,
      WhoDidThis, SprintsScreen, board-motion, CopyButton) and the blocker
      chip's bare `title=` are done.
- [x] Guard test: icon-only buttons in the area's files have names; exemption
      list exact and explained.
- [x] Playwright per screen family: icon-only controls named, tooltip on hover
      and focus, disabled reasons, CSP violations 0; each key behaviour
      mutated once and seen red.
- [x] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards),
      server structure + task-file-state tests each exit 0; PR into
      `integration-ui-transformation` with CI green; screenshots dark/light at
      1440/390 in `.polly/screenshots/tooltips-space-task/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
assets, theme tokens only, no new dependency): `impeccable`,
`emil-design-eng`, `break-ui`.

Dispatched by polly; files from CHIEF's block (LAI-1213).

## Delivered (SHELL, 2026-11-12)

**Primitives** (LAI-1193/1204/1209's, extended, not duplicated): Tooltip
`lazy` (nothing rendered or linked until hovered, focused or pressed) and
"empty words never show"; `DisabledReason` (the disabled-with-reason rule
for raw inline buttons, one stable Tooltip); arrow keycaps in `shortcut.ts`;
27 registry glyphs and the decorative `.section-mark`.

**Area**: every icon-only control named and tooltipped (shortcut keycaps:
*Close · Esc*, Focus `.`, rename *Save · ↵* / *Cancel · Esc*; `/` announced
on Search); bare `title=` 95 → 0 (Chip, Avatar, PersonLink, AgentChip,
DashLink, the agent panel's times included); typed glyphs 41 + 23 in
constants → 3 exempt keycaps/sentence arrows; input- and state-dependent
disabled controls explain why (focusable `aria-disabled` + tooltip, or the
visible line linked); Insights' throughput and cycle-time footnotes behind
InfoHints, the day count kept on screen; section marks on the drawer, the task rail's labels,
the Workroom and the sprint dates. Census:
`.polly/specs/tooltips-census-space-task.md`.

**Guard**: `test/components/space-icon-names.test.ts` walks the area's
directories (not a list): named, tooltipped, no bare `title=`, no typed
glyph, no silenced IconButton; exemptions (`drawer-handle`, `bt-catcher`,
two keycaps, one sentence arrow) each with its reason and each must still
match. LAI-1209's scanner moved to `test/helpers/jsx-buttons.ts`, shared.

**Browser**: `test/browser/space-tooltips.test.ts` — all eight space tabs,
the drawer and the Workroom: named + tooltip with words for every icon-ish
control, no bare `title`, CSP 0; hover-after-delay and focus; lazy markers;
Escape closes the tooltip before the drawer; held-back Link and locked View
settings field focusable with their reason, sending nothing; Insights'
info hints shown on focus and pinned by a click; screenshots
behind `LAIKA_SHOTS`. Tests that read a bare `title` now read the tooltip
(`tooltip-probe.ts`'s `tipText`): task-rail, task-size, board-sprint-stats,
sprint-strip, sprint-card-numbers, list-view, card-footer, cards-chips,
dashboard-contributors, review (sent-back marker), sprint-forecast,
task-feed, agent-field, timeline-sprints, organisation-work (bulk Status),
space-header, view-settings; task-feed, task-hero, task-panel, list-bulk and
copy-insecure follow the drawn icons.

**Mutations**, all red: guard M1–M5 (no Tooltip, unnamed, bare title, typed
⋯, stale exemption); browser B1 lazy never arms, B2 natively disabled Link,
B3 Escape not spent, B4 Close without its keycap, B5 lazy armed at once,
B6 an info hint that a click does not pin.

**Left for their owners** (listed for polly to file): Dropdown's native
trigger `title`; the profile's InfoTip typed `i`; `agent-states`'
`[data-exec-state]`/`[data-mcp-badge]` titles.
