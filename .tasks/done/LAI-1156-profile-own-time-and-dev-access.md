---
id: LAI-1156
title: 'Profile Time report and Developer access on your own profile'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1151, LAI-1152]
status: done
started: 2026-11-06T11:56:00+05:30
finished: 2026-11-06T12:18:21+05:30
---

## Goal

Your own profile's Time report and Developer access tabs (frames E and F).

## Acceptance criteria

- [x] Time report tab on your own profile is the shared Time report, `scope`
      me, titled *Time report*.
- [x] Developer access on your own: the Developer setup layout from your own
      reads (`/devices`, `/agents`, `/project-setups`, `/tokens` and LAI-1151's
      pending requests and activity), the own-setup notice, pending pairing
      requests with **Approve / Decline**, unpair and revoke without the
      owner-decision label, and the own empty states.
- [x] The "N to fix" count feeds the tab badge (LAI-1152).
- [x] Browser tests: own setup renders, approve and decline call the existing
      endpoints, attention links focus their item.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).

## Builder notes (SHELL, 2026-11-06)

- `DeveloperSetupTab.tsx` is one presentational `SetupPanel` fed by two
  adapters: someone else's admin read (unchanged), and your own reads
  assembled into the same shape by `own-setup-derive.ts` (`ownSetupView`).
  The words that differ are `voiceFor`.
- **Deviation — "Unpair" on your own is *Disconnect device…***: there is no
  own endpoint that revokes the device row; Developer access's own device
  action is `POST /agents/devices/revoke` (every tool on it revoked, the
  device stays paired). The confirm says exactly that, and is offered only
  while the device holds a live tool.
- A pending request offers Approve / Decline only once the device has
  claimed it (both need the claimed key fingerprint); open and approved
  requests say what they wait on. No code anywhere (D-124).
- A live tool whose verification read fails is `unverified`: its status
  falls back to the agent's stamps, as Developer access does, instead of
  reading as *Needs setup* from checks never made.
- Time report (own): already `scope="me"`, titled *Time report* — unchanged.

## Accepted (CHIEF, 2026-11-06)

Independent review clean; CI green; merged as #302 (fb19c185).
