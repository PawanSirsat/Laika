---
id: LAI-1081
title: 'Developer access design: Add device and Add tool wizards in the design shell'
area: shell
assignee: unclaimed
priority: p2
depends-on: [LAI-1078, LAI-1080]
discovered-from: LAI-1075
status: backlog
---

## Why

The owner's V3 design draws each wizard in place of its list, with a titled
rail card, a wizard card with a top band and a footer band, and option tiles.
Today they render above the device list with a bare rail and no footer band.

## Acceptance criteria

- [ ] While open, a wizard replaces its list: "Add device" + "Back to
      devices"; "Add a coding tool" + "Back to tools".
- [ ] Rail card with title and sub; eyebrow "Step n of 3 · Device/Tool"; footer
      band with a note left and Back + primary right, on one line.
- [ ] Add device in three rail steps: Name your device (kind as option tiles,
      name, helper installed, imported choice) · Pair the device · Approve &
      finish (fingerprint, Approve/Deny, then Paired).
- [ ] Add tool in three rail steps: Choose tool (tiles by mode, on-device
      select, unpaired devices with Pair) · Configure on your device · Verify
      & finish (checks while polling; consent and "Set up a project →").
      Reconnect starts at step 2.
- [ ] Behaviour unchanged: polling, cancel, fingerprint echo, errors, focus.
- [ ] Tests: `developer-add-wizards` updated; both themes; 390px.

## Notes

- SHELL, `server/web/` only. PR into `integration-dev-access-design`.
