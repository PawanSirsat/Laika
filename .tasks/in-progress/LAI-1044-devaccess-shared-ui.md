---
id: LAI-1044
title: 'Developer access V3 slice A3: extract Connect visual parts into shared components, no behaviour change'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
discovered-from: LAI-1042
status: in-progress
started: 2026-11-01T20:46:32Z
---

## Why

The Developer Access V3 plan (LAI-1042, `docs/proposals/LAI-1042-developer-access-v3-plan.md`
on `LAI-1042-devaccess-v3-plan`, §A, §B.2, §J slice A3, §K) builds every V3
screen out of parts that today are private to
`server/web/src/routes/screens/connect/ConnectScreen.tsx`. Extracting them
first, as a pure refactor proven by golden tests, lets the V3 slices (D1–D5)
reuse them without touching the classic Connect page.

## Acceptance criteria

- [ ] Shared components exist under `server/web/src/components/` for: step rail,
      wizard card, selected-tool tiles, code/prompt block with copy control,
      muted help, wizard footer, status chip (word + reason, never colour
      only), and a `⋯` overflow menu.
- [ ] `ConnectScreen.tsx` renders through the shared components and the
      current Connect page renders the same: a golden DOM/a11y test captures
      the classic page's markup at each step before and after the refactor.
- [ ] The overflow menu has keyboard and focus handling (open with
      Enter/Space/ArrowDown, arrows move, Escape closes and returns focus to
      the trigger, Tab leaves) and reuses the existing focus helper; tests
      prove each.
- [ ] The status chip uses only existing `--chip-*` / `--accent*` / text
      tokens: no raw hex, no new token. Both themes covered.
- [ ] Tool lists come from the existing catalog (`AGENT_GUIDES`); no
      hard-coded counts are introduced.
- [ ] `structure.test.ts` `WEB_*` maps are updated for any new file.

## Notes

- SHELL only, `server/web/` only. No server, CLI or docs edits.
- Plan items not in this slice's dispatched scope (tool-capabilities.ts
  drift test, `live-region.ts`) are left for a later slice.
- Belka: one test file at a time, single worker; CI is the full gate.
