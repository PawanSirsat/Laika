---
id: LAI-1070
title: 'Devices hides a paired device once its only tool is disconnected, and says every device is revoked'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1069
status: backlog
---

Found in the LAI-1069 walkthrough (`docs/acceptance/LAI-1069-developer-access-v3.md`,
step 13). Pair a device (`Walkbook`), add one tool to it, then **Disconnect
tool**. The Devices tab then reads *"0 devices · 0 tools"* and *"Every device
and tool of yours is revoked."*, with the device only under *Show revoked
(1)*. It is not revoked: `GET /devices` still returns it `status: "active"`,
paired, with its key — and it is exactly the device you would add the next
tool to. Reload does not change it.

Cause: `deviceLive()` (`server/web/src/routes/screens/developer/v3/devices-view.ts:139`)
lists a device only if it has an active tool, or is paired with **no agents
at all**. A paired device whose agents are all revoked falls through to
"history". The empty-state copy (`DevicesTab.tsx:514`) then states something
false.

## Acceptance

- [ ] A paired, active device stays listed whatever its tools' state — none,
      all revoked, or some — with *+ Add tool* reachable from it.
- [ ] The "Every device and tool of yours is revoked" note appears only when
      every device is in fact revoked.
- [ ] An **imported** device whose tools are all revoked keeps today's
      behaviour (history), unless the owner decides otherwise.
- [ ] Unit test on `deviceLive` for the paired-all-revoked case, red before
      the fix; a browser test for the disconnect → still listed path.
- [ ] Web typecheck, eslint, prettier exit 0; PR into `master`, CI green.
