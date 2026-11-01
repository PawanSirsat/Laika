---
id: LAI-1044
title: 'Developer access V3 slice A3: extract Connect visual parts into shared components, no behaviour change'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from: LAI-1042
status: review
started: 2026-11-01T20:46:32Z
finished: 2026-11-01T21:02:44Z
---

## Why

The Developer Access V3 plan (LAI-1042, `docs/proposals/LAI-1042-developer-access-v3-plan.md`
on `LAI-1042-devaccess-v3-plan`, §A, §B.2, §J slice A3, §K) builds every V3
screen out of parts that today are private to
`server/web/src/routes/screens/connect/ConnectScreen.tsx`. Extracting them
first, as a pure refactor proven by golden tests, lets the V3 slices (D1–D5)
reuse them without touching the classic Connect page.

## Acceptance criteria

- [x] Shared components exist under `server/web/src/components/` for: step rail,
      wizard card, selected-tool tiles, code/prompt block with copy control,
      muted help, wizard footer, status chip (word + reason, never colour
      only), and a `⋯` overflow menu.
- [x] `ConnectScreen.tsx` renders through the shared components and the
      current Connect page renders the same: a golden DOM/a11y test captures
      the classic page's markup at each step before and after the refactor.
- [x] The overflow menu has keyboard and focus handling (open with
      Enter/Space/ArrowDown, arrows move, Escape closes and returns focus to
      the trigger, Tab leaves) and reuses the existing focus helper; tests
      prove each.
- [x] The status chip uses only existing `--chip-*` / `--accent*` / text
      tokens: no raw hex, no new token. Both themes covered.
- [x] Tool lists come from the existing catalog (`AGENT_GUIDES`); no
      hard-coded counts are introduced.
- [x] `structure.test.ts` `WEB_*` maps are updated for any new file.

## Notes

- SHELL only, `server/web/` only. No server, CLI or docs edits.
- Plan items not in this slice's dispatched scope (tool-capabilities.ts
  drift test, `live-region.ts`) are left for a later slice.
- Belka: one test file at a time, single worker; CI is the full gate.

## Done

- Golden: `server/web/test/browser/connect-golden.test.ts` and
  `golden/connect.json`, taken in `35ad1314` before the refactor; still
  green after it. Mutation-checked: a markup mutant and a CSS mutant each go red.
- `structure.test.ts` needed no `WEB_*` entry. Both new `.ts` modules
  (`command-lines.ts`, `overflow-menu-model.ts`) have mirrored tests; `.tsx`
  files are not mirrored.
- The wizard parts keep the `conn-*` classes, and their rules stay in
  `connect.css`. Moving them is deferred to slice F5. Reasons are in
  `logs/shell-2026-11-02-LAI-1044.md`.
