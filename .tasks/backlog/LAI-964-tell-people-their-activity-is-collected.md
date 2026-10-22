---
id: LAI-964
title: 'The web and CLI still offer a personal opt-out for local activity; after D-102 (amended) they must say the organisation collects it'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-963]
discovered-from:
status: backlog
---

## Goal

D-102 amendment, client half (SHELL owns `server/web/` and `cli/`).

## Acceptance criteria

- [ ] Developer access and the Connect wizard: the *Share local activity*
      switch is replaced by a plain notice when the org switch is on — *"Your
      organisation collects your local activity: <what>. Owners and admins
      can see it, and you can see who looked."* — with links to the person's
      own data preview and to *Who looked at my time* (when LAI-959 lands; a
      link to My day until then). Org switch off: unchanged wording.
- [ ] CLI: `laika activity on` / `status` / sync no longer require or check
      the personal switch; when the org switch is on they print the same
      notice once; when off, they say so as today. Tests in `cli/`.
- [ ] Drift checks (view-type, endpoint coverage, CLI/server shapes) green.
- [ ] Light/dark, 1440/390. Gate exit 0 on a branch with LAI-963 merged.
