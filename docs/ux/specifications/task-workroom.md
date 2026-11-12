# Specification: Task Workroom

**Phase C (proposal over evidence).** The task becomes a workroom: one
component tree rendered as a **drawer** (quick look over any space view) and
as a **full route `/task/:key`** (three panels). UI-only except where marked.
Basis `9ac3be1f`. Sections tag **(a) existing**, **(b) UI-only**, **(c) needs
backend**.

## 1. Scope and what it fixes

- **Fixes:** B1/V1 (empty drawer), B3/B22 (dialog semantics), B4 (Detach),
  B2/B18 (task links, via `useOpenTask`), B19 (create in place), B9 (Accept
  with undo; cmd-click), V7 (agent attribution via `Identity`).
- **Builds:** area navigation, four agent lanes, execution timeline,
  decisions and open questions, evidence while in progress, review checklist,
  round-vs-round compare, resizable panels, focus mode.
- **Runs alongside:** the deliverable design trial
  ([`deliverable-engine.md`](deliverable-engine.md) §2), whose renderer
  findings feed the Workroom's Documents area.
- **Visual rule:** the side panels are **glass level 1**; the **centre
  document is always solid** ([`../design-system/visual-language.md`](../design-system/visual-language.md) §3.2).
- **Prerequisites (Foundation track, proposed):** layer and motion tokens,
  `Dialog` base, `ToastProvider`, `Menu` with Escape layering.

## 2. Drawer, route, or both: both

- **(a) Existing.**
  - `SpaceLayout.tsx:261-270` mounts the drawer frame whenever `?task=` is set.
  - Only `BoardScreen.tsx:1761-1809` fills its slot, through `TaskDrawerContent` (`TaskDrawer.tsx:140-153`, a portal into `#task-drawer-slot`, `:123`). That is bug B1: timeline and calendar open an empty frame.
  - Opening is a pushed history entry (`openTaskInUrl`, `BoardScreen.tsx:869-873`, `setParams(…, {push:true})`, `use-route.ts:16-41`). Closing is a replace, so Back closes the drawer.
  - The route table has no task route. Its only parameterised route is `/spaces/:slug/settings` (`route-table.ts:328`).
  - `taskHref` (`my-day/task-link.ts:16-18`) builds `/board?project=…&task=<id>`, or `/board?q=KEY` when there is no slug (bug B2).

**Recommendation.** Keep the **drawer as the quick look** over any space view. Add a **full route `/task/:key`** as the Workroom. They render the same component tree, only in different frames.

**URL and Back semantics** (all through the existing `useRoute`):

