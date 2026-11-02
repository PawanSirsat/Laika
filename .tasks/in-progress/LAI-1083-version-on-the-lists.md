---
id: LAI-1083
title: 'Developer access: the helper version on the Tools and Devices lists'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1080]
discovered-from: LAI-1081
status: in-progress
started: 2026-11-02T16:53:40+05:30
---

## Why

The owner, after the V3 design release (2026-11-02): *"I observed that the
version thing is removed now."* LAI-1080 moved each tool's helper status into
its Details panel; a list row shows a chip only when an update is available or
required, and a device row shows none. The owner wants it on the lists again.

## Acceptance criteria

- [ ] Every active tool's row on **Tools** carries a quiet version chip:
      *Helper up to date* (ok), *Update available*, *Update required*,
      *Version unknown* or *Could not check* (neutral); nothing while it is
      still being read. Its line adds the helper version the tool reported
      (*helper 0.1.0*) when there is one.
- [ ] Every device row on **Devices** carries one chip for its tools' worst
      helper status (*Helpers up to date* when all are), with the full
      breakdown still in Device Details.
- [ ] Words and tones from one pure function with a mirror unit test; no new
      request (the list already reads each tool's verification once).
- [ ] Browser tests: each status on a Tools row, the reported version, the
      device chip; both themes; 390px.

## Notes

- SHELL, `server/web/` only. Owner's direct instruction; PR to `master`
  after the owner sees it.
