---
id: LAI-149
title: Restore the first-boot presence toggle, and add it to org settings
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-207]
discovered-from: LAI-207
status: backlog
---

## Goal

LAI-106 deleted the first-boot presence toggle because there was nowhere to put
the answer: §6.3 makes the setup body strict, so sending `trackPresence` failed
the whole submission with a `422`. **LAI-207 built the destination.**

- `POST /api/v1/setup` accepts optional **`presence_enabled`** (boolean, absent
  means on).
- `GET /api/v1/org` returns `presence_enabled` **to every role**.
- `PATCH /api/v1/org` sets it, Admin and above.

## What is needed

- The toggle on first boot, with the design's copy: *"Track presence — record
  which repo and task each person is working in. Powers the capacity view."*
  Default **on**, matching §4.2 and the design.
- The same setting on the Organisation screen (§11.4.2), editable by Admin+ and
  **visible but not editable** to everyone else.

## Acceptance criteria

- [ ] First boot sends `presence_enabled` and the value survives a reload.
- [ ] The Organisation screen shows it, and a Member or Viewer sees the value
      without a control that would 403.
- [ ] Both themes.

## Notes / context

**The name is `presence_enabled`, not `trackPresence`.** The old name is still a
`422` and that is deliberate — LAI-207 fixed this by adding the key the server
accepts, not by loosening the schema. Sending the old one will fail the whole
submission exactly as before.

**Read is every role, write is Admin+, and the asymmetry is on purpose.**
§11.4.2 shows a **disabled** state on Capacity when this is `0`, which is
distinct from an empty one — so anyone who can open Capacity has to be able to
tell those apart, and Capacity is not an admin screen. It is also a claim about
the people being tracked (D-005), who have the strongest reason to know it.

**Do not render a control a Member cannot use.** `PATCH /api/v1/org` will `403`
them. A disabled control with the value shown is right; a control that appears to
work is the failure LAI-106 removed the original toggle over.

**Nothing enforces it yet, and the screen should not imply otherwise.** §4.2 puts
enforcement on `POST /heartbeats` (M4) and Presence/Capacity (M5). Today the
setting is stored and honoured by nobody, so first boot should not promise that
turning it off stops anything that is already running — nothing is.
