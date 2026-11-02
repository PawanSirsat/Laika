---
id: LAI-1066
title: 'Project setup evidence: server records of a repo''s Laika block, and `laika project check`'
area: server
assignee: polly
priority: p2
depends-on: []
discovered-from: LAI-1042
status: in-progress
started: 2026-11-02T07:10:00+05:30
---

## Why

Developer access V3 (plan `docs/proposals/LAI-1042-developer-access-v3-plan.md`
§D.2 item 6, §E.5, §F.7, §G, §H, §K). The Project setup tab (#209, LAI-1052)
records *I've added it* in the browser only, and says `laika project check`
"is not available yet". This slice makes the record the board's, adds the
local check that produces verified evidence, and grounds *Update available*
in a record.

Multi-owner (CLAUDE.md §4.4), one PR, named cross-area edits (D-033):
`server/` (CORE), `cli/` and `server/web/` (SHELL), and SPEC §4 / §6.4 (CHIEF):
a new **§4.82 `project_repo_setups`** and two **§6.4** endpoint rows.

## Acceptance criteria

- [ ] **Migration 0073** adds `project_repo_setups`, additive only (no table
      rebuilt), with owner, nullable `agent_id`, project, a repo key (a hash)
      and a display label — never a local path — the template revision found,
      block / project / prefix flags, `source`
      (`self_reported_browser` | `local_check`) and a nullable `checked_at`.
      Template revision is never named or stored as `context_revision`.
- [ ] `POST /api/v1/project-setups`: the owner signed in (browser record) or
      that owner's registered agent token (`local_check`, agent from the token,
      only for a project it may read); personal tokens refused; another owner's
      agent or an unreadable project is the same `404` as one that does not
      exist; `can()` on every path; no activity verb; `checked_at` null while
      presence is off.
- [ ] `GET /api/v1/project-setups?project=&agent_id=`: own rows only; an agent
      token reads its own; another owner's agent id is the identical `404`.
- [ ] `laika project check [--project <slug>] [--dir <repo>] [--harness <h>]
      [--label <name>] [--offline] [--json]`: reads the harness's instructions
      file(s) locally, detects marked (`laika:begin revision=N project=…` /
      `laika:end`) and legacy marker-only blocks, prints only a summary, never
      writes a file, records with the agent credential when present (else
      prints only), sends no content and no absolute path, works offline.
      Exit codes documented in the module and `--help`.
- [ ] Web Project setup tab: the browser-local record is replaced by server
      records; *Checked by laika project check on <device> at <time>* is
      distinct from *Recorded by you — not verified*; *Update available* only
      from a record with an older revision or a project/prefix mismatch; no
      record says so and shows `laika project check`; presence off shows no
      times. Classic screens untouched.
- [ ] SPEC §4.82 and §6.4 rows; drift and coverage tests green.
- [ ] Tests: migration additive/idempotent; other-owner 404; agent records
      only for its owner's granted projects; CLI detects every block shape and
      never writes; no secret or path leaves the machine; web statuses from
      records.

## Notes

- PR #216 (LAI-1062) makes `features.project_setups` derive from
  `FEATURE_ROUTES`. It is not merged at filing time; once it is, these routes
  join `FEATURE_ROUTES['project_setups']`.
