---
id: LAI-404
title: GET and PATCH the project context document
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-31T11:05:00Z
---

## Goal

`projects.context_md` is a first-class product feature (SPEC §7.3) — the one
document that stops every teammate keeping a private `NOTES.md` and
re-explaining the same architecture to their own agent, differently. The MCP
tool `get_project_context` serves it to every agent session on the project.

The column exists and `PATCH /projects/:slug` currently accepts `context_md` as
one field among many. SPEC §6.4 specifies a **dedicated pair**:

```
GET   /api/v1/projects/:slug/context
PATCH /api/v1/projects/:slug/context     (lead+)
```

Dedicated because the permission differs from the rest of project settings only
in principle today but is specified separately, because the activity row is its
own thing, and because an agent fetching 100 KB of context should not have to
fetch the whole project object to get it.

## Acceptance criteria

- [ ] Both routes exist and are thin over a service.
- [ ] `GET` follows project read access — a `viewer` sees it (SPEC §7.3). `PATCH`
      is `project.settings.edit` (lead+, org Owner/Admin implicit lead).
      **Both call `can()`.**
- [ ] `GET` returns `context_md` verbatim — no trimming, no markdown rendering,
      no normalisation — plus `updated_at` and who last edited it.
- [ ] Every edit writes exactly one `activity` row so the document has a history.
      Add the verb to the closed vocabulary and its migration if absent.
- [ ] The size bound is **100,000 characters**, matching the existing zod schema
      in `server/src/http/routes/projects.ts`, and exceeding it is a `422` whose
      message names the limit and the actual length. SPEC §7.3 says a context
      document that silently blows an agent's context window is worse than no
      document — so it must not silently anything.
- [ ] Whatever `PATCH /projects/:slug` does with `context_md` today still works
      or is removed deliberately. Do not leave two write paths that can disagree.
      Say which you chose and why in your log.
- [ ] Tests: viewer can read, member cannot write, lead can write, org admin can
      write without project membership, oversize is `422`, activity row written.
- [ ] Full gate green.

## Notes

No new dependencies.

**SPEC §7.3 leaves the exact limit as open question §14 q7.** This task settles
it at the 100,000 already in the code rather than inventing a number — if the
owner later wants a different bound it is a one-line change and a decision, not
a redesign. Note in your log that q7 is now answered in code so CHIEF can close
it in the spec.
