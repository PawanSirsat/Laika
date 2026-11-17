# Specification: Management Review Studio

**Phase E (proposal over evidence).** A review surface for managers and
executives on top of the existing review queue: a project dashboard, a
deliverable review page with technical and executive lenses over one data
model, evidence inspection with truth labels, presentation mode, and a
printable pack. v1 is UI-only. Basis `9ac3be1f`; paths relative to `server/`.
**EXISTING** = already served · **UI-ONLY** = buildable from served data ·
**NEEDS BACKEND** = CORE first.

Agent Operations, specified alongside it in the Phase B notes, now lives in
[`../architecture/experience-architecture.md`](../architecture/experience-architecture.md) §9.

## 1. Findings that shape this surface (evidence)

Six findings change the shape of the brief:

1. **`GET /agents` returns only your own agents.** `listOwnAgents` filters on `owner_user_id = actor` (`src/services/agents.ts:276-301`), and `GET /agents/:id` is `getOwnAgent` (`:304-313`). Nothing serves an org-wide fleet today.
2. **`/presence` and `/capacity` list people, not agents.** Their agent entries are a *client slug* plus `running` / `last_at` (`src/services/presence.ts:202-210`, `:80-119`), with no `agent_id`. Joining them to `GET /agents` can only be approximate: owner user id plus harness slug.
3. **Session history is already shown**, but only inside the disconnect confirmation dialogs (`web/src/routes/screens/developer/v3/ToolDetails.tsx:278-293`, `DeviceRoster.tsx:378-381`). It is not a browsable view.
4. **A person has no stop, retry or resume control.** `POST /agent-sessions/:id/end` needs the agent's own session (`src/services/claims.ts:604-615`). Reclaim takes an agent token only (`src/http/routes/tasks.ts:459`, `claims.ts:1247`). The one lever a person has is a status change out of `in_progress`, which releases the claim (`src/services/tasks.ts:2351`). That fences the agent off the task. It does not stop the agent's process.
5. **Evidence carries `claimed` / `confirmed` / `failed` per item** (`src/db/enums.ts:491`, `src/db/schema.ts:2467-2511`, `src/services/rounds.ts:60-145`). The review studio can be honest about proof without any backend work.
6. **Review packages have no server object.** There are no versions of task content (only project context has revisions, `src/services/context-revisions.ts:111-226`), no uploads, no exports except the activity CSV (`src/http/routes/activity.ts:169`), and no summaries.

**Visual rule.** Dashboard panels and KPI tiles are **glass level 1** over the
ambient canvas; the review page's **document body, evidence tables and code
are solid**; presentation mode is solid throughout (projectors and screen
sharing flatten translucency).

**AI rule.** Any generated summary is governed by the AI policy
([`proactive-intelligence.md`](proactive-intelligence.md) §5): off by default,
labelled, never in the Outstanding issues block, never restating evidence
counts.

## 2. Purpose and IA
- The studio is a review surface on top of the existing review queue (`GET /api/v1/review`, `src/http/routes/review.ts:18-22`). It does not replace it.
- **Where it lives.**
  - Inbox › Review stays the operational queue (`web/src/routes/page-tabs.ts:43`).
  - The studio is a new org-level route, `/review-studio`, with `?project=` and `?task=`. It is reached from Inbox › Review ("Open in studio") and from a space's Dashboard.
  - Proposed nav placement is the ORG group, next to Insights (`web/src/routes/route-table.ts:263`).
  - This is a **UI-ONLY** route addition, but the route-table entry is SHELL's.

