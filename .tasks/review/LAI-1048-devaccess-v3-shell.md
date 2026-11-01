---
id: LAI-1048
title: 'Developer access V3 slice D1: the V3 shell behind the flag, legacy routes, Overview'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1043, LAI-1044]
discovered-from: LAI-1042
status: review
started: 2026-11-02T03:10:00+05:30
finished: 2026-11-02T03:27:00+05:30
---

## Why

Slice D1 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §B, §C, §H, §I, §J
slice D, §K). `GET /api/v1/developer/compatibility` (LAI-1043) now serves
`features.developer_access` = `classic|preview|v3`; the shared wizard parts
(LAI-1044) are on master. This slice builds the V3 Developer access shell
behind that flag, using existing endpoints only.

## Acceptance criteria

- [x] The web reads `features.developer_access` from
      `GET /developer/compatibility`; an unreadable answer is `classic`.
- [x] `classic` renders today's five tabs unchanged.
- [x] `preview` keeps the classic tabs and default, and adds the V3 tabs
      reachable alongside, clearly marked as preview.
- [x] `v3` shows Overview · Project setup · Devices · Activity · Advanced,
      with Overview the default.
- [x] Every legacy route and alias in plan §C (`/connect`,
      `/developer/connect`, `/tokens`, `?tab=connect|agents|projects|activity|tokens`,
      `?agent=`, `?step=`) lands correctly in all three modes, as a `replace`,
      with the rest of the query kept and no loop; tested in all three modes.
- [x] Overview: quiet first-run guidance with a resumable
      Add device → Add tool → Set up project journey derived only from real
      data (agents, devices, grants); a person who already has a working tool
      sees *Set up a project* as the primary action and no onboarding funnel.
- [x] Devices and Project setup re-host the existing Agents and Projects
      content with no behaviour loss; Activity moves unchanged; Advanced
      re-hosts Tokens.
- [x] No new endpoints.
- [x] OverflowMenu closes on focus leaving it; disabled items are announced
      (`aria-disabled`, still focusable) without breaking its tests.
- [x] A shared throttled `aria-live` helper (plan §A3).
- [x] A test fails if a wizard part renders unstyled.
- [x] Both themes, 390 px, keyboard-only, focus return; loading, empty,
      error, 403 and session-expired states.
- [x] Screenshots light+dark, desktop+390, per mode in `.polly/evidence/LAI-1048/`.

## Notes

- SHELL only, `server/web/` only. LAI-1045 (devices migration) and LAI-1046
  (token kind) are other builders' files; not touched.
- Belka: one test file at a time, single worker; CI is the full gate.

## Done

- Commits `a2dab166` (overflow menu, live region) and `2fad98b7` (V3 shell,
  aliases, Overview). Details, decisions and mutants in
  `logs/shell-2026-11-02-LAI-1048.md`.
- `?add=device|tool` open today's registration wizard until D4; the
  "no device → add=device first" branch of §C's `agent=` row waits for it.
- Disabled overflow items: `aria-disabled` and focusable, still skipped by the
  arrows (the existing menu test asserts the skip).

## Review round 1 (PR #206)

Fixed in `48e5ced6`: B1 (live region counts as connected only tools seen by
the board; `overviewSummary()` unit-tested), (a) compatibility read times
out to classic after 4 s, (b) repeated-parameter alias rows, (c) live region
announces on a data change, (d) focus moves to the new primary action when
the view flips under it, (e) OverflowMenu comment softened. Details in the
log.
