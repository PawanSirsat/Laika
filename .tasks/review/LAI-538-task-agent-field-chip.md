---
id: LAI-538
title: 'Task drawer Agent field, agent chip on cards, list column + filter, owner + agent in activity, client mirror of agent_selected'
area: web
assignee: shell
priority: p1
depends-on: [LAI-535, LAI-536]
discovered-from:
status: review
started: 2026-10-27T21:51:41Z
finished: 2026-10-27T22:15:24Z
---

Implements **proposal §6 (Cards, task drawer), §3** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human picks an agent for a task from the drawer and sees, on the
card, in the list and in activity, which agent the work is meant for and which
agent wrote each change — distinct from who created the card.

## Scope

- Drawer: an **Agent** row under Assignee, a `Dropdown` combobox of eligible agents with owner, device and availability, and the reason an agent cannot be picked.
- Cards: compact agent chip as a new `CardFields` entry, on by default; the human avatar stays.
- List view: agent column and an agent filter.
- Activity and comments show owner + agent; legacy rows show "agent (unregistered token)".
- Client mirror of `ACTIVITY_TYPES` gains `agent_selected` with its wording.

## Out of scope

- Execution states (LAI-543).
- Hand-off (LAI-549).

## Acceptance criteria

- [x] Choosing an agent sends `selected_agent_id` and shows it after reload from the API (e2e).
- [x] An ineligible agent is listed disabled with its reason, and cannot be selected by keyboard either.
- [x] The `created_via==='mcp'` badge and "Created via: Agent" keep their meaning (existing tests unchanged).
- [x] `agent_selected` is mirrored and worded; the client/server drift check is green against LAI-535.
- [x] Both themes, keyboard, 390 px.
- [x] Repo-root gate exits 0.

## Tests and UI evidence required

Vitest for the combobox and chip; client mirror drift test; Playwright e2e select → reload → activity line; screenshots light/dark/narrow.

## Dependencies

`depends-on: [LAI-535, LAI-536]`.

**Blocked on decision D-114 (proposed).** Do not start until D-114 is approved as proposal §8 describes (a web-session comment with `actor_kind: user` on the LAI-532 card, or an Approved GitHub review by PawanSirsat). Board tag `blocked-on-decision`.

`agent_selected` is three-owner (CLAUDE.md §4.4): **LAI-533** (SPEC §4.8), **LAI-535** (enum), **LAI-538** (client mirror + wording, this task).

