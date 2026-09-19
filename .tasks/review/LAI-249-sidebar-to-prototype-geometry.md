---
id: LAI-249
title: 'The sidebar takes the prototype''s exact geometry: collapse, popover, footer'
area: web
assignee: shell
priority: p1
depends-on: [LAI-248]
discovered-from: LAI-248
started: 2026-09-18T11:58:43+05:30
finished: 2026-09-18T12:23:22+05:30
status: review
---

> **Claim deviation, flagged (§2).** `depends-on` names LAI-248, which sits in
> `.tasks/review/` — accepted by nobody yet. Claimed anyway on the owner's
> direction: the approved rebuild plan (2026-09-18) sequences this task
> directly after finishing LAI-248, both SHELL's, same branch. The LAI-238
> precedent, with the owner's plan in place of CHIEF's accept note. If CHIEF
> sends LAI-248 back, this task absorbs the rework.

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

- [x] Sidebar widths measured in a browser test: 212px expanded, 56px
      collapsed, and the collapsed rail still shows every space key.
- [x] The header logo toggles collapse; the org line renders the org's real
      name from `GET /org`.
- [x] SPACES collapses and expands; the caret reflects state.
- [x] The More-spaces popover lists the spaces **not already pinned above**
      (the prototype's `popSpaces`, line 2263 — this criterion originally said
      "all projects", corrected against the artefact, §2), opens from the row,
      closes on outside click and Escape, and its "View all spaces" goes to
      `/projects`.
- [x] Footer shows the signed-in user's initials-avatar, name, role badge, and
      the theme toggle in the design's row form (closes LAI-242's complaint —
      note it for CHIEF's dedupe).
- [x] `theme/initials.ts` is the single initials implementation, with a guard
      that fails on a new private copy (closes LAI-215 — note for dedupe).
      **LAI-226 is not closed here** — it is about the duplicate
      `listProjects` in `api/tasks.ts`, which is the board rebuild's to
      absorb; this criterion originally claimed it, corrected on reading the
      task file.
- [x] Old `Sidebar.tsx` and `UserChrome.tsx` are deleted; replacements live in
      `src/components/sidebar/` with structure-map entries updated in the
      `WEB_*` maps only.
- [x] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

New files: `src/components/sidebar/{Sidebar,SpacesSection,SpacesPopover,
SidebarFooter}.tsx` + `sidebar.css`. Style comes from the prototype; markup
never does (§5.1). No new dependencies.

Absorbed backlog ids, for CHIEF to close against this: **LAI-242, LAI-215,
LAI-226.** CHIEF's **LAI-247** (`--tx3` contrast guard) is adjacent, not
absorbed — check its state at claim time and leave it to its own task unless
CHIEF says otherwise.

## Completion notes

**Two criteria were corrected against the artefact before ticking** (marked
inline): the popover lists unpinned spaces per the prototype's `popSpaces`,
and LAI-226 is not closed here — it belongs to the board rebuild.

**Deliberate deviations from the prototype, each stated in the code:**
- The `⋯` "More actions" head button is not rendered — it opens nothing in the
  design file either, and a dead control is what §5.1 forbids.
- The popover's search box is a **real filter**; its empty copy drops the
  design's "Search to find archived ones", which promises an archive search
  nobody has built.
- A quiet **Sign out** button rides at the user chip's end — the design has no
  sign-out anywhere, and the function is not lost to a mockup's omission.
- The `+` (Create space) navigates to `/projects`, where creation lives,
  until a create-space surface exists.
- The sidebar's identity line is the org's name from `GET /org`; the old
  project-slug · version line is gone with the old head (the design has no
  version in the rail — LAI-064's rule that nothing renders unsupplied data
  is kept, by rendering nothing).
- Space rows keep LAI-248's name + `N tasks · M members` meta; the prototype
  shows `@slug` alone. Flagged for the final visual pass rather than changed
  under a geometry task, since LAI-248's accepted criterion names the meta.

**Two defects found by the rebuild's own guards, fixed here:**
- The initials guard caught **two more private copies** than LAI-215 knew of
  (`MembersScreen`, `AddMemberForm`) — five sites migrated, not three.
- The popover rendered **under the board**: `position: sticky` makes the rail
  a stacking context, so its z-index was local. It is a portal now, and the
  browser test that found it (a board headline intercepted the click) pins it.

**The 11 theme-switching browser tests** moved from the deleted radio group to
a `setTheme` harness helper that drives the real `ThemeSwitch` control — the
old tests' own "never a class toggle" property, kept.