| Action | URL change | History |
|---|---|---|
| Open a card | `?task=<id>` (unchanged) | push; Back closes |
| Drawer "Expand" (⤢) | `navigate('/task/LAI-123')` | push; Back returns to the board *with the drawer open*, because that is the previous entry |
| Switch area | `/task/LAI-123?area=evidence` | **replace**, so Back does not step through tabs |
| Open a document or version | `?area=documents&doc=<id>&v=3` | push, because a reader expects Back to leave a document |
| Jump to a heading | `#h-<slug>` | browser default |
| Focus mode | `?focus=1` | replace, and survives a reload |
| Workroom close (×) | `history.back()` when the previous entry is ours, else `navigate('/board?project=<slug>&task=<id>')` | |
| Cmd-click a card | `href="/task/LAI-123"` | new tab (also fixes B9's cmd-click half) |

- Escape in the Workroom only leaves focus mode or closes an open popover. It never navigates, because a page is not a dialog.
- **Key resolution, to verify.** MCP tools accept `LAI-NNN` / `external_ref`. I did not confirm that `GET /tasks/:id` (`tasks.ts:417`) accepts a key. If it does not, the route needs a key lookup (backend, size S) or a client-side lookup through the project list.

## 3. Splitting `TaskDetailPanel.tsx` (1257 lines) so every view can host it

Today the panel has about 30 props (`:72-166`). All of its reads and derivations sit at `:202-700`, and the JSX is at `:700-1257`.

**Proposed split (UI-only):**

1. **`useTaskWorkroom(slug, taskId)`** gathers everything from `:202-700`:
   - `useTaskDetail` (comments and activity), `useTaskText` (`GET /tasks/:id`), `useTaskHandoffs` (checkpoints and offers);
   - the rounds read, `executionView` / `useClaimClock`, permissions (`holdsProjectAction`, `implicitlyLeads`), and the approve / send-back state.
   - It returns one typed object.
2. **`TaskEnvironment` context** carries slug, statuses, sprints, members, `byId`, me, gates and `agentsAllowed`. **`TaskActions` context** carries `onMove`, `refresh`, `onOpen` and `onReviewDecided`. This replaces about 20 props.
3. **Presentational parts**, in place of the current blocks:
   - `TaskHeader`: breadcrumb, key, overflow menu, close (`:700-806`).
   - `OverviewArea`: title `InlineEdit` (`:815`), `DeliversPanel` (`:843`), `StateHero` (`:858`), Description `DocumentField` (`:914`), Acceptance (`:1023`).
   - `EvidenceArea` (`:1083`).
   - `DiscussionArea` (`ActivityFeed`, `:1097`).
   - `TaskRail`: `TaskMeta`, plus `LinksCard` and `EstimateCard` as slots (`:1118`).
   - `ExecutionArea`: `ExecutionPanel` + `HandoffSection` (`:1194-1250`).
   - `ReviewActions`: approve, send back, `SendBackDialog` (`:901`).
4. **`TaskDrawerHost`** moves into `SpaceLayout`, replacing the bare `TaskDrawer` at `:261-270`.
   - It renders the frame **and** its content.
   - A screen with a live store (Board, List) registers its `TaskSummary` source through a `TaskSourceProvider`, so the board keeps its live copy and avoids a second fetch.
   - Every other screen falls back to the host's own reads: `GET /tasks/:id`, plus the project's statuses, sprints and members.
   - **This fixes B1 for timeline, calendar, sprints and list in one place.**
   - `TaskDrawerContent` and the board's block at `BoardScreen.tsx:1752-1809` are then deleted.
5. **Dialog semantics (B3).** The drawer becomes `role="dialog" aria-modal="true" aria-labelledby={titleId}` and uses the existing `useDialogFocus` trap. `OverflowMenu` must call `preventDefault()` on Escape, because `TaskDrawer.tsx:85-92` already ignores Escapes that were consumed.
6. `/task/:key` renders `<Workroom>`, which uses the same hook and parts in the three-panel frame.

## 4. Areas: what feeds each, and what is missing

| Area | (a) Existing component → endpoint | (b) UI-only | (c) Needs backend |
|---|---|---|---|
| **Overview** | `StateHero` `TaskDetailPanel.tsx:858` (`heroKind`, `hero-derive.ts:21`); `DeliversPanel` `:843` (`tasks.deliverables/solves/unlocks`, `schema.ts:549-560`); `DocumentField` description `:914`; `TaskMeta` `:1118`. Reads `GET /tasks/:id` (`tasks.ts:417`) and `GET /projects/:slug/tasks` (`:305`) | A section/area nav in place of one long scroll; a "since you last looked" diff from `updated_at` and the activity feed; checklist progress (`acceptance-derive.ts`, `checklistProgress`) as a meter | AI summary (provider exists; model hardcoded); risk model; due/overdue signal |
| **Execution** | `ExecutionPanel` `:1194`, `HandoffSection` `:1229`, `executionView` `execution-derive.ts:384`, `claimHistory` `:257`. Reads the list's live `claim` (`services/tasks.ts:301`), `GET /tasks/:id/checkpoints` (`api/handoffs.ts:124-131`), `GET /tasks/:id/handoff-offers` (`routes/handoffs.ts:141`), activity `?task_id&limit=50` (`api/activity.ts:70-80`) | Checkpoint-by-checkpoint **timeline** (§7); per-run grouping by `claim_generation`; the manifest (paths and line counts) as "files touched" | **`GET /tasks/:id/claims`** (claims history, S); human stop / pause / resume; failure records |
| **Documents** | Description and Acceptance only (`DocumentField`, `:914`, `:1023`). `ContextRevisions.tsx` exists but is project-level (`project_context_revisions`, `schema.ts:1616`) | Render description and acceptance as documents with a table of contents, copy and print (`deliverable-engine.md` §4.4; trial T2, T10); show the project brief read-only with its revision number | First-class deliverable documents (`deliverable-engine.md` §4) |
| **Evidence** | `EvidenceSection` `:1083` (`hideWhenEmpty`) ← `GET /tasks/:id/rounds` (`tasks.ts:513`); `task_evidence` kinds `commit, branch, pull_request, test_run` (`enums.ts:482`), states `claimed, confirmed, failed` (`:491`) | **Evidence while in progress**: show the latest checkpoint's `branch`, `commit_sha`, `verification` and manifest *labelled as a save, not as proof*; an empty state that says "no round yet" instead of hiding the area | Link evidence to deliverable versions |
| **Decisions** | No view. The data is free text: `CheckpointSummary.decisions` and `.open_questions` (`schema.ts:1675-1681`) | List each non-empty `decisions` / `open_questions` per checkpoint, newest first, with provenance (checkpoint id, agent, time, verification). Split on leading `- ` **for display only**; store and show the original text | A structured decisions/questions entity with resolved state, owner and a link to a comment (M) |
| **Discussion** | `ActivityFeed` `:1097` ← `GET /tasks/:id/comments` (`comments.ts:34`), POST (`:61`), PATCH (`:76`), DELETE (`:83`); mentions; `CommentComposer` | Filter chips (comments / agent / system); jump to unread from local last-seen | Anchored comments (`deliverable-engine.md` §4.2; trial T8), human notifications, read/unread on the server |
| **Dependencies** | `LinksCard` (rail) → `DependenciesSection.tsx`, `SubtasksSection.tsx`; `POST`/`DELETE /tasks/:id/dependencies` (`tasks.ts:561`, `:597`); `task.blocks` | A full-width list with each blocker's status, agent state and whether it is on the critical path (from `blocks`); a one-hop graph | none for v1 |
| **Review** | Approve / send back in `StateHero` + `SendBackDialog` `:901`; `mayDecideReview` `hero-derive.ts:297`; `POST /tasks/:id/accept` (`tasks.ts:516`) and `/send-back` (`:520`); `task_reviews` (`schema.ts:2513`); decisions `accepted \| sent_back` (`enums.ts:510`) | Confirm plus undo toast on accept (B9); a review checklist that pairs Acceptance with round evidence; round-to-round comparison of `summary_md` | **Reject** (not a decision value today: needs SPEC + enum + CHECK); **Reopen** from `done` (check the §5 transition table via `POST /:id/status`, `tasks.ts:527`; if allowed it is UI-only); per-deliverable approval |

## 5. Agent states: four separate lanes, none invented

Today the derivations share one strip. The Workroom should show **four lanes**, never mixed together:

| Lane | Meaning | Source today |
|---|---|---|
| **Accountable** | the person who answers for the task | `tasks.assignee_id` (`schema.ts:576`); Assignee row in `TaskMeta` |
| **Requested** | the agent picked to do it, and the open request | `tasks.selected_agent_id` (`schema.ts:663`) as `task.selected_agent` (with `status`). Selecting opens a `work_request` offer (`HANDOFF_KINDS`, `agent-states.ts:146`; `openWorkRequest` `hero-derive.ts:283`). The derived states are `waiting_for_agent` (selected agent `active` and status not started, `execution-derive.ts:116-126`) and `waiting_for_approval` (policy-gated offer) |
| **Executing** | a live claim held by a session | `task.claim` (`TaskLiveClaimView`, `services/tasks.ts:301`) over `task_claims` (`schema.ts:1570`; states `active, paused, released, expired, transferred`, `enums.ts:377`). `working` vs `connection_lost` comes from heartbeat age (`liveConnection`, `execution-derive.ts:92`); session, harness and model from `executionView`. The past claim comes from activity (`claimFactOf` `:165`, `claimHistory` `:257`: `recorded \| expired \| released`). Recovery states come from checkpoints: `recovery_available`, `save_needs_attention`, `verification_pending` (`EXECUTION_STATES`, `agent-states.ts:12-20`) |
| **Outcome** | what was submitted and decided | status `review` plus the latest `task_rounds` row (`schema.ts:2426`, written by `finish`, `tasks.ts:468` / MCP `finish_task` `write-tools.ts:507`); `heroKind` `review \| sent_back \| done` (`hero-derive.ts:21-30`); `task_reviews.decision` |

**Rules:**
- "Assigned to an agent" is never shown. An agent is *selected*, never assigned.
- The `paused` claim state exists in the enum, but I found no UI for it. Show it only once its writer is confirmed.

## 6. Layout

**Three-panel frame at desktop (≥1280):**

```
grid-template-columns: var(--ws-left) 6px minmax(560px,1fr) 6px var(--ws-right)
```

| Panel | Default | Min | Max | Contents |
|---|---|---|---|---|
| Left | 248 | 200 | 360 | area nav, parent/subtasks, related, document outline |
| Centre | flex | 560 | — | document or evidence; reading measure capped at 72ch |
| Right | 320 | 280 | 440 | agent lanes, execution, summary, decisions, risks, checklist, actions |

**Native resizer (no library):**
- **Markup:** `<div role="separator" aria-orientation="vertical" aria-controls="ws-left" aria-valuenow={w} aria-valuemin aria-valuemax aria-label="Resize navigation" tabIndex={0}>`. This follows the WAI-ARIA window-splitter pattern.
- **Pointer:** `pointerdown` → `setPointerCapture`, `pointermove` clamps and is batched with rAF, `pointerup` persists. Double-click resets to the default.
- **Keyboard:** ←/→ ±16px, Shift ±64px, Home/End = min/max, Enter = collapse/expand.
- **Sizing through CSS custom properties** on the grid via the `style` attribute. `style-src-attr 'unsafe-inline'` allows this (`security-headers.ts:79`); no `<style>` injection.
- **Persistence:** `localStorage['laika.workroom.panels.v1'] = {left,right,leftCollapsed,rightCollapsed}`, wrapped in try/catch, clamped on read and on container resize (ResizeObserver).
- **Collapse buttons** carry `aria-expanded` / `aria-controls`. Below 1024 the separators are **unmounted**, not hidden.

**Focus mode:** hides the app sidebar and both panels and keeps the centre plus a slim status strip. `?focus=1`; Escape leaves.

**Scroll rule: no scroll container inside another on the same axis.**
- Desktop: three sibling columns, each `overflow-y:auto; overscroll-behavior:contain`, with no inner vertical scrollers.
- Tables (`md-table-wrap`) and code scroll on x only.
- The activity feed is never height-capped.
- ≤1023px: a single document scroll. Sheets lock body scroll by toggling a class on `<html>`, never by an injected `<style>`.

**Breakpoints** (each named as a constant, which also addresses the breakpoint-token gap):

| Width | Behaviour |
|---|---|
| **390** | One column. Sticky top: key, status pill, compact agent lane ("Working · 4m"). Area switcher as a horizontally scrollable tablist. Sticky bottom action bar (Accept / Send back / Comment). The right panel's content folds into Overview; the outline is a "Contents" button that opens a sheet. The drawer stays a bottom sheet (`drawer.css:126`, 600px). |
| **768** | One column with tabs on top; the right panel is a toggle sheet from the right (`inert` on the rest while open). |
| **1024** | Centre plus the right panel (resizable); the left becomes a 48px icon rail with a pop-over outline. |
| **1280** | Full three panels at defaults. |
| **1440** | As 1280; extra width goes to the centre up to 72ch, then to the right panel. |
| **1600** | Both side panels can reach their max; the centre measure stays capped; a second column (e.g. a version diff) becomes available. |

## 7. Execution timeline (UI-only v1)

Merge four reads client-side, sorted by time and grouped into **runs** by `claim_generation`:

1. **Activity** `?task_id` (`api/activity.ts:70`): claim taken / reclaimed / expired (`claimFactOf`), status moves, deliverable state changes, handoff events.
2. **Checkpoints** (`/tasks/:id/checkpoints`): `created_at`, branch, `commit_sha`, manifest size, the five summary fields, `verification` and `verified_at`.
3. **Rounds** (`/tasks/:id/rounds`): number, `summary_md`, evidence, review decision.
4. **Offers** (`/handoff-offers`): request, approval, accept, cancel.

Each row shows actor, agent, session line, time and a source badge (activity / save / round / offer).

- **Gap:** activity is read 50 at a time, so on a long task the early claims fall off unless the timeline pages through the cursor.
- **Backend (S):** `GET /tasks/:id/claims` returns every `task_claims` row (generation, session, agent, state, lease, `ended_at`). Until then, runs are reconstructed from activity and labelled "from activity".

## 8. Wireframes

**1440:**
```
┌ sidebar ┬───────────────────────────────────────────────────────────────────────────┐
│ WORK    │ ‹ Board  LAI-1123 · Rail polish          [In review ▾] [Focus] [⋯] [×]     │
│ REVIEW  ├────────────┬┬──────────────────────────────────────┬┬─────────────────────┤
│ SETTINGS│ AREAS      ││ ## Overview                          ││ ACCOUNTABLE Pawan S │
│         │ ▸Overview  ││ Delivers  ✓ rail align  ◐ feed line  ││ REQUESTED  shell-cc │
│         │  Execution ││ ┌ StateHero: In review · round 2 ──┐ ││ EXECUTING  — (ended │
│         │  Documents ││ │ 3/4 confirmed · CI ✓ · PR #266   │ ││   claim gen 2, 11m) │
│         │  Evidence  ││ │ [Accept] [Send back]             │ ││ OUTCOME  Round 2 ▸  │
│         │  Decisions ││ └──────────────────────────────────┘ ││─────────────────────│
│         │  Discussion││ ### Description                      ││ DECISIONS (ckpt 3)  │
│         │  Deps (2)  ││  …markdown, 72ch…                    ││ • keep harness once │
│         │  Review    ││ ### Acceptance  ▓▓▓░ 3/4             ││ OPEN QUESTIONS      │
│         │ OUTLINE    ││  - [x] …                             ││ • touch drag?       │
│         │  Descr.    ││                                      ││ CHECKLIST 3/4       │
│         │  Accept.   ││                                      ││ RISKS — needs model │
│         │ PARENT/SUBS││                                      ││ [Comment] [Ping]    │
└─────────┴────────────┴┴──────────────────────────────────────┴┴─────────────────────┘
             ↑ role=separator (6px, keyboard-resizable)    ↑ role=separator
```

**390:**
```
┌──────────────────────────────┐
│ ‹  LAI-1123        [⋯]       │
│ Rail polish                  │
│ ● In review · Round 2        │
│ shell-cc · last run 11m ago  │
├──────────────────────────────┤
│[Overview|Execution|Docs|Evid…│ ← scrollable tablist
├──────────────────────────────┤
│ Delivers ✓ ✓ ◐               │
│ ┌ 3/4 confirmed · CI ✓ ────┐ │
│ └──────────────────────────┘ │
│ Description …                │
│ [Contents ▾]                 │
│ … single document scroll …   │
├──────────────────────────────┤
│ [Send back]        [Accept]  │ ← sticky; Accept → confirm+undo
└──────────────────────────────┘
```

## 9. State matrix

`✓` means the panel needs its own design for that state.

| Panel | Loading | Empty | Error + retry | Forbidden (Viewer) | Not found | Stale / conflict | Live lost (SSE) | Agents off |
|---|---|---|---|---|---|---|---|---|
| Header / status | skeleton line | — | inline + retry | pill read-only | "No task LAI-x" + link to board | 409 → reload prompt | "Live updates paused" chip | — |
| Overview | `LoadingState shape="drawer"` | "No description yet" (Add if may edit) | `ApiErrorState` + retry (exists `:279-309`) | text, no edit affordance | page-level | `text.stale` blocks edits (exists) | quiet re-read on reconnect | — |
| Execution / timeline | row skeletons | "No agent has worked this yet" | per-source: show what loaded, flag the failed source | read-only; hide Ping / Release | — | — | "Last heard 4m ago" from the claim clock, never "working" | "Agents are off for this space" (`agentsAllowed`) |
| Documents | skeleton | "No deliverable documents" + what agents send | retry | read; no review or comment actions | doc / version 404 → list | newer version banner | — | — |
| Evidence | skeleton | "No round yet"; in progress: "Latest save, not yet proof" | retry | read | — | — | — | — |
| Decisions / questions | skeleton | "No checkpoint notes yet" | retry (checkpoints read) | read | — | — | — | hidden with a reason |
| Discussion | existing feed loading | "No comments" | retry; composer keeps its draft | composer hidden + reason | — | edit conflict on PATCH | new-comment marker on reconnect | — |
| Dependencies | skeleton | "Nothing blocks this" | retry | read | linked task gone → struck through | — | — | — |
| Review | — | "Nothing to decide" outside review | inline error on decide (exists) | buttons absent, reason text | — | 409 "already decided by X" | — | — |
| Resizer / panels | — | — | storage throws → defaults | — | — | — | — | — |

**Partial-failure rule:** each panel owns its read. One failure never replaces the page, which is the My Day bug B7.

## 10. Slices and acceptance

Each slice is its own task, branch and PR into `integration-ui-transformation`.

**S0. Drawer everywhere (UI-only, SHELL).** `TaskDrawerHost` in `SpaceLayout`, dialog semantics, the OverflowMenu Escape fix.
- *Acceptance:* `?task=` on /timeline, /calendar, /sprints and /list renders the full panel.
- *Acceptance:* drawer has `role=dialog`, `aria-modal`, labelled by the title; focus trapped and returned (`drawerReturnTarget`).
- *Acceptance:* Escape in the overflow menu closes only the menu.
- *Acceptance:* `BoardScreen` no longer renders `TaskDrawerContent`; tests cover every space view.

**S1. Split the panel (UI-only).** `useTaskWorkroom`, the two contexts, the area components; no visual change.
- *Acceptance:* `TaskDetailPanel.tsx` under 300 lines; no part over 400.
- *Acceptance:* the existing drawer tests pass unchanged.

**S2. Workroom route (UI-only, plus a backend S item if key lookup is needed).** `/task/:key`, three-panel frame, native resizer, focus mode, area nav, breakpoints.
- *Acceptance:* the URL table in §2 holds, including Back from the Workroom landing on the board with the drawer open.
- *Acceptance:* the separator passes the keyboard contract and persists widths; storage that throws still renders defaults.
- *Acceptance:* no nested same-axis scroll at the six widths; 390 has the sticky action bar.

**S3. Execution timeline, decisions and in-progress evidence (UI-only).**
- *Acceptance:* the timeline merges the four sources with source badges, grouped by `claim_generation`, and pages through activity.
- *Acceptance:* decisions and questions show verbatim with checkpoint provenance.
- *Acceptance:* the four agent lanes each cite their source field, and none renders a state the server did not send.

**S3b. Review area (UI-only).** `ApprovalBar` (Accept → undo toast; Send back
→ reason); advisory review checklist pairing Acceptance with round evidence;
round-to-round compare of `summary_md` and evidence states.
- *Acceptance:* Accept is never one irreversible click; the checklist is
  labelled advisory; Accept stays gated by `can_decide`.

Renderer work (heading ids, TOC, highlighting) is **not** a Workroom slice: it
is decided by the deliverable design trial and lands in Phase D.

## 11. Backend this phase can use (CORE, optional)

| Item | Size | Without it |
| --- | --- | --- |
| `GET /tasks/:id/claims` (claims history) | S | runs reconstructed from activity, labelled "from activity" |
| Key lookup for `/task/:key` (confirm whether `GET /tasks/:id` accepts a key first) | S | client lookup through the project's task list |

Both preserve the public API (additive only) and are developed locally per
decision UX-4 — but they are optional for Phase C, which ships UI-only.
