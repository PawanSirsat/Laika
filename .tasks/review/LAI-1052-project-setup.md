---
id: LAI-1052
title: 'Developer access V3 slice D2: Project setup — access check, revision-2 block, the real flow'
area: shell
assignee: shell/belka
priority: p1
depends-on: [LAI-1048]
discovered-from: LAI-1042
status: review
started: 2026-11-02T03:47:13+05:30
finished: 2026-11-02T04:15:48+05:30
---

## Why

Slice D2 of the Developer Access V3 plan
(`docs/proposals/LAI-1042-developer-access-v3-plan.md` §B.4, §E.5, §G, §H,
§K): the owner's highest-priority flow. Stacked on LAI-1048 (PR #206), which
re-hosted the classic Projects card under *Project setup*; this replaces that
with the real flow.

**Multi-owner (CLAUDE.md §4.4), one PR.** Named cross-area edits:

- `server/src/services/agent-project-access.ts` (new), one route line in
  `server/src/http/routes/agents.ts`, `export` on `requireOwnAgent` in
  `server/src/services/agents.ts`, and a new test
  `server/test/http/routes/agent-project-access.test.ts` (CORE's area).
- `docs/SPEC.md` §6.4: one endpoint row for
  `GET /api/v1/agents/:id/project-access` (CHIEF's area).

Not touched: the pairing builder's files (LAI-1050) or `laika update`
(LAI-1051).

## Acceptance criteria

- [x] `GET /api/v1/agents/:id/project-access?project=<slug>`, signed-in web
      session only, the owner's own agent only: returns the project, the
      owner's membership (role, can read, can write) and the agent's grant
      (`read_only` | `full` | none) **as separate fields**, the effective
      access (the intersection, rule unchanged), and `can_grant.max` — a
      viewer may grant at most `read_only`.
- [x] Another owner's agent, a missing agent, and a project the owner cannot
      read each answer `404`, the agent cases byte-identical.
- [x] Grants change one project at a time through the existing
      `PUT /agents/:id/grants` (no new grant endpoint); the other projects'
      grants are kept.
- [x] Revision-2 instructions block: `BLOCK_MARKER` line byte-identical,
      `laika:begin revision=2 project=<slug>` / `laika:end` markers, a
      `PROJECT_BLOCK_REVISION` distinct from `context_revision`; a pure
      `replaceLaikaBlock` replaces only between markers (or the revision-1
      section) and leaves the rest of the file byte-identical.
- [x] The V3 prompt tells the tool to inspect, append or replace only the
      Laika block, show a diff, preserve human edits, never add a token,
      never commit, never reinstall; repo MCP config is a separate step; the
      block is optional except under the *Only repos set up for Laika*
      activity scope. Zero secrets (`lai_` and the token placeholder absent).
- [x] Classic `projectBlock` / `projectPrompt` and the classic Projects tab
      are byte-for-byte unchanged.
- [x] Web (v3, and preview by link): choose project → choose one of my
      connected tools (labels from the catalog, no hard-coded counts) → access
      shown as two facts with a No access / Read only / Full selector when I
      may grant → tool-specific prompt from `instructionsTarget()` → an
      *I've added it* confirmation labelled self-reported, never verified.
      Overview's *Set up a project* lands here.
- [x] *Update available* only from a recorded revision; with none, says so
      and names `laika project check` as coming, not working.
- [x] States: no tools (→ Add tool), no projects, loading, error, 403,
      viewer read-only. Keyboard, focus return, aria-live, both themes,
      390 px. Screenshots in `.polly/evidence/LAI-1052/`.
