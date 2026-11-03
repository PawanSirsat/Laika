---
id: LAI-1095
title: 'Developer access: rename a device'
area: server
assignee: core/belka
priority: p2
depends-on: [LAI-1045, LAI-1080]
discovered-from:
status: review
started: 2026-11-03T12:10:00+05:30
finished: 2026-11-03T12:40:00+05:30
---

## Why

The owner, 2026-11-03: *"in devices I want the feature where I can change the
device's name — do it and push it on master."* A device's name is today only
what its tools reported when they were registered (`imported`) or what was
typed when it was paired, and nothing can change it afterwards:
`services/devices.ts` says *"Read only, for now. Rename … are later slices"*.
Plan LAI-1042 §D.2 already settles the rule: *"Rename is allowed. It must keep
the key unique, and it rewrites `agents.device_label` of the device's agents in
the same transaction."*

## Acceptance criteria

- [x] `PATCH /api/v1/devices/:id` with `{ display_name }` (strict body)
      renames one of the caller's own **active** devices and answers the
      device, the shape `GET /devices/:id` serves. `agent.manage_own`,
      session only, as every other device write.
- [x] Refusals, each with its `code` and `reason`: a name that is not 1 to 80
      characters once trimmed is `422 invalid_device_name`; a name another of
      the caller's active devices holds (compared as §4.63 normalises it) is
      `409 device_name_taken`; a revoked device is `409 device_revoked`;
      another owner's device or an unknown id is the same `404`.
- [x] In the same transaction: every agent on the device, active and revoked,
      gets the new `device_label`, so every screen that names a tool
      `<tool> · <device>` follows; an agent whose `display_name` is still the
      default `<harness> · <old name>` follows too, with its tokens' names,
      and a name the owner chose is kept; a device confirmed only through
      `recognised_agent_devices` stays confirmed after its key changes; a live
      pairing request for it carries the new name.
- [x] Renaming onto `Cloud` applies the cloud-token rule to every live token
      on the device, as an agent relabel does (`422
      cloud_token_expiry_required` / `cloud_token_expiry_too_long`).
- [x] SPEC §4.78 says a device may be renamed and what that changes, and
      §6.4 lists the endpoint.
- [x] Developer access → Devices → a device's Details offers **Rename…** on an
      active device to someone who may manage devices; saving updates the
      panel title and the list row in place and is announced; a refusal is
      shown in the form. Both themes, 390px.
- [x] Route tests for every rule above; a unit test for the list update; a
      browser test for the rename in the panel.

## Notes

- Owner's direct instruction, built end to end from one worktree
  (`.polly/wt-1095`, branch `LAI-1095-device-rename`); PR to `master`, which
  deploys once CI is green.
- Named crossings (D-033): `docs/SPEC.md` §4.78 and the §6.4 endpoint block;
  `server/web/src/api/devices.ts`,
  `server/web/src/routes/screens/developer/v3/DeviceDetails.tsx`,
  `server/web/src/routes/screens/developer/v3/DeviceRoster.tsx`,
  `server/web/src/routes/screens/developer/v3/devices-view.ts`, their tests,
  and a browser test under `server/web/test/browser/`.
- No new activity verb (D-122: a device has none of its own), no migration,
  no new dependency.
