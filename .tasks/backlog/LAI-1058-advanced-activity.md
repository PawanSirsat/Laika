---
id: LAI-1058
title: 'Developer access V3 slice D5: Advanced (personal credentials), Activity, outside-link terminology'
area: shell
assignee: unclaimed
priority: p1
depends-on: [LAI-1048, LAI-1046]
discovered-from: LAI-1042
status: backlog
---

## Why

Slice D5 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §B.5, §B.6, §B.7, §C,
§H, §J D5 + F1 copy items, §K, §L7). SHELL `server/web/` only. Tab changes
apply in `v3` and `preview`; `classic` renders exactly what it does today.

Not touched: Devices tab (LAI-1054, `v3/DevicesTab`, devices view), pairing or
tool-setup server files, Project setup files.

## Acceptance criteria

- [ ] Advanced lists personal credentials only (`?kind=personal`); an agent
      credential never appears; purpose copy says scripts, REST, automation.
- [ ] New credential has an expiry choice, default 90 days, `Never` allowed
      (L7); it sends `expires_at` (or none for Never) to the existing API.
- [ ] A personal token last used by a coding tool is labelled
      `Personal (legacy)` with migration guidance and an `Upgrade connection`
      link to `/developer?tab=devices&add=tool`, which revokes nothing.
- [ ] One-time secret display preserved; revoke sits under a `⋯` menu with a
      confirmation; a revoke failure shows with the form closed.
- [ ] Activity: the developer-insights rules, repo scope and history move
      unchanged; the chip reads `Once per device` in v3/preview; deleting
      history asks for confirmation.
- [ ] Outside pages (all modes, copy and link targets only): People `Agents`
      → `Tools running`; profile `Agents used` → `Tools used`, usage card
      `Tokens` → `LLM tokens`; Space settings `Agent sessions` reworded per
      §B.7; links into Developer access go through `developerAlias`.
- [ ] Classic tabs unchanged; tests for each item above; both themes, 390 px,
      keyboard, focus return; screenshots in `.polly/evidence/LAI-1058/`.