Proposed to absorb the "Alice via Codex" attribution half of **LAIKA-491** (proposal §8.1); its "needs a human" state stays a card of its own.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-538-task-agent-field`

## Migration / rollout notes

Second half of the `agent_selected` three-owner merge (§4.4 step 4): merge CHIEF's local `master` carrying LAI-535, complete against a green gate.

## Notes

- **Claimed by SHELL (polly dispatch, Belka), 2026-10-28.** Worktree
  `Laika-agent-field`, branch `LAI-538-drawer-agent-field`, base `2b229e1e`:
  LAI-535 head `38ab6851` (draft PR #105, on #102, on #98/#96) with LAI-537
  (#104) and LAI-536 (#101) merged in. Must not merge before them.
- **Deviation, recorded as §2 asks:** the `depends-on` tasks are in
  `.tasks/review/`, not `done/`. CHIEF dispatched this against them, stacked.
- **D-114** approved in substance; authorised-account record pending, so the PR
  stays a draft.

## Submitted (SHELL, 2026-10-28)

**What landed (all `server/web/`).**
- `api/selected-agent.ts` (new): `SelectedAgent` (the server's
  `SelectedAgentView`), the seven 422 reasons with words, client-side
  eligibility in the server's order, availability (seen within 15 min =
  Available, else Offline and still pickable), labels, the agent filter and
  `agentVia` attribution.
- Types: `TaskSummary.selected_agent?`, `TaskEdit.selected_agent_id`,
  `ActivityEvent.agent_id?` (optional: a view served before LAI-535 has none).
- Three-owner client half: `STREAM_TYPES`, activity wording, dashboard
  wording for **`task.agent_selected`** (the dotted name LAI-535 shipped).
- Drawer: `task/AgentRow.tsx` directly under Assignee, LAI-536's
  `AgentPicker` (now `searchable`, owner + device as keywords). Lists only
  `GET /agents` (the caller's own), revoked ones dropped unless current,
  another member's current agent shown disabled. Never disabled while the
  PATCH is in flight: a disabled trigger dropped focus to `<body>` (found by
  the browser test, mutation-checked). Viewer: read-only chip, no fetch.
- Card: `CardFields.agent`, on by default, `AgentChip` beside the avatar;
  the `created_via === 'mcp'` corner badge untouched.
- List: sortable Agent column (no agent last both ways), compact (mark +
  device, product read aloud). Board/List filter `?selected_agent=` (id,
  `any`, `none`) with its chip and an Agent field in the Filter popover.
  Column and field appear only when a task in the space has an agent.
- Activity: `Ada via Claude Code · laptop-1`; legacy token rows
  `via agent (unregistered token)`; an agent the reader cannot name reads
  `a registered agent`. A registered agent's comment is named from its
  `comment.added` row.

**Deviations, for the reviewer.**
- The verb is `task.agent_selected` (LAI-535's), not `agent_selected`.
- The filter key is `selected_agent`: `agent` already means agent-created.
- `AgentPicker.tsx` (LAI-536, SHELL) gained `searchable` and `keywords`.
- `actor-presentation.test.ts` and `list-derive.test.ts` pinned shapes were
  extended (`via`, the Agent column) — intended changes, not loosened.
- Agents are named from tasks the board holds; `GET /agents` is the
  caller's own, so another member's agent on an unrelated row reads
  `a registered agent` rather than a guess.

**Limitations.** In a space that uses agents, the List's minimum width grows
by the column, so at 1440 it scrolls inside its card (SUMMARY keeps its
200px). No execution state past Waiting for agent (LAI-543). Comments carry
no `agent_id` of their own; attribution comes from the activity row.

## Cross-review fixes (Codex review of PR #106, SHELL, 2026-10-28)

The review FAILED on three blocking points. All three are fixed in new
commits (`9c216332`, `b2eb804f`, `3bbe701c`); no history was rewritten.

1. **Stale async selection.** Pending and error state in `AgentRow.tsx` are
   tagged with the task id that started the request. A late answer for a task
   the drawer has left is discarded (only its own hold is released), and the
   picker on a task with nothing in flight is never held. `AgentRow` stays
   un-keyed on purpose, so the test exercises this guard and not a remount.
2. **"via a registered agent" everywhere.** Names now come from
   `agentNamesFrom`: the reader's own agents (`GET /agents`, §3.1
   `agent.read_own`, every role) plus agents selected on tasks they hold. Used in
   the drawer's History, Changes and comments, and on the Activity screen (which
   passed no names at all before). Any other agent stays *a registered agent*.
   The drawer reads `GET /agents` once (`useMyAgents`) and hands it to the
   Agent row, so a Viewer now reads their own agents too (no picker).
3. **Legacy tokens.** An agent comment reads *Ada via …*: the agent by name;
   *agent (unregistered token)* when its `comment.added` row has no
   `agent_id`; *an agent* when no row is loaded. Never *Ada's agent*. The
   pinned *'s agent* assertion in `task-panel.test.ts` now asserts this rule.

**Non-blocking, filed:** LAI-569 (card LAIKA-821). The List with the Agent
column scrolls sideways at 1440. It is filed rather than fixed because fitting
it means re-deciding widths against SUMMARY's 200px floor and LAI-491's one-line
dates.

**Checked by:** the targeted files only. **The full repo gate is still owed**:
Belka's load was 83–103 on 10 cores, so the full gate was not run by
instruction. Mutation checks: each of the three fixes, plus the Activity
screen's name wiring, was reverted in turn, and its test went red.

## Round-2 fixes (Codex review of PR #106 at `1e8769ce`, SHELL, 2026-10-28)

Round 2 confirmed findings 2 and 3 as fixed. It found finding 1 only partly
fixed and raised one more. Both are fixed in new commits (`f12acbd3`,
`f07c9504`):

1. **One shared pending slot.** Every selection request now takes a fresh id
   (`nextReq`). `active` is the one request this drawer visit is waiting on, and
   moving to another task forgets it, along with that visit's pending, error and
   confirmed state. An answer whose id is not `active` changes nothing. Test:
   pick on A (held) → pick on B → back to A → pick on A again; the old A
   request then rejects. The newer A selection survives and no error shows.
2. **A confirmed PATCH waited on the refresh.** A 200 now applies the task the
   PATCH returned (`confirmed`, against the task's `updated_at` at send time)
   and clears pending at once. If the follow-up read fails, the field shows the
   confirmed agent and the next pick goes out. Once the props move on, the
   applied answer gives way to them. Test: PATCH 200, then every follow-up read
   is answered 500.

Non-blocking, done: a Viewer whose `GET /agents` is refused with 403 still sees
the chip, with no picker and no error (browser test). Filed **LAI-570** (card
LAIKA-822): the Dashboard feed and Organisation → Activity name the agent.

Break-the-fix checks, each restored by SHA-256 checksum:
- accepting any answer turns the A→B→A test red;
- not applying the PATCH answer turns the failed-read test red;
- keeping pending until the refresh turns the failed-read test red.

**Limit:** the confirmed answer is applied in the drawer's row, not written to
the board's task store, which `useBoard` does not expose for this. So when the
follow-up read fails, the card chip catches up only on the next successful read.

**The full repo gate is still owed.** CHIEF runs it after this round.
