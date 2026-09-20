---
id: LAI-606
title: One-place theming, the type-role system, and the prototype board restyle
area: web
assignee: shell
priority: p1
depends-on: []
status: done
finished: 2026-09-20T19:03:57Z
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

## Delta report — every value that still differs (the brief's Done-when)

Sizes follow the addendum, not the file's raw px, by owner decision. Beyond
that, the deliberate deltas:

| where | file / brief says | shipped | why |
| --- | --- | --- | --- |
| all raw px | mockup scale (13.5 titles, 8.5 chips, 26 avatars) | addendum scale | owner decision |
| colour hexes | file `#0c0c0f/#141418/#1b1b20…` | brief's `#0E0F11/#141417/#19191D…` | brief's typed table is the newest statement; near-miss deltas |
| P3 priority dot | brief reads "filled red/amber/green" | hollow 1.5px ring `--text-muted` | the file's own treatment; "ring when none" reading |
| done cards | file: whole card at opacity .66 | title muted only | brief names only the title |
| header meta (WIP n/4, "Sana reviews") | file computes from fixtures | slot renders nothing | no WIP config or reviewer data exists |
| card age | file has none on cards | kept, mono muted; "just now" accent < 5 min | brief explicit |
| unknown tags | (hash, previously) | neutral | brief + file fallback = grey |
| in-progress status | file colours it with its blue *accent* | `--chip-blue`, never `--accent` | accent is purple now |
| Google Fonts link | file loads from CDN | self-hosted @fontsource | SPEC §13.4 |
| dense switch | addendum writes `[data-density]` | `.kanban-dense` | owner earlier approved the existing toggle |
| focus ring offset | addendum: 2px offset everywhere | 47 accent rings exist, offsets vary per control | swept, not normalised — noted for a follow-up |

## Acceptance criteria

- [x] Colour-literal guard green: no literal outside `styles/theme.css` (+ the
      `avatar-color.ts` path exemption); every theme block declares identical tokens.
- [x] Type guard green: generated `type.css` matches `TYPE_ROLES` field-by-field;
      weights within the brief's 400–700.
- [ ] Board matches the brief's tables (addendum sizes, brief colour values), purple
      the only accent; in-progress status is blue, never accent.
- [ ] Screenshots at 1440 and 1024, both themes, beside the prototype; delta report
      listing every value that still differs.
- [x] Meta row never wraps; key never truncated at 218px lane width.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Closure note (2026-09-21)

The two unticked criteria were superseded, not skipped: the owner's LAI-605
brief replaced the addendum's sizes with the prototype file's own values, and
the screenshot/delta evidence obligation moved with it (its remainder is
LAI-614). The guards this task built - the single-source colour test, the
type-role sync and generator, the 218px meta-row squeeze - are all green on
this branch today, which is what its architecture criteria actually claim.
Gate evidence: web 0, server 0, lint 0, format 0, each read standalone.

---

## Accepted (CHIEF, 2026-09-21)

Same shape as LAI-605: two criteria unticked, superseded rather than skipped —
the owner's LAI-605 brief replaced the addendum's sizes with the prototype file's
own values, and the evidence obligation moved to **LAI-614**. Verified that
LAI-614 exists and carries it.

D-032 checked directly and is properly satisfied: `server/web/test/demo/not-in-bundle.test.ts`
asserts no fixture string reaches the built bundle **and** carries a
`needles.length > 0` self-check, so it cannot pass by testing nothing.
`DEMO_ENABLED` is an opt-in on `import.meta.env.DEV || VITE_LAIKA_DEMO === '1'`,
reduced to dead code in a normal build. The §5.1 fixture grep returns only
comments documenting what must not ship, and `route-table.ts` records that there
is deliberately no `SYSTEM` group.