## 3. Project review dashboard
| Panel | Source | Tag |
|---|---|---|
| Waiting for review: count, oldest waiting, fast-finish cue | `ReviewQueueItem.waiting_since`, `cue`, `can_decide` (`src/services/review.ts:35-58`), filtered client-side by `project.slug`. Capped at 200 with `truncated` (`:30`, `:54-58`) | EXISTING |
| Open / in review / blocked / overdue | `OrgOverviewView.tasks` (`src/services/org-overview.ts:23-38`) is org-wide. Per project, use `GET /tasks/summary?project=` (`src/http/routes/tasks.ts:401`) | EXISTING |
| Throughput and cycle time | `GET /projects/:slug/metrics` → `MetricsView` (`src/services/metrics.ts:67-73`, `src/http/routes/activity.ts:124`) | EXISTING |
| Sprint forecast | `SprintForecastView` (`src/services/sprint-forecast.ts:77-86`), with its `reason` shown verbatim when there is no forecast | EXISTING |
| Proof health: rounds with failed or unconfirmed evidence | Count `state` across `round.commits/tests/pull_request` in the queue items (`src/services/rounds.ts:93-145`) | UI-ONLY |
| Unresolved send-backs | `TaskView.send_back` (`src/services/tasks.ts:280`) | EXISTING |
| Agents with "Save needs attention" or "Recovery available" | `TaskView.handoff.recovery_available` / save state (`src/services/task-handoff.ts:29-60`) | EXISTING |
| Risks and decisions required as first-class lists | No model | NEEDS BACKEND (risk model, decision requests) |

## 4. Deliverable review page (one task)
Today's sources are `GET /tasks/:id`, `GET /tasks/:id/rounds` (`src/http/routes/tasks.ts:513`), `GET /tasks/:id/checkpoints` (`src/http/routes/checkpoints.ts:101`), `GET /tasks/:id/handoff-offers` (`src/http/routes/handoffs.ts:141`), comments, `GET /projects/:slug/activity`, and `GET /tasks/:id/estimate` and `GET /tasks/:id/usage`.

### Review package contents mapped to data
| Section | Real source | Tag / gap |
|---|---|---|
| **Executive summary** | Nothing stored. Candidate inputs are the latest round's `summary_md` (`src/db/schema.ts:2426-2446`) and the latest checkpoint's `summary.work_done` (`src/db/schema.ts:1675-1681`) | Show the agent's own `summary_md`, labelled "Agent's summary (unverified)" — UI-ONLY. A generated summary is NEEDS BACKEND (§5 and the AI policy) |
| **Objective** | `description_md` (`src/services/tasks.ts:316`); `solves` and `unlocks` (`:320-323`) | EXISTING |
| **Scope** | `deliverables[]` (`src/db/schema.ts:503-508`, states at `src/db/enums.ts:406`); `parent_task_id` / children; `blocked_by` / `blocks` (`src/services/tasks.ts:269-273`) | EXISTING. There is no "out of scope" field (gap) |
| **Deliverables** | `TaskDeliverable{title, detail, state: pending/in_progress/done}`. This is a checklist, not files | EXISTING. Files are NEEDS BACKEND and need a SPEC decision (uploads are deferred) |
| **Acceptance criteria** | `acceptance_md`, free markdown (`src/services/tasks.ts:318`) | EXISTING as prose. A checklist parsed from `- [ ]` lines is UI-ONLY, labelled "parsed from text". Structured, per-criterion pass/fail is NEEDS BACKEND |
| **Progress** | `status`, `started_at`, `completed_at`, the `size` forecast (`src/services/tasks.ts:286`), deliverables done/total (`src/services/deliverables.ts:193`) | EXISTING |
| **Evidence** | `RoundView.commits/branch/pull_request/tests/ci`, each item with `state`, `state_source` and `state_at` (`src/services/rounds.ts:60-133`) | EXISTING |
| **Key findings** | Checkpoint `summary.decisions` and `summary.failing` are free text, untrusted, written by the agent (`src/db/schema.ts:1675-1681`) | UI-ONLY, shown labelled "Agent-reported" |
| **Outstanding issues** | Current `send_back` (`src/services/rounds.ts:163-170`); checkpoint `summary.open_questions` and `summary.failing`; evidence `failed`; CI `failed`; deliverables not `done`; open blockers; save state `uncertain` (`src/services/task-handoff.ts:51-55`) | UI-ONLY aggregation. These are never hidden in any mode |
| **Risks** | No model. Proxies only: the fast-finish `cue`, an overdue `due_on`, `stale_flagged_at` | Proxies UI-ONLY, labelled as signals. Real risks are NEEDS BACKEND |
| **Decisions required** | No model. Pending hand-off approvals: person inbox `needs_approval` (`src/services/handoffs.ts:1982`), and `can_decide` on the review item | Approvals and accept/send-back are EXISTING. General decision requests are NEEDS BACKEND |
| **Recommendations** | Nothing stored | NEEDS BACKEND (AI, §5) or human-authored (needs a store) |
| **Reviewer comments** | Comments API; send-back comments are marked through `task_reviews.comment_id` (`src/db/schema.ts:2513-2555`) | EXISTING. Comments anchored to a section are NEEDS BACKEND |
| **Approval history** | `RoundView.decision` per round (`src/services/rounds.ts:130-153`), `task_reviews` rows, and hand-off approvals (`handoff_offers.approved_by_user_id/approved_at`, `src/db/schema.ts:1388-1440`) | EXISTING |

