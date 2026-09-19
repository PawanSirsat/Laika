---
id: LAI-606
title: One-place theming, the type-role system, and the prototype board restyle
area: web
assignee: shell
priority: p1
depends-on: []
status: in-progress
started: 2026-09-19T22:44:47Z
---

## Why this id, and why it arrives with work already in the tree

**LAI-605 is skipped deliberately and remains free.** §3 says lowest-unused, but
~50 files of comments already cite LAI-606 — written while this work ran ahead of
its task file, which is the actual protocol breach this paragraph records. Claiming
605 would orphan every citation for the sake of density; the sweep confirms 606 is
free on every branch.

## Scope

Owner-directed, across several briefs the same day, most-recent-wins:

1. **One-place theming** — `src/styles/theme.css` is the only file allowed a colour
   literal (guarded); semantic tokens; `data-theme` switching; ~2,100 references
   renamed.
2. **Type-role system** — `src/theme/type-roles.ts` → generated `styles/type.css`
   (guard: field-by-field sync test); 17 roles + density.
3. **The prototype board restyle** (final brief): Obsidian values, purple accent,
   tinted chips, uppercase column headings, 22px count badges with status variants,
   "+ Add task" footer, per-card "+" removed, 36px avatars + bot badge, chrome
   sizing addendum. Full phase plan in the session plan file.

## Named repo-root files (§1 exception, exact files only)

- `pnpm-lock.yaml` — the mechanical result of `pnpm add @fontsource-variable/inter`,
  which the owner directed in words ("install inter"). The dependency itself lives in
  `server/web/package.json` (my area). No other repo-root file is touched.

## Baseline ledger (phase 0a)

Banked with four suites knowingly red — pre-existing debt of the half-landed state,
cleared in phase 0b: `tokens.test.ts` (reads deleted `theme/tokens.css`),
`lane-dots.test.ts` (pre-refresh token names), `task-card.test.ts` D-027 suite
(owner reversed D-027), `card-hit-area.test.ts:120` (exact-string class regex).

## Acceptance criteria

- [ ] Colour-literal guard green: no literal outside `styles/theme.css` (+ the
      `avatar-color.ts` path exemption); every theme block declares identical tokens.
- [ ] Type guard green: generated `type.css` matches `TYPE_ROLES` field-by-field;
      weights within the brief's 400–700.
- [ ] Board matches the brief's tables (addendum sizes, brief colour values), purple
      the only accent; in-progress status is blue, never accent.
- [ ] Screenshots at 1440 and 1024, both themes, beside the prototype; delta report
      listing every value that still differs.
- [ ] Meta row never wraps; key never truncated at 218px lane width.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.
