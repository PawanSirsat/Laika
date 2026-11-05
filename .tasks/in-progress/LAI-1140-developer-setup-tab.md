---
id: LAI-1140
title: 'Developer setup tab on the member profile'
area: server/web
assignee: shell/belka
priority: p2
depends-on: [LAI-1137, LAI-1134]
status: in-progress
started: 2026-11-05T18:05:00+05:30
---

## Why

T8 of `.polly/plans/time-report-programme.md` (§1 turn 2 frames 2p–2ab, §2.4,
§4 T8), D-132, D-133, D-134. Owners and holders of *See and manage anyone's
developer setup* read a member's whole developer setup on their profile, and
revoke a tool, unpair a device or revoke a token behind a confirm. Card
LAIKA-1003, a subtask of LAIKA-997 (LAI-1133). Filed straight into
`in-progress/` by polly's dispatch: no file existed on any branch.

## Named crossings

- `server/web/test/api/endpoint-coverage.test.ts` `NO_BROWSER_CALLER`: the
  three entries marked *LAI-1140 — Developer setup tab* removed (SHELL's file;
  listed for the reviewer).
- `server/test/tooling/response-type-coverage.test.ts`: the six LAI-1137
  `no client type exists` entries leave, paired in `view-type-drift.test.ts`.
- `docs/SPEC.md` §11.4.2 and §11.4.2.1: the member profile rows gain the tab.

## Acceptance criteria

- [ ] Frames 2p–2ab plus the error state, token-driven in both themes and at
      390px: summary, devices (revoked collapsed), pending pairing requests,
      tools (checks, grants, launcher, consent, last seen), repositories,
      tokens including revoked and expired, and 30 days of activity.
- [ ] The notice line *"… can see that you looked"*.
- [ ] Hidden spaces are counts, never names (`repositories_hidden`,
      `grants_hidden`, `project_ids_hidden`).
- [ ] Every ⋯ is a `menu` of `menuitem`s; each action opens a confirm listing
      what stops working and *"<first> is notified in Laika"* (no email).
- [ ] A success notice after each revoke.
- [ ] Revoke actions are hidden, with an explanation, when the reader may not
      revoke (`can_revoke` false: an admin on the owner); `403 not_for_owner`
      from the server is handled with its sentence.
- [ ] Deactivated (frame 2aa): everything muted, only revokes left.
- [ ] Token filter Active / Expired / Revoked / All with counts, and search
      when there are more than 8.
- [ ] The health line (derived on the client from checks and the client
      report) jumps focus to the item.
- [ ] The pending pairing row shows no code.
- [ ] The tab is absent without `developer_setup.read_any` and on your own
      profile.
- [ ] Loading, empty (2y/2z) and error-with-retry states; nothing hardcoded,
      with a no-prototype-data guard.
- [ ] Client types in `api/developer-setup.ts`, paired in
      `view-type-drift.test.ts`.