### Technical vs executive views of the same data
Both views are a client-side lens over one fetched model. The URL is `?view=technical|executive`. Nothing in either view is a different query.
- **Technical view.** Every evidence item with sha, branch, PR URL, test command and exit code. CI line (`ciLine`, `src/services/github-proof.ts:397`). Checkpoint manifest, refs and verification. Claim generations from activity. The full checkpoint `summary` fields.
- **Executive view.** The objective. Deliverables done/total. An evidence roll-up ("4 of 6 proof items confirmed · 1 failed"). Outstanding issues. Decision status. Approval history. Code-level detail is collapsed behind "Show technical detail".
- **Invariant:** the executive view *counts* failed or claimed items. It never omits them. If any item is `failed`, the roll-up chip is the failure colour and the item is listed by name.

### Side-by-side version comparison
- **Round N vs round N−1.** UI-ONLY, from `GET /tasks/:id/rounds`. Compare `summary_md` with a client line diff, the evidence sets (added, removed or changed state), CI, and the decision and reason given on N−1.
- The server has `diffLines` (`src/services/text-diff.ts:105`), but it is used for context revisions only. A small client diff is needed, with no new dependency, or a task to expose the server's.
- **Checkpoint vs checkpoint** within a claim: the `summary` fields and the `manifest`. UI-ONLY.
- **Description or acceptance as of round N:** there is no history of task fields (`task.updated` activity may carry a payload but it is not a snapshot). NEEDS BACKEND (task field revisions).

### Evidence inspection
Each item is a row showing kind, value, a state badge and its source.
- `claimed`: neutral outline badge, text "Claimed by agent — not checked".
- `confirmed`: confirmed badge, text "Confirmed by {state_source} {relative state_at}".
- `failed`: failure badge, text "Failed — {source}".
- The badge carries text and icon, never colour alone, consistent with `web/src/components/agent/agent-states.ts:1-8`.
- The CI block uses `RoundView.ci` and stays null-honest ("No CI result reported").
- For a PR, `merged: null` reads "GitHub has not reported this PR".

### Review checklist (UI-ONLY, computed, not stored)
1. Every deliverable is `done`.
2. No evidence item is `failed`.
3. At least one `test_run` is present and every one has exit code 0.
4. CI is confirmed.
5. No open send-back.
6. Acceptance lines are ticked in the text, labelled "per acceptance text".
7. No open question in the latest checkpoint.

Each line links to its source row. **It is advisory.** Accept stays `POST /tasks/:id/accept` (`src/http/routes/tasks.ts:516`), gated by `can_decide`. A checklist the reviewer ticks and that persists is NEEDS BACKEND.

### Presentation mode
- `?present=1`: full-screen, larger type, executive lens.
- **Hidden:** sidebar, toolbars, timestamps under a minute, technical detail, ETag and claim internals.
- **Never hidden:**
  - the Outstanding issues block, pinned and always first after the objective;
  - any `failed` or `claimed` evidence count;
  - the "AI-generated" or "Agent-reported" labels;
  - the review decision state.
- Decision buttons are disabled in presentation mode. Exiting is Esc or a button.

