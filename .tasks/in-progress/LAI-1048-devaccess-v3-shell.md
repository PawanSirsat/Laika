---
id: LAI-1048
title: 'Developer access V3 slice D1: the V3 shell behind the flag, legacy routes, Overview'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1043, LAI-1044]
discovered-from: LAI-1042
status: in-progress
started: 2026-11-02T03:10:00Z
---

## Why

Slice D1 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §B, §C, §H, §I, §J
slice D, §K). `GET /api/v1/developer/compatibility` (LAI-1043) now serves
`features.developer_access` = `classic|preview|v3`; the shared wizard parts
(LAI-1044) are on master. This slice builds the V3 Developer access shell
behind that flag, using existing endpoints only.

## Acceptance criteria

- [ ] The web reads `features.developer_access` from
      `GET /developer/compatibility`; an unreadable answer is `classic`.
- [ ] `classic` renders today's five tabs unchanged.
- [ ] `preview` keeps the classic tabs and default, and adds the V3 tabs
      reachable alongside, clearly marked as preview.
- [ ] `v3` shows Overview · Project setup · Devices · Activity · Advanced,
      with Overview the default.
- [ ] Every legacy route and alias in plan §C (`/connect`,
      `/developer/connect`, `/tokens`, `?tab=connect|agents|projects|activity|tokens`,
      `?agent=`, `?step=`) lands correctly in all three modes, as a `replace`,
      with the rest of the query kept and no loop; tested in all three modes.
- [ ] Overview: quiet first-run guidance with a resumable
      Add device → Add tool → Set up project journey derived only from real
      data (agents, devices, grants); a person who already has a working tool
      sees *Set up a project* as the primary action and no onboarding funnel.
- [ ] Devices and Project setup re-host the existing Agents and Projects
      content with no behaviour loss; Activity moves unchanged; Advanced
      re-hosts Tokens.
- [ ] No new endpoints.
- [ ] OverflowMenu closes on focus leaving it; disabled items are announced
      (`aria-disabled`, still focusable) without breaking its tests.
- [ ] A shared throttled `aria-live` helper (plan §A3).
- [ ] A test fails if a wizard part renders unstyled.
- [ ] Both themes, 390 px, keyboard-only, focus return; loading, empty,
      error, 403 and session-expired states.
- [ ] Screenshots light+dark, desktop+390, per mode in `.polly/evidence/LAI-1048/`.

## Notes

- SHELL only, `server/web/` only. LAI-1045 (devices migration) and LAI-1046
  (token kind) are other builders' files; not touched.
- Belka: one test file at a time, single worker; CI is the full gate.
