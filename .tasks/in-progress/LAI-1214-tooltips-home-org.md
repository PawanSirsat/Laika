---
id: LAI-1214
title: 'Icons, tooltips and reasons across home, the shell and org pages'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1193, LAI-1204, LAI-1205, LAI-1209]
status: in-progress
started: 2026-11-12T16:00:00Z
---

## Goal

The owner asked for icons and tooltips *"not only to this dialog but for other
pages"*. LAI-1209 did the dialogs; this carries the same pattern — shared
Tooltip, IconButton, InfoHint, disabled-with-reason, Icon registry — across My
day (Timeline, TimerControl, MyDayDrawer), Inbox (Review, Unlisted), Work, the
app shell (Sidebar, SidebarFooter/person menu, ShellHeader, phone bar, ⌘K
trigger), Insights (Capacity, Usage, Time), Developer access (every tab), the
Spaces directory (`/projects`), and the auth screens and 404.

Scope is `server/web/` only, UI only, existing API, no new dependency, no
`theme.css` change. Built on the UI merge train (`origin/ui-merge-train`
@31a94fad, the 26 open UI PRs in order); merges after #335 (LAI-1209).
Dispatched by polly on `integration-ui-transformation`.

**Not in scope**: Organisation and Space settings (other agents rework them),
space views, the task drawer and the Workroom (LAI-1213 owns the space
header/toolbar), and the person menu's *Appearance…* entry and theme switching
(LAI-1212).

## Acceptance criteria

- [ ] Untruncated census of the area — icon-only buttons/links, bare `title=`,
      disabled controls without a reason, typed glyph characters, unlabelled
      status markers — written to `.polly/specs/tooltips-census-home-org.md`
      with before/after counts.
- [ ] Every icon-only control in the area has an accessible name and the shared
      Tooltip, with its shortcut through LAI-1209's formatter where one exists
      (My day's keys, the sidebar collapse, ⌘K).
- [ ] Bare `title=` replaced by the Tooltip in the area; any that must stay are
      listed with why.
- [ ] Disabled controls say why (disabled-with-reason); typed glyphs drawn as
      Icon-registry icons; secondary explanations behind InfoHint, never the
      only copy of critical information; small decorative leading icons only
      where they aid scanning.
- [ ] LAI-1209's follow-ups in the area: SpacesPopover, SidePanel, MyDayDrawer,
      CopyButton.
- [ ] Guard test: icon-only buttons in the area's files are named; exact,
      explained exemptions.
- [ ] Playwright per screen family: names and tooltips on hover and focus,
      disabled reasons, My day shortcut hints, CSP violations 0; each key
      behaviour mutated once and seen red.
- [ ] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards),
      server structure + task-file-state tests each exit 0; PR into
      `integration-ui-transformation` with CI green; screenshots dark/light at
      1440/390 in `.polly/screenshots/tooltips-home-org/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
assets, theme tokens only, no new dependency): `impeccable`,
`emil-design-eng`, `break-ui`.
