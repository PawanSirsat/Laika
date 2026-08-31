---
id: LAI-408
title: The six MCP write tools
area: server
assignee: core
priority: p1
depends-on: [LAI-406, LAI-405]
discovered-from:
status: done
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

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** All six write tools. Three mutations, three reds, each
landed-checked: `finish_task` closing instead of stopping at review,
`isReadAction` returning true for everything (six reds including *"is refused to
a read_only token, though the role allows it"*), and the earlier ready-filter
check still holding.

**Landed as one commit with both halves**, per D-038: the SPEC §3.1 row
(`Log own unlisted work`), the `unlisted.log_own` action, and the `ORG_ROWS`
mapping that ties them together. Neither half was committable alone — the
staleness check fires on a mapping whose row is absent, and the row without the
action turns the drift guard red.

### The exemption was the best this repo has had

It named the row, who wrote it, the merge that retires it, and said *"this entry
exists for one merge, not as a design decision"*. And it was **proved** to
self-expire by exempting `audit_log.export` and watching the staleness test fire
— using CORE's own file for the measurement, because `docs/SPEC.md` is not
theirs to touch even temporarily. It retired itself on this merge exactly as
written.

### The qualifier guard is the better of the two

I had not met it before. **A cell that narrows a permission in prose is a
permission nobody checks** — that is a stronger idea than the exemption list,
which only catches an action with no row at all. My `✓ (read_only forced, so
never in practice)` had to be registered with something that verifies it, and
the `verify` asserts two things the pair does not imply: `forcedTokenScope`
itself, without which the assertion would hold for a Viewer who merely *asked*
for a read-only token, and that a member's `full` token *can* perform it — so
this is not an action nobody can do.

Verifying the qualifier key by feeding the row to `parseMatrix` synthetically —
rather than guessing the string — is what stopped that guard firing on me at
merge instead. It failed twice first, both times the scratch test's own fault.
*"A throwaway verification is exactly where one stops reading carefully."*

### M3's exit criterion is demonstrated, not inferred

A real MCP client, a browser-shaped SSE client, and `event: task.created`
carrying `"actor_kind":"agent"` and the token id. The row alone would not have
established *"visible live in a human's browser"*.

### Two findings worth keeping

**The wrapper.** *"Wrap it once rather than repeat a `try`" is usually right, and
is wrong when the wrapped function's parameter types come from its call site.* A
shared wrapper broke the SDK's contextual typing and made every destructured
param an implicit `any`. One `try` each, with a test asserting every tool returns
a §6.3 envelope on refusal as the guard against forgetting one.

**Breaking their own LAI-407 assertion.** `not.toContain('create_task')` was true
when LAI-407 shipped and this task made it false by doing its job — one task
after CORE argued the identical point to me about `not.toContain('token.created')`.
Rewritten as the property it was reaching for. *"Recognising the pattern in
review is evidently much easier than not writing it"* is why D-037 says to ask
what makes an assertion false **before** writing it.
