---
id: LAI-408
title: The six MCP write tools
area: server
assignee: core
priority: p1
depends-on: [LAI-406, LAI-405]
discovered-from:
status: review
started: 2026-08-31T13:20:00Z
finished: 2026-08-31T13:55:00Z
---

## Goal

The six tools that let an agent actually work the board: `create_task`,
`start_working`, `update_status`, `add_comment`, `finish_task`,
`log_unlisted_work` (SPEC §7.1).

Each writes the **same `activity` row its REST twin writes**, with
`actor_kind: 'agent'`, and emits the same SSE event — which is what makes an
agent's work appear live in a human's browser. That property is what LAI-409
tests; build for it.

## The tools (SPEC §7.1)

| Tool | Input | Returns |
| --- | --- | --- |
| `create_task` | `{ project, title, description?, priority?, depends_on?, discovered_from? }` | created task, `created_via: 'mcp'` |
| `start_working` | `{ task, branch? }` | task, or `409` with the current assignee |
| `update_status` | `{ task, status, note? }` | task; validated transition |
| `add_comment` | `{ task, body }` | comment |
| `finish_task` | `{ task, summary, checklist? }` | task → **`review`**, summary posted as a comment |
| `log_unlisted_work` | `{ repo, note }` | records work or an idea outside any project, for triage |

## Acceptance criteria

- [x] Each tool is a thin wrapper over the service its REST twin uses. **No
      second write path exists for any of them** — if a service does not expose
      what a tool needs, extend the service, do not reach past it.
- [x] **Guardrail: tools never bulk-mutate. One task per call** (SPEC §7.2). A
      test passes an array where a single id is expected and expects rejection.
- [x] `finish_task` moves the task to **`review`** and no further. Agents do not
      close their own work. The summary is posted as a comment by the same actor.
- [x] `start_working` on an already-claimed task returns `conflict` **naming the
      current assignee**, not a bare failure.
- [x] `update_status` validates the transition against SPEC §5, using the same
      lifecycle module the REST route uses.
- [x] `create_task` sets `created_via: 'mcp'`.
- [x] `log_unlisted_work` writes an `unlisted_work` row against the token's user
      and the token id, and one `unlisted.logged` activity row with
      `project_id IS NULL`. It is **deliberately the one tool with no REST twin**
      (D-024) — do not invent one.
- [x] Every tool calls `can()` as the token's user before writing anything. A
      `read_only` token is denied all six.
- [x] Every write emits the SSE event its REST twin emits, so an agent's action
      appears live in an open browser. Test it through the real stream.
- [x] Unknown input fields rejected; errors carry the §6.3 `code`.
- [x] Full gate green.

## Notes

No new dependencies beyond LAI-406's SDK.

`log_unlisted_work` depends on LAI-405 for the table's service, not for a REST
twin it does not have.

## Notes back — CORE, 2026-08-31

**One half of this task is CHIEF's and is not on this branch.** §3.1 had no cell
for logging unlisted work, so `can()` had nothing to call. CHIEF wrote the row —
*"Log own unlisted work | ✓ | ✓ | ✓ | ✓ (`read_only` forced)"* — and applies it
to `docs/SPEC.md` in the merge commit. I built `unlisted.log_own` against the row
as quoted.

`ACTIONS_WITHOUT_A_ROW` carries **one entry for one merge**, which is the
mechanism that map exists for. I proved it self-expires rather than asserting it:
exempted `audit_log.export` — an action §3.1 *does* grant — watched the staleness
test fire, reverted. Done with my own file; `docs/SPEC.md` is not mine to touch
even temporarily.

**The Viewer cell is ✓ and the reason matters.** The restriction comes from the
**credential**, not the role. `can.test.ts` asserts both halves, because a
role-level ✓ looks like a Viewer gaining a write until you see that their token
is forced `read_only`. If that forcing were relaxed, that test goes red and says
what changed.

**Two things worth a reviewer's eye:**

1. **The error mapping is a `try` per handler, not a wrapper.** I built the
   wrapper first and it breaks the SDK's contextual typing of handler arguments —
   every destructured param became an implicit `any`. A shared wrapper that costs
   type safety is a bad trade. The guard against forgetting one is a test that
   every tool returns a §6.3 envelope on refusal.
2. **No tool emits an SSE event, deliberately.** `activity-feed.ts` polls the
   `activity` table, so a tool's row becomes an event exactly as a route's does —
   there is no second step to omit. Tested through a real stream anyway, because
   it is a design fact I am relying on.

**M3's exit criterion is demonstrated, not inferred.** With a browser-shaped SSE
client watching `?project=core` on the built server, an agent's `create_task`
produced `event: task.created` carrying `"actor_kind":"agent"` and the token id.
