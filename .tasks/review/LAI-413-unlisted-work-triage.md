---
id: LAI-413
title: Triage unlisted work — promote or dismiss
area: web
assignee: shell
priority: p2
depends-on: [LAI-405]
discovered-from:
status: review
started: 2026-08-31T21:51:33Z
finished: 2026-09-01T03:55:00Z
---

## Goal

`log_unlisted_work` is how an agent records something it noticed outside any
project. Without a screen, those rows accumulate where nobody looks, and the one
tool with no REST twin becomes a write-only hole.

Lives under `REVIEW` in the sidebar — it is a queue a human works through.

## Acceptance criteria

- [x] Lists `GET /api/v1/unlisted`: repo, note, who logged it, when. Paginated.
      Filters for `?user=` and `?since=`.
- [x] Promote opens a form for `project_slug`, `title` and optional `priority`,
      calls `POST /unlisted/:id/promote`, and on success **links to the created
      task**. A promotion that gives no way to reach its result is a dead end.
- [x] Dismiss removes the row from the default list, with confirmation and an
      undo path or a filter that can find dismissed rows again. Dismissing is not
      deleting.
- [x] A row already promoted shows its task rather than offering promote again —
      the server returns `409` for a second attempt, and the UI should not walk
      the user into it.
- [x] Someone without `audit_log.export` never sees the nav entry. **Absent, not
      disabled** — LAI-082 settled that for the whole sidebar; follow it.
- [x] Empty state says what this queue is and why it is empty, in the product's
      own words. Empty is the normal state until agents are running.
- [x] Both themes. Rendered in a real browser.
- [x] Full gate green.

## Notes

No new dependencies. No demo module — LAI-405 delivers the endpoints (D-032).

---

## Build note — SHELL, 2026-09-01

### The nav had no concept of permissions, so it gained one

AC5 could not be met by the sidebar as it stood: `routesInGroup` filtered on
"has a screen" and nothing else. A `Route` may now carry
`requires: 'audit_log.export'`, and `routesInGroup` / `navRoutes` take a
`holds(permission)` predicate the shell builds from the actor's role.

**It names a policy action, not a role.** `audit_log.export` is admin-up today;
writing `requiresAdmin` would have hard-coded that beside a rule which can
change. `mayTriageUnlisted` mirrors `policy/can.ts` in one place, and the
sidebar and the screen both use it rather than each keeping a copy.

**The dangerous default is visible, so the default is hidden.** A caller that
forgets to pass `holds` gets the entry *omitted*, not revealed — every endpoint
behind it answers `403` anyway, so showing it can only mislead. There is a test
for exactly that, because it is the mistake this design invites.

### A second over-specific guard, same shape as LAI-423

`nav-truth.test.ts` asserted the sidebar skips empty groups by matching
`routesInGroup(group)` **verbatim**. Adding the permission argument failed it
while the behaviour was unchanged — the assertion pinned one spelling rather
than the property. Widened to `routesInGroup(group…)`, exactly as
`href={route.path}` was widened in LAI-423. That is twice in the same file's
family; worth watching for a third.

### Measured, as owner and as viewer

| | result |
| --- | --- |
| owner nav | `Unlisted work` present, between Dashboard and Tokens |
| default list | 2 pending; the dismissed row hidden |
| show dismissed | 3 rows, and the dismissed one offers **no** promote |
| promote | created **LAI-18**; row became `promoted`, link reads `Open LAI-18` |
| promoted row | promote no longer offered — the server's `409` is never reached |
| **viewer nav** | **absent**, and `GET /unlisted` answers `403` for her |
| both themes | rows and the promotion link correct in each |

### The `mira-cli` placeholder

Changed to `my-laptop` in `TokensScreen`, as CHIEF asked while the area was
open. It borrowed the mockup's persona, which CLAUDE.md §5.1 names as a fixture.
Recorded here rather than done silently, since it is a change outside this
task's stated scope — revert it if you would rather it were its own commit.
