---
id: LAI-985
title: 'The owner cannot grant space creation, token management, or invite without deactivate; capabilities have no descriptions'
area: server
assignee: core
priority: p2
depends-on: [LAI-981]
discovered-from:
status: in-progress
started: 2026-10-22T18:10:23Z
---

## Acceptance criteria (D-104 item 6)

- [ ] New capabilities *Create and archive spaces*, *Manage anyone's tokens*;
      *Manage people* splits into *Invite people* and *Deactivate people and
      reset access* (covering LAI-981's sign-out and LAI-983's reset link).
      Defaults = today; migration maps existing stored grants (the old
      manage_people value → both halves).
- [ ] Each capability has a server-provided one-line `description`.
- [ ] Policy/matrix/drift tests updated cell by cell; owner-locked unchanged.
- [ ] Named SPEC edits (§3 grants table). Gate; web half LAI-989.
