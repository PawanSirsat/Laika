---
id: LAI-1058
title: 'Developer access V3 slice D5: Advanced (personal credentials), Activity, outside-link terminology'
area: shell
assignee: shell/belka
priority: p1
depends-on: [LAI-1048, LAI-1046]
discovered-from: LAI-1042
started: 2026-11-02T05:14:35+05:30
finished: 2026-11-02T05:29:36+05:30
status: review
---

## Why

Slice D5 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §B.5, §B.6, §B.7, §C,
§H, §J D5 + F1 copy items, §K, §L7). SHELL `server/web/` only. Tab changes
apply in `v3` and `preview`; `classic` renders exactly what it does today.

Not touched: Devices tab (LAI-1054, `v3/DevicesTab`, devices view), pairing or
tool-setup server files, Project setup files.

## Acceptance criteria

- [x] Advanced lists personal credentials only (`?kind=personal`); an agent
      credential never appears; purpose copy says scripts, REST, automation.
- [x] New credential has an expiry choice, default 90 days, `Never` allowed
      (L7); it sends `expires_at` (or none for Never) to the existing API.
- [x] A personal token last used by a coding tool is labelled
      `Personal (legacy)` with migration guidance and an `Upgrade connection`
      link to `/developer?tab=devices&add=tool`, which revokes nothing.
- [x] One-time secret display preserved; revoke sits under a `⋯` menu with a
      confirmation; a revoke failure shows with the form closed.
- [x] Activity: the developer-insights rules, repo scope and history move
      unchanged; the chip reads `Once per device` in v3/preview; deleting
      history asks for confirmation.
- [x] Outside pages (all modes, copy and link targets only): People `Agents`
      → `Tools running`; profile `Agents used` → `Tools used`, usage card
      `Tokens` → `LLM tokens`; Space settings `Agent sessions` reworded per
      §B.7; links into Developer access go through `developerAlias`.
- [x] Classic tabs unchanged; tests for each item above; both themes, 390 px,
      keyboard, focus return; screenshots in `.polly/evidence/LAI-1058/`.

## Notes for review

- **No server change.** `POST /api/v1/tokens` already takes `expires_at`
  (positive int, nullish = never); *Never* sends no field.
- **Activity's V3 copy is `v3` only**, not `preview`: in preview, Activity is a
  classic tab, and plan §C says `projects`/`activity` render their V3 version
  only in `v3`. Preview gets Advanced (a V3-only tab) in full.
- **Outside links use classic ids** (`DEVELOPER_LINKS` in `page-tabs.ts`):
  `developerAlias` moves `tokens` → `advanced` in v3 only, so classic is
  unchanged. Tested per mode in a node test and in `organisation-tokens`.
- **Upgrade connection** targets `/developer?tab=devices&add=tool[&tool=<guide>]`,
  which today opens the classic register wizard re-hosted on Devices
  (LAI-1054/D4 replace it). It is a plain link; no DELETE is sent (tested).
- Delete history already asked for confirmation; a test now proves it.
- Classic `TokensScreen` and `TokenRow` are untouched.