### Consolidated project review pack and export
- **v1 pack (UI-ONLY).** A client view of all tasks in a sprint or a filter, with the per-task executive lens stacked plus the project dashboard header. The data is `GET /tasks?project=&sprint=` and N calls to `/rounds`.
  - That is N+1 reads, so cap it at about 50 tasks and show "Showing 50 of M".
  - A batch rounds read is NEEDS BACKEND.
- **Export v1:** print stylesheet / browser "Save as PDF". UI-ONLY.
- A server-rendered pack, a stored snapshot, a shareable link, or a .docx/.pdf export are NEEDS BACKEND (sized **L** in the audit).

## 5. AI-generated summaries — where and governance (subject to the AI policy)
- **Existing engine.**
  - `httpProviderClient` (`src/services/provider.ts:85`), org-configured per SPEC §12 (`docs/SPEC.md:7118-7134`).
  - The model is hardcoded `claude-sonnet-4-5` (`src/services/provider.ts:160`); OpenAI-compatible providers get `default`.
  - The timeout is 30 s (`:24`). It is used only by meeting review (`src/services/meeting-reviews.ts:91`).
- **Candidates:**
  - executive summary of a task: input is objective, deliverables, rounds' summaries, evidence states and open send-back;
  - project pack summary;
  - "what changed between rounds".
- **NEEDS BACKEND, all of it:**
  - a `POST …/summaries` service that calls `can()`;
  - a stored row (model, provider, prompt hash, input ids, created_by, created_at);
  - a configurable model;
  - a per-org cap and rate, mirroring the meeting-review cap (`docs/SPEC.md:6145-6148`).
- **Governance.**
  - SPEC §10.2 calls the transcript webhook "the one endpoint where a caller chooses which data leaves the instance" (`docs/SPEC.md:6137-6140`). A summary endpoint would be a second one, so it **requires a CHIEF decision and a SPEC amendment** before work.
  - Proposed rules:
    1. The org-admin opts in per feature, separately from meeting review.
    2. The prompt carries only data the requesting reader may already read.
    3. The UI states what is sent: "Sends this task's title, description, deliverables, round summaries and evidence states to {provider}".
    4. No summary without a provider (`null` is the default and Laika stays fully functional).
    5. Agent-written text is untrusted input (D-115 item 7, `src/db/schema.ts:1414`). The prompt delimits it and the output is never auto-applied.
- **Display rules:**
  - an "AI summary · {model} · {time}" label on a tinted surface distinct from verified facts;
  - never placed in the Outstanding issues block;
  - the summary must not count or restate evidence states; those render from data beside it;
  - stale when any source row is newer than `created_at`.

## 6. Wireframes

