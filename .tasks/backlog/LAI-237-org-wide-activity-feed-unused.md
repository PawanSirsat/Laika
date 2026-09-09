---
id: LAI-237
title: The org-wide activity feed is served and never read
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-460
status: backlog
---

## Goal

`GET /api/v1/activity` — the **org-wide** feed — is served and called by nothing
(LAI-460). Only the per-project `GET /projects/:slug/activity` is read.

§11.4.2 gives the Dashboard *"what happened across every project"*, and the
Dashboard currently derives its feed from one project at a time.

## Acceptance criteria

- [ ] The Dashboard reads the org-wide feed where it means "across projects",
      and says which it is showing. The two are different questions and a reader
      cannot tell them apart from the rows.
- [ ] Wording comes from the existing `dashboard-derive` map — **no second
      vocabulary** (§4.8 has one, and LAI-169 is the precedent for keeping it).
- [ ] LAI-460's exemption for `api/v1/activity` is removed.
- [ ] Full gate `EXIT 0`.
