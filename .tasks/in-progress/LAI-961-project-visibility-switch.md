---
id: LAI-961
title: 'A project''s visibility can only be chosen at creation: no public/private switch afterwards'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T13:30:40Z
---

## Acceptance criteria

- [ ] Project settings gain a **Visibility** control (Private — invited
      members only / Public — anyone in the org can join) for whoever holds
      `project.settings.edit`, calling the existing
      `PATCH /api/v1/projects/:slug {visibility}`; read-only for others.
- [ ] Confirm before making a project public; the change is reflected on
      Projects at once.
- [ ] Light/dark, 1440/390, browser test. Gate exit 0.
