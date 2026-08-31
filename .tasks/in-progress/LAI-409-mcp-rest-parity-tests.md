---
id: LAI-409
title: Parity tests — an MCP tool and its REST twin write identical activity
area: server
assignee: core
priority: p1
depends-on: [LAI-407, LAI-408]
discovered-from:
status: in-progress
started: 2026-09-01T09:00:00Z
---

## Goal

SPEC §13.3 requires **parity tests asserting an MCP tool and its REST twin
produce identical `activity` rows** — for the nine tools that have a twin;
`log_unlisted_work` is exempt and §7.2 says why.

This is the guard that makes MCP parity structural rather than aspirational. The
layering rules already make divergence hard: routes and tools can each only
reach data through `services/`. This test is what proves the property actually
holds, and goes red the day someone adds a second path.

M3's exit criterion is an agent picking up a task and working it, **visible live
in a human's browser**. That is exactly what parity means.

## Acceptance criteria

- [ ] One test per twinned tool — nine pairs. Each performs the same logical
      action twice against a clean database, once over REST and once over MCP,
      and asserts the resulting `activity` rows are identical **except** for
      `actor_kind`, `token_id`, `id` and `created_at`.
- [ ] The exempt tenth, `log_unlisted_work`, is named in an **exemption list with
      its reason and D-024 cited** — not silently absent. A missing pair must
      read as intended rather than as a gap.
- [ ] **The exemption self-expires**: if a REST twin for `log_unlisted_work` ever
      appears, the test fails and tells the reader to remove the entry. This repo
      has done this four times (LAI-052, LAI-080, LAI-043, LAI-213) — follow the
      same shape.
- [ ] The pair list is **derived, not hand-written**: the test enumerates the
      registered MCP tools and fails when a tool exists with neither a twin nor
      an exemption. A tool added in six months is covered without anyone
      remembering to add it here.
- [ ] The same comparison covers the emitted SSE event, not only the stored row.
- [ ] **Prove the guard can fail.** Change one tool to write a different verb,
      confirm the test goes red and names the tool, then revert. Put the failure
      message in your task log — a guard that cannot fail is not a guard.
- [ ] Full gate green.

## Notes

No new dependencies.

If parity turns out to be impossible for a pair for a real reason, **do not
weaken the test** — stop, write down the reason, and file a task. A parity test
with a quiet exception is worse than no parity test, because it reads as proof.
