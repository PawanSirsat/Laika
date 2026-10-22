---
id: LAI-972
title: 'server/src/services/orgs.ts still documents that developers choose whether to share local activity'
area: server
assignee: core
priority: p2
depends-on: [LAI-963]
discovered-from: LAI-963
status: review
started: 2026-10-22T16:18:19Z
finished: 2026-10-22T16:23:38Z
---

## Acceptance criteria

- [x] `server/src/services/orgs.ts` ~107–113 and any other server-side
      comment, error message or API description that says a person opts in to
      local-activity collection (untruncated census of `server/src`) says
      instead that the organisation's Developer insights decides (D-102
      amendment). No behaviour change.
- [x] Gate exit 0 on the integration branch.