**1440 — deliverable review page (technical lens)**
```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Review studio / laika / LAI-1123  Rail polish        [Technical|Executive] [Present] ⋯ │
├────────────────┬───────────────────────────────────────────────┬─────────────────────────┤
│ SECTIONS       │ OBJECTIVE  description_md · solves · unlocks  │ DECISION                │
│ • Objective    │───────────────────────────────────────────────│ Waiting 2d 4h           │
│ • Outstanding⚠3│ ⚠ OUTSTANDING (3)                              │ [Send back] [Accept…]   │
│ • Deliverables │  ✗ test_run `pnpm test` exit 1   (failed·CI)  │ (can_decide)            │
│ • Acceptance   │  ○ PR #266 not reported by GitHub (claimed)   │─────────────────────────│
│ • Evidence     │  ? "Should rail collapse <390?" (agent, ckpt) │ CHECKLIST (advisory)    │
│ • Checkpoints  │───────────────────────────────────────────────│ ✓ deliverables 4/4      │
│ • Rounds  ⇄    │ DELIVERABLES 4/4   ACCEPTANCE (parsed text)   │ ✗ no failed evidence    │
│ • History      │───────────────────────────────────────────────│ ✓ CI confirmed          │
│                │ EVIDENCE · round 2      [Compare with round 1]│ ○ open questions: 1     │
│                │  commit b65a07f "fix(web)…"   ✓ confirmed·gh  │─────────────────────────│
│                │  branch LAI-1123-rail-polish  ○ claimed       │ APPROVAL HISTORY        │
│                │  tests  pnpm test exit 1      ✗ failed        │ r1 sent back · A · 3d   │
│                │  CI ✗ 1 of 5 checks failed                    │ ho approved · B · 2d    │
│                │ ┌ Agent's summary (unverified) ─────────────┐ │─────────────────────────│
│                │ │ summary_md …                               │ │ AI SUMMARY (not enabled)│
│                │ └────────────────────────────────────────────┘ │                         │
└────────────────┴───────────────────────────────────────────────┴─────────────────────────┘
```
**390 — same page (executive lens)**
```
┌──────────────────────────────┐
│ ‹ LAI-1123   [Exec ▾]   ⋯    │
│ Rail polish · In review 2d   │
├──────────────────────────────┤
│ ⚠ 3 outstanding        ›     │
│  ✗ 1 failed test             │
│  ○ 1 unchecked proof item    │
│  ? 1 open question (agent)   │
├──────────────────────────────┤
│ Deliverables  ████████ 4/4   │
│ Proof  3 ✓ · 1 ○ · 1 ✗       │
│ CI     ✗ failed              │
├──────────────────────────────┤
│ Objective            ›       │
│ Approval history     ›       │
│ Technical detail     ›       │
├──────────────────────────────┤
│ [Send back]   [Accept…]      │  sticky; can_decide
└──────────────────────────────┘
```
**1440 — project dashboard:** a header strip (open / in review / blocked / overdue from `/tasks/summary`), a throughput chart with cycle-time p50/p75, a "Waiting for review" table (task, waiting, proof roll-up, CI, cue, can_decide), and an "Attention" list (send-backs, failed proof, recovery available). **390:** the same blocks stacked, the table becomes cards, and the chart is replaced by figures.

## 7. Acceptance criteria — Review Studio v1 (UI-ONLY)
1. Every number and label comes from the cited endpoints. No hardcoded fixtures (CLAUDE.md §5.1).
2. Each evidence item renders its server `state` with text and icon. A `failed` or `claimed` item is counted and listed in both lenses and in presentation mode.
3. Technical and executive views render from one fetched model. A test asserts both lenses show identical counts of failed, claimed and confirmed items.
4. Outstanding issues aggregates send-back, failed evidence, failed CI, not-done deliverables, open blockers, `uncertain` saves and the checkpoint's `open_questions` / `failing`. It is first in presentation mode and cannot be collapsed there.
5. Agent-written text (`summary_md`, checkpoint summary) is labelled "Agent-reported / unverified" and is visually distinct from server-confirmed facts.
6. Accept and Send back use the existing endpoints, appear only when `can_decide`, and Accept asks for confirmation (fixes audit B9).
7. Round compare works for any two rounds of a task and shows evidence state changes.
8. The pack caps at a stated N and says when truncated. Print/PDF output keeps the issue counts.
9. Both themes, 390 and 1440, keyboard-navigable section nav; the review queue is not polled a third time (reuse the B14 fix).
10. With no provider configured, there is no AI affordance beyond a disabled "AI summary (not enabled by your org)" line.

## 8. Backend dependencies (CORE)

| Dependency | Unblocks | Size |
| --- | --- | --- |
| Batch rounds read for N tasks | consolidated pack beyond ~50 tasks | S |
| `/metrics` `?window=` + WIP / stuck (LAI-712) | dashboard windows | S |
| Structured acceptance criteria (per-item pass / fail) | a real checklist | M |
| Task field revisions | description / acceptance "as of round N" | M |
| Risk model; recommendations store; decision requests | Risks, Recommendations, Decisions required | M |
| Persisted reviewer checklist; section-anchored comments | stored checklist; anchored review comments | M |
| "Reject" / "Reopen" review outcomes (SPEC + enum + CHECK; reopen may be UI-only if §5 allows the transition) | review actions | S + decision |
| AI summaries service + configurable model + cap + **SPEC §12 / §10.2 amendment (CHIEF decision)** | executive and pack summaries | M |
| Review pack snapshot + server export (PDF / .docx) | shareable pack | L |
