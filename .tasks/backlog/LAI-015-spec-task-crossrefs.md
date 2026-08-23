---
id: LAI-015
title: SPEC.md was rewritten — every task file's spec cross-reference now dangles
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-001
status: backlog
---

## Goal

`docs/SPEC.md` was replaced (commit `7b98665`) with a shorter
"implementation-grade" v1 running `§1`–`§8`. The previous document ran `§1`–`§13`,
and **every task file in `.tasks/` cites the old numbering**. A builder opening
LAI-002 is told to read "SPEC §10.2, §10.4, §6.3" — none of which exist any more.
Worse, several field names the tasks name are gone too, so the tasks and the spec
now disagree about the data model, not just about section numbers.

Until this is reconciled, builders are guessing which document is authoritative.

## Acceptance criteria

- [ ] Decide and state, in `docs/SPEC.md` itself, which document is authoritative
      for M1–M7.
- [ ] Every `SPEC §x.y` reference in `.tasks/**` resolves to a real heading in the
      current `docs/SPEC.md`, or is removed.
- [ ] The naming conflicts below are resolved in one direction, in both the spec
      and the task files that depend on them.
- [ ] `docs/DECISIONS.md` records the rewrite and the resolution, so the next
      person does not re-litigate it.

## Notes / context

Dangling references found while working LAI-001 (not exhaustive):

| Task | Cites | Status in current SPEC |
| --- | --- | --- |
| LAI-002 | §10.1, §10.2, §10.4, §6.3 | gone — middleware order and the error envelope are not in the new spec at all |
| LAI-003 | §4, §4.5, §4.11 | §1 is the data model now; **§4.11 "Indexes that must exist" has no successor** |
| LAI-004 | §3.1, §3.2 | permission matrix is §2; the `can()` contract text is gone |
| LAI-005 | §6.1, §10.3, D-004 | gone |
| LAI-006 | §6.3, §12.2 | gone — conventions/errors/logging have no successor |
| LAI-007 | §10.4 | gone |
| LAI-008 | §10.7 | gone |
| LAI-010 | §4.3, §4.4, §6.4 | renumbered |
| LAI-011 | §4.5, §5, §6.4 | **§5 "Task lifecycle" has no successor — LAI-011 says "read §5 before implementing transitions" and there is nothing to read** |

Substantive conflicts, not just numbering:

- **Project identity.** LAI-010 requires "a unique uppercase `key` per org"; the
  current spec's `projects` table has `slug` and no `key`.
- **Signup mode.** LAI-005 and LAI-009 require `orgs.signup_mode` with value
  `invite_only`; the current spec has `org.invite_only` as an integer flag.
- **Roles.** LAI-004 expects a per-project membership role resolved against org
  role; the current spec keeps `users.org_role` *and* `project_memberships.role`,
  with a constraint ("a user with org_role 'viewer' may only hold project role
  'viewer'") that the old §3.1 matrix did not state.
- **Task lifecycle.** Statuses differ: current spec has
  `backlog|todo|in_progress|review|done|cancelled`; LAI-011's `ready` derivation
  says "`backlog` + unassigned + all dependencies done", which ignores `todo`.
  The MCP `list_ready_tasks` in the current spec says `todo` **or** `backlog`.
- **Indexes.** LAI-003 requires "every index in SPEC §4.11". There is no index
  list in the current spec, so that criterion is currently unverifiable.
- **Error envelope.** LAI-002/LAI-006 require
  `{"error":{"code","message","details"}}`; the current spec §3 says
  `{ error: { code, message } }` — no `details`.

This is PM's call, not a builder's. Builders should not silently pick a side.

No new dependencies.

---

## Update — builder-a, after the spec merge (`e78d10f`)

PM merged the two specs into one 711-line document with 14 sections. That fixed
the **missing** content — §5 *Task lifecycle*, §6.3 *Conventions*, §11 *Stack and
runtime*, §13 *Cross-cutting* and an index list all exist again. It did **not**
fix the cross-references, and it made the failure mode worse: numbering shifted
by one from §9 onward, so several citations now resolve to a **real but wrong**
section instead of failing loudly.

| Task cites | Meant | Now resolves to | |
| --- | --- | --- | --- |
| LAI-002 §10.1, §10.2, §10.4 | One process / Hono middleware / Frontend | §10 is *Webhooks and the meeting diff* | **silently wrong** |
| LAI-003 §4.11 "Indexes that must exist" | the index list | §4.11 is now `invites`; the list moved to **§4.13** | **silently wrong** |
| LAI-005 §10.3 | Persistence — SQLite + Drizzle | §11.3 | **silently wrong** |
| LAI-007 §10.4 | Frontend — React + Vite | §11.4 | **silently wrong** |
| LAI-008 §10.7 | Deployment — one image | §11.7 | **silently wrong** |
| LAI-006 §12.2 | Errors and logging | §13.2 | **silently wrong** |
| LAI-004 §3.1, §3.2 | matrix + `can()` contract | §3.1/§3.2 are now *org-level* and *project-level* matrices; the `can()` contract is **§3.3** | partially wrong |
| LAI-002/LAI-006 §6.3 | Conventions | §6.3 | correct |
| LAI-011 §5 | Task lifecycle | §5 | correct |

A citation that lands on the wrong real section is more dangerous than one that
lands on nothing — a builder following LAI-003 to "§4.11" now reads the `invites`
table and has no signal that they are in the wrong place.

The substantive field-name conflicts listed above still need checking against the
merged spec; this update only re-checked the numbering.

Raising the priority case: this is now a **p1** blocker for LAI-002 and LAI-003,
which are the next two tasks to be claimed.
