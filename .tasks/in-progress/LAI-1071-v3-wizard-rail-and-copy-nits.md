---
id: LAI-1071
title: 'V3 wizards: Reconnect''s rail shows a tick on "Not yet", and Overview''s Add-a-device copy talks about a tool'
area: web
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-1069
status: in-progress
started: 2026-11-02T02:20:43Z
---

Two small things seen in the LAI-1069 walkthrough
(`docs/acceptance/LAI-1069-developer-access-v3.md`):

1. **Reconnect (new credential)…** opens *Reconnect a tool* at step 2. Its
   rail's step 1 draws the done glyph `✓` with the status word **"Not yet"**
   (`Step 1: Choose the tool Not yet`, disabled). The glyph and the word
   disagree; the tool is already chosen.
2. Overview's first-run next step is **"Next: Add a device"**, but its body
   reads *"Register the first coding tool on the computer you work on. That
   computer becomes your first device."* — the step pairs a device and adds no
   tool (tools are step 2).

## Acceptance

- [ ] Reconnect's rail step 1 reads as done with the tool's label (as Add
      tool's does: *Claude Code · Walkbook*), or is not shown.
- [ ] Overview's Add-a-device body describes pairing the computer, not
      registering a tool.
- [ ] Tests assert the rail word for Reconnect and the Overview copy.
- [ ] Web typecheck, eslint, prettier exit 0; PR into `master`, CI green.
