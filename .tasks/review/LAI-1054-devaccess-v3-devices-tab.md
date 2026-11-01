---
id: LAI-1054
title: 'Developer access V3 slice D3: the Devices tab, devices first with their tools nested'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1045, LAI-1046, LAI-1048]
discovered-from: LAI-1042
started: 2026-11-02T03:59:45+05:30
finished: 2026-11-02T04:27:02+05:30
status: review
---

## Why

Slice D3 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §B.3, §D, §H, §J
slice D, §K). LAI-1048 put the V3 shell on master with the Devices tab
re-hosting the classic Agents tab. This slice replaces that re-host, in `v3`
and `preview` modes only, with devices as the primary object and their tools
nested as rows. Uses existing endpoints only: `GET /api/v1/devices`
(LAI-1045), token `kind`/`agent_id`/`agent_label` (LAI-1046), and the
existing agent endpoints.

## Acceptance criteria

- [x] V3/preview Devices tab lists devices from `GET /devices` with their
      tools nested; no second agent list, no Connect-vs-Agents split.
- [x] Per device: name, kind (local / cloud, with the 24 h note for cloud),
      *Imported device — confirm it's yours* for an imported unconfirmed
      device (confirm via the existing recognised-device action), last seen.
- [x] Per tool row: *Tool · Device*, a status word and a short reason from
      real evidence only (Needs setup, Connected only from a real recent
      authenticated request by that agent, Idle, Offline; never *Ready*),
      a *Version unknown* placeholder, *Working on LAIKA-n* only from live
      claim data an existing API returns, the consent switch.
- [x] ⋯ menu per tool: rename (where allowed), project access, rotate,
      revoke — existing APIs and confirmations naming exactly what stops.
- [x] Legacy duplicate agents of one tool+device: an expandable conflicts
      section, both intact, no auto-revoke.
- [x] Revoked hidden by default behind *Show revoked*, excluded from counts.
- [x] Add device / Add tool route to the existing classic registration
      wizard (`?add=device|tool`) until slice D4.
- [x] States: empty, loading, error, 403, session-expired, revoked.
- [x] Keyboard-only incl. ⋯ menus, focus return after dialogs, aria-live via
      the shared helper, both themes, 390 px.
- [x] Tests: real API data only; imported vs paired; conflicts; revoked
      toggle and counts; status words; ⋯ actions call existing APIs; classic
      mode unchanged; a11y.
- [x] Screenshots light+dark, desktop+390 in `.polly/evidence/LAI-1054/`.

## Notes

- SHELL only, `server/web/` only. Not touched: Project setup (LAI-1052),
  pairing (LAI-1050), `laika update` (cli).
- Belka: one test file at a time, single worker; CI is the full gate.
