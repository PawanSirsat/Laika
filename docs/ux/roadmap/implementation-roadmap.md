# Implementation roadmap

**Proposal under the approved phase sequence (decision UX-1).** Phases,
slices, the dependency map, the CORE-owned backend gap analysis, branching and
the open questions for the owner. Acceptance criteria are in
[`acceptance-criteria.md`](acceptance-criteria.md).

## 1. Phases

| Phase | Scope | Status | Backend |
| --- | --- | --- | --- |
| **A** | Discovery and audit: code audits, visual audit, inventories | **done** (this set's `audit/`) | — |
| **B** | UX architecture and design-foundation specs; then **this docs PR** | **this PR** | — |
| **C** | **Task Workroom** (UI-only), with the **deliverable design trial** running alongside | proposed | optional S items (§4) |
| **D** | **Deliverable engine** — local backend allowed (UX-4) | proposed | yes, local only |
| **E+** | **Management Review**, **proactive intelligence**, **final quality** | proposed | yes, local only until released |

Within **E+** this set proposes an order, pending the owner:
**E** Management Review Studio (+ Agent Operations v1, both UI-only first) →
**F** proactive intelligence (org-wide stream, Command Center, palette,
notifications, AI under the policy) → **G** final quality (cross-screen
accessibility, responsive and performance pass; mobile IA).

Each phase has its own acceptance criteria and reviewable PR(s). **Approving a
phase is not approval to adopt every library or redesign every screen at
once** (UX-1): each library is its own task (`../architecture/library-evaluation.md`),
and each screen change is its own PR.

### 1.1 How the Phase B source waves map to the approved phases

The Phase B notes used their own lettering. For anyone reading them:

| Source wave | Approved home |
| --- | --- |
| "Phase A — Stabilise" A1 drawer host + dialog + links | **C** (Workroom S0) |
| A2–A10 (recovery, toast, correctness, tokens, splitting, header, My Day, board scope, terminology) | **Foundation fixes** — *open question 1* |
| "Phase B — Interaction foundation" primitives | Foundation fixes, or **C** as the Workroom needs each |
| "Phase C — Workroom v1" | **C** |
| "Phase D — Live + Command Center + palette" | **F** |
| "Phase E — Review Studio v1 + Agent Ops v1" | **E** |
| "Phase F — backend-dependent" | **D** (deliverables) and **E/F** (the rest) |
| "Phase G — quality validation" | continuous; closing pass **G** |

## 2. Phase contents

### Phase C — Task Workroom (+ design trial)

Slices (`../specifications/task-workroom.md` §10), one task / branch / PR
each, into `integration-ui-transformation`:

- **S0** Drawer everywhere: `TaskDrawerHost` in `SpaceLayout`, dialog
  semantics, Menu Escape fix, safe Detach, `useOpenTask` (B1, B2, B3, B4,
  B18, B19, B22).
- **S1** Split `TaskDetailPanel` (no visual change).
- **S2** `/task/:key`, three resizable panels, focus mode, area nav.
- **S3** Execution timeline, decisions and questions, evidence in progress,
  four agent lanes.
- **S3b** Review area: `ApprovalBar` with Undo (B9), advisory checklist,
  round compare.
- **Glass tokens + primitives** land here (first consumers: Workroom rails,
  popovers, toasts) — subject to open question 2.

**Deliverable design trial** (`../specifications/deliverable-engine.md` §2):
fixtures A, B, C; capabilities T1–T10; library candidates each under their
own task; findings note as a follow-up docs PR.

### Phase D — Deliverable engine

Requires open question 3 answered (text deliverables vs uploads). CORE:
tables, REST, `submit_deliverable`, verbs (three owners), anchored comments.
SHELL: Documents area, reader from the trial's winning renderer, version
picker, review, exports (MD original, print-to-PDF). All backend work local
per UX-4.

### Phase E — Management Review (+ Agent Operations v1)

Review Studio v1 UI-only (`../specifications/management-review.md` §7);
Agent Operations "Your agents" (`../architecture/experience-architecture.md`
§9). Backend items (§4) only as separately approved CORE tasks.

### Phase F — Proactive intelligence

One org-wide `EventSource`; Command Center `/home`; cmdk palette (own task);
notification centre after `/me/notifications`; AI features only after the
SPEC amendment and the AI policy controls (`../specifications/proactive-intelligence.md` §5).

### Phase G — Final quality

Cross-screen accessibility audit (keyboard-only, screen readers, contrast incl.
glass composites, reduced motion / transparency), seven widths × two themes,
performance budgets asserted, mobile IA.

## 3. Dependency map

```
Foundation (proposed track) ─────────────────────────────────────────────┐
  tokens: layers · motion · breakpoints · radius/spacing · elevation      │
  route-level lazy()  ·  CSP in browser harness (before any new dep)      │
  ToastProvider · Dialog base · Menu/Popover (Floating UI task) · Tabs    │
  error-recovery sweep (useResource/usePolled) · header + My Day fixes    │
                                                                           ▼
C  S0 drawer host ─► S1 split panel ─► S2 /task/:key ─► S3 timeline/lanes ─► S3b review
   glass tokens + primitives ─► Workroom rails, popovers, toasts
   ║ design trial (fixtures A/B/C, T1–T10) ═════════════════════╗
                                                               ▼
D  SPEC decision (text ≠ upload) ─► CORE tables/REST/MCP/verbs ─► Documents area
                                    (renderer chosen by the trial)
                                                               │
E  Review Studio v1 (UI-only) ◄── C review area + evidence ────┘
   Agent Ops "Your agents" (UI-only) ─► BE org fleet, controls (later)
F  usePolled ─► one org EventSource ─► Command Center ─► notifications (BE)
   Menu/Tabs/Icon ─► palette (cmdk task)     AI policy + SPEC amendment ─► AI summaries (BE)
G  continuous per phase; closing pass after F
```

Parallel-safety: Foundation items touch distinct files and run in parallel;
**C S0 waits for the Dialog base and Menu** (same drawer files); Phase D's
SHELL half waits for its CORE half (CLAUDE.md §4.4 merge procedure).

## 4. Backend gap analysis (CORE-owned)

Every item is a CORE task (`server/` except `server/web/`), additive to the
public API, every endpoint `can()`-checked, developed **locally** (UX-4).
"3-owner" = a new `ACTIVITY_TYPES` verb (SPEC by CHIEF, `enums.ts` + CHECK by
CORE, web mirror + dashboard wording by SHELL).

| Size | Item | Unlocks | Phase |
| --- | --- | --- | --- |
| S | `GET /tasks/:id/claims` (claims history) | full execution timeline | C (optional) |
| S | Confirm / add key lookup on `GET /tasks/:id` | `/task/:key` deep links | C (optional) |
| S | `GET /tasks` filters: `blocked`, `overdue`, `due_before/after`, `selected_agent`, `claim_agent` | Command Center tiles; Agent Ops without client scans; complete My Day overdue list | E/F |
| S | `/metrics` `?window=` + WIP / stuck (LAI-712) | review dashboard | E |
| S | SSE `?types=` event-type filter (optional) | lighter org stream | F |
| S | `type=` on `GET /activity` for non-admins, `can()`-scoped | Command Center sections 7–8; Agent Ops events | E/F |
| S | `agent_id` on presence / capacity entries | exact roster join | E |
| S | Batch rounds read for N tasks | review pack > 50 tasks | E |
| S | Per-user `landing` / `density` on `PATCH /me` | saved preferences | F |
| M | Human notifications + read / unread (copy the agents' `me/events` + ack) | notification centre | F |
| M (3-owner each) | Verbs: failing round, connection lost, deadline sweep | proactive triggers | F |
| M | Org-wide agent read (§3.1 action + endpoint; D-120 disclosure) | fleet beyond own agents | E |
| M | Org-wide sessions / claims lists; failure records | Agent Ops history, failures | E |
| M | Human stop / pause / resume; retry / re-queue | agent intervention | E |
| M | Structured acceptance criteria; decisions / questions entity | real checklist; resolvable questions | E |
| M | Anchored comments | document review | D |
| M | FTS5 search (task text, comments, checkpoints) | global search | F |
| M | AI summaries + configurable model (`provider.ts:155-161` hardcodes it) + audit + redaction — **after SPEC §12 / §10.2 amendment** | executive summaries | F |
| M | Task field revisions; Reject / Reopen outcomes (SPEC + enum) | version compare; review actions | E |
| M | Risk model; decision requests | Management Review risks / decisions | E |
| L | First-class text deliverables: tables, versions, review, REST, `submit_deliverable`, verbs — **after the SPEC decision** | Documents area | D |
| L | Review pack snapshots; server exports (PDF / DOCX) | shareable packs | E (late) |

## 5. Branching and release (UX-3)

- `master` is production: a push deploys (`.github/workflows/deploy.yml:1-13`;
  build and deploy jobs gated `if: github.event_name == 'push' &&
  github.ref == 'refs/heads/master'`, :171, :208).
- `integration-ui-transformation` is the integration branch. Its `integration-*`
  name makes CI run the gate on its pushes and on PRs into it (:17-21) while
  **never deploying**.
- Each slice: branch `LAI-NNN-short-name` from the integration branch → PR into
  it → full root gate green (`pnpm test`, `pnpm lint`, `pnpm format`, each exit
  code captured separately) → review per UX-7.
- `integration-ui-transformation` → `master` only after integration
  validation (the phase's acceptance criteria on the integrated branch) **and
  explicit release approval** from the owner.
- The integration branch takes `master` regularly (merge, not rebase) so it
  never drifts from production.

## 6. Open questions for the owner

1. **Stabilisation fixes are unscheduled.** B1–B26 and V1–V15 are not placed
   under the approved phase list. **Proposal (pending approval):** fold the
   drawer and dialog fixes (B1, B2, B3/B22, B4, B9, B18, B19) into **Phase C**
   (they are Workroom S0 / S3b), and run the rest — error recovery (B5–B7),
   shared toast / undo and SaveStatus (B11), tokens and guards (B16), code
   splitting, header consistency (V3, V4), the My Day dead end (V2), board
   scope and toolbar (V5, V6), terminology (V10), and the smaller items — as a
   **Foundation fixes** track of small PRs into the integration branch, in
   parallel with Phase C. Until approved, none of them is scheduled.
2. **Glass vs the reference design.** See `../design-system/visual-language.md`
   §3.9: whether to adopt glass, where first, in which themes, and whether to
   use ambient gradients at all.
3. **Text deliverables vs uploads** (SPEC §1.1, §14 q5) — needed before
   Phase D.
4. **AI summaries** — SPEC §12 / §10.2 amendment and a `D-xxx` before any
   Phase F AI work.
5. **Agent Operations placement** — Insights › Agents (proposed) or a
   top-level `/agents` in ORG.
6. **Accept with Undo** — a client-side undo window before the call, or a
   server reverse transition; and whether task Accept requires linked
   deliverables approved (Phase D).
