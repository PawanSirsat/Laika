---
id: LAI-404
title: GET and PATCH the project context document
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-08-31T11:05:00Z
finished: 2026-08-31T11:35:00Z
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

- [x] Both routes exist and are thin over a service.
- [x] `GET` follows project read access — a `viewer` sees it (SPEC §7.3). `PATCH`
      is `project.settings.edit` (lead+, org Owner/Admin implicit lead).
      **Both call `can()`.**
- [x] `GET` returns `context_md` verbatim — no trimming, no markdown rendering,
      no normalisation — plus `updated_at` and who last edited it.
- [x] Every edit writes exactly one `activity` row so the document has a history.
      Add the verb to the closed vocabulary and its migration if absent.
- [x] The size bound is **100,000 characters**, matching the existing zod schema
      in `server/src/http/routes/projects.ts`, and exceeding it is a `422` whose
      message names the limit and the actual length. SPEC §7.3 says a context
      document that silently blows an agent's context window is worse than no
      document — so it must not silently anything.
- [x] Whatever `PATCH /projects/:slug` does with `context_md` today still works
      or is removed deliberately. Do not leave two write paths that can disagree.
      Say which you chose and why in your log.
- [x] Tests: viewer can read, member cannot write, lead can write, org admin can
      write without project membership, oversize is `422`, activity row written.
- [x] Full gate green.

## Notes

No new dependencies.

**SPEC §7.3 leaves the exact limit as open question §14 q7.** This task settles
it at the 100,000 already in the code rather than inventing a number — if the
owner later wants a different bound it is a one-line change and a decision, not
a redesign. Note in your log that q7 is now answered in code so CHIEF can close
it in the spec.

## Notes back — CORE, 2026-08-31

**AC6: removed, not kept.** `context_md` no longer reaches `PATCH
/projects/:slug`. Two writers of one column is two places enforcing the bound
and two shapes of audit row. Nothing was using it — §6.4 specifies this pair and
the SPA only reads the field, checked before deciding. `.strict()` turns a
client still sending it into a `422` naming the field, so the removal is visible
rather than silent.

**AC4: no new verb, and this is the one place I did not follow the criterion
literally.** It says to add the verb to the closed vocabulary if absent.
`schema-spec-drift.test.ts` pins `ACTIVITY_TYPES` against §4.8 **in both
directions**, and `docs/SPEC.md` is CHIEF's — so adding one from here would
either fail that guard or edit another session's area. `services/sprints.ts` set
the precedent already ("§4.8 has no sprint verb, and growing it is LAI-113").

It rides under `project.updated` with `{ changed: ['context_md'], length,
previous_length }` — the lengths being what make it a *history* a reviewer can
read rather than a bare marker. **If you want a dedicated verb, it is a SPEC
change plus a migration and I will take it as its own task rather than reach
into `docs/`.**

**§14 q7 is answered in code and is yours to close in the spec.**
`CONTEXT_MD_LIMIT = 100_000` — the number the zod schema has enforced since
LAI-006, promoted to the service so both entry points share one rule.

**One design point worth a look.** `updated_at`/`updated_by` are read from
`activity`, not from a column on `projects`, because `projects.updated_at` moves
on a rename and would answer a different question. There is a test for exactly
that. The cost is `null` for a document never edited through this endpoint,
which is honest rather than convenient.
