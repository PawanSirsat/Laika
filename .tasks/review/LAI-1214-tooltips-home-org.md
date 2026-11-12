---
id: LAI-1214
title: 'Icons, tooltips and reasons across home, the shell and org pages'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1193, LAI-1204, LAI-1205, LAI-1209]
status: review
started: 2026-11-12T16:00:00Z
finished: 2026-11-12T19:30:00Z
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

- [x] Untruncated census of the area — icon-only buttons/links, bare `title=`,
      disabled controls without a reason, typed glyph characters, unlabelled
      status markers — written to `.polly/specs/tooltips-census-home-org.md`
      with before/after counts.
- [x] Every icon-only control in the area has an accessible name and the shared
      Tooltip, with its shortcut through LAI-1209's formatter where one exists
      (My day's keys, the sidebar collapse, ⌘K).
- [x] Bare `title=` replaced by the Tooltip in the area; any that must stay are
      listed with why.
- [x] Disabled controls say why (disabled-with-reason); typed glyphs drawn as
      Icon-registry icons; secondary explanations behind InfoHint, never the
      only copy of critical information; small decorative leading icons only
      where they aid scanning.
- [x] LAI-1209's follow-ups in the area: SpacesPopover, SidePanel, MyDayDrawer,
      CopyButton.
- [x] Guard test: icon-only buttons in the area's files are named; exact,
      explained exemptions.
- [x] Playwright per screen family: names and tooltips on hover and focus,
      disabled reasons, My day shortcut hints, CSP violations 0; each key
      behaviour mutated once and seen red.
- [x] Gate: `pnpm lint`, `pnpm format`, web typecheck, web tests (4 shards),
      server structure + task-file-state tests each exit 0; PR into
      `integration-ui-transformation` with CI green; screenshots dark/light at
      1440/390 in `.polly/screenshots/tooltips-home-org/`.

## Notes

Design skills consulted (advice only; repo rules win — strict CSP, no remote
assets, theme tokens only, no new dependency): `impeccable`,
`emil-design-eng`, `break-ui`.

## Delivered (SHELL, 2026-11-12)

Census, method, counts and every exemption with its reason:
`.polly/specs/tooltips-census-home-org.md` (outside the repo, beside the
census tool it ran). Before → after on the area's 141 files: icon-only
controls with no shared Tooltip 39 → 2 (both exempt: the Timeline's drag
handles); bare `title=` 110 → 0; typed `‹ › → × ✕ ▾` on controls → 0 (guard,
multi-line).

**Shared pieces, extended not duplicated**: Tooltip `content=''` says nothing
(a worded button whose tooltip is only its reason while off); focus within
`ARRIVAL_MS` (300) of mount shows no tooltip — a surface's first focus, found
when SidePanel's Close took focus as it opened and the first Escape was spent
on a tooltip nobody asked for (LAI-1209's Add column dialog had the same);
`shortcut.ts` draws arrow keys; Icon registry `minus`, `help`, `arrow-right`,
`arrow-left`, `pin`, `chevron-down`; HeaderPopover `tooltip` + `shortcut`;
CopyButton reason as aria-disabled + Tooltip; SidePanel close tooltipped;
StepRail's locked steps (Connect, v3 wizards) the same, tick drawn.

**My day** — My day's keys as keycaps: Add time `N`, timer `T`, shortcuts `?`,
General `G`, review `J`/`K`, Timeline `←`/`→`, closes `Esc`. Off with a
reason: Confirm day, Next day/week, zoom limits, block steps, mobile Now,
future days, bulk Confirm. Canvas items with the Timeline's hover card lost
their duplicate `title=`.

**Shell** — rail toggle (shared Tooltip in place of its CSS reveal), pin,
create space, Spaces popover close, phone menu, ⌘K header trigger (key in the
words — `aria-keyshortcuts` on every page breaks LAI-473).

**Inbox / Work / Insights / Developer / Spaces / auth** — see the census.

**Tests**: `test/components/page-icon-names.test.ts` (guard, 424 cases:
names, Tooltip, no bare `title=`, no typed glyph, exact exemptions that must
still exist); `test/browser/page-tooltips.test.ts` (11: hover after the delay
and focus, keys, reasons focusable, both themes, 390/1440, CSP 0, Capacity);
`test/browser/tooltip-text.ts` helper; 26 existing browser files re-aimed from
`title=` to the tooltip or from typed glyphs to icons. 13 mutations, all red.

**Follow-ups, not filed** (CHIEF's numbering is polly's): the remaining
condition-based disables listed in the census; `profile/InfoTip` vs
`InfoHint`; `developer/v3/DxIcon` into the registry; the rail's collapsed link
names (needs a `side="right"` Tooltip); no key collapses the rail; `EmptyState`
action labels cannot carry an icon.
