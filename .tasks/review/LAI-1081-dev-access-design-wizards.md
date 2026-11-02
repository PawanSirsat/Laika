---
id: LAI-1081
title: 'Developer access design: Add device and Add tool wizards in the design shell'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1078, LAI-1080]
discovered-from: LAI-1075
status: review
started: 2026-11-02T11:07:36+05:30
finished: 2026-11-02T13:47:42+05:30
---

## Why

The owner's V3 design draws each wizard in place of its list, with a titled
rail card, a wizard card with a top band and a footer band, and option tiles.
Today they render above the device list with a bare rail and no footer band.

## Acceptance criteria

- [x] While open, a wizard replaces its list: "Add device" + "Back to
      devices"; "Add a coding tool" + "Back to tools".
- [x] Rail card with title and sub; eyebrow "Step n of 3 · Device/Tool"; footer
      band with a note left and Back + primary right, on one line.
- [x] Add device in three rail steps: Name your device (kind as option tiles,
      name, helper installed, imported choice) · Pair the device · Approve &
      finish (fingerprint, Approve/Deny, then Paired).
- [x] Add tool in three rail steps: Choose tool (tiles by mode, on-device
      select, unpaired devices with Pair) · Configure on your device · Verify
      & finish (checks while polling; consent and "Set up a project →").
      Reconnect starts at step 2.
- [x] Behaviour unchanged: polling, cancel, fingerprint echo, errors, focus.
- [x] Tests: `developer-add-wizards` updated; both themes; 390px.

- [x] Added on the owner's direct instruction (2026-11-02): closing a tool's
      details while a credential created in the browser is on screen asks
      *Close without copying the new credential?* (×, Escape, scrim); leaving
      or reloading the page meanwhile gets the browser's warning. Tested,
      and the test goes red with the question removed.
- [x] Kit fix reported by the LAI-1079 and LAI-1082 builders: full-width
      buttons fit their card (`box-sizing`); the phone rail strip is a row.

## Notes

- SHELL, `server/web/` only. PR into `integration-dev-access-design`.
- Claimed before LAI-1080 is accepted, deliberately (CHIEF, §2 step 1): the
  wizards' own bodies do not depend on it; where they mount (Devices for Add
  device, Tools for Add tool) is LAI-1080's, and this slice merges it before
  it changes the mounting.

- The browser's own Back cannot be asked about from inside the panel; it
  closes the panel and the secret with it. Every other way out asks.
- PR into `integration-dev-access-design`; screenshots in
  `.polly/evidence/LAI-1081/`.
