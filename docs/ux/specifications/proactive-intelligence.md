# Specification: proactive intelligence

**Phases E+ (proposal over evidence).** How Laika tells people what needs them:
severity tiers, a notification centre, the triggers that feed it, how facts,
derived signals and AI interpretations are kept apart — and the **AI policy**
that governs any AI-generated content (decision UX-6). Basis `9ac3be1f`.
**[E]** exists · **[UI]** UI-only · **[BE]** needs CORE. Every trigger that adds
an activity verb is a **three-owner** change (CLAUDE.md §4.4).

The Command Center that hosts these signals, and the single org-wide stream
that delivers them, are in
[`../architecture/experience-architecture.md`](../architecture/experience-architecture.md) §7–§8.

## 1. Tiers

| Tier | Meaning | Surface | Persistence |
|---|---|---|---|
| **Informational** | Something happened; no action needed | Notification centre only; activity feeds | Read/unread |
| **Warning** | Something may need you soon | Centre + Command Center "Needs attention" | Until read or dismissed |
| **Action-required** | You are the one who must act | Centre + Needs attention + Inbox badge | Until the underlying state clears (server-decided), not just until read |
| **Critical** | Work is failing or stopped now | All of the above + a polite live-region announcement + a toast with an action | Same as action-required; never auto-dismissed |

Colours come from existing semantic tokens only. Each tier also has an icon and a text label, so colour is never the only signal. Tiers don't animate when reduced motion is set.

## 2. Notification centre

- **[E]** The agent-side pattern exists: `GET /agents/me/events?after&state&limit&project` (agents.ts:294) and `POST /agents/me/events/ack {event_ids, state, session_id}` (agents.ts:307), backed by delivery rows (§4.77).
- **[BE]** A human equivalent modelled on that pattern:
  - `GET /me/notifications?after=<seq>&state=unread|all&limit`
  - `POST /me/notifications/ack {ids, state: read|dismissed}`
  - Rows hold `{id, activity_seq, tier, reason, task_id?, project_id?, created_at, read_at, dismissed_at}`.
  - A server-side fan-out rule maps activity rows to recipients and decides the tier. **The client never decides who is notified or how severe it is.**
  - Delivery is through the **existing stream**: the client re-reads `/me/notifications?after=` when a relevant frame arrives. This avoids a new stream and new SSE event names, which would make it a three-owner change under §4.4.
  - Recipient visibility re-checked through `can()`, as `visibleTo` already does for the stream.
- **[UI]**
  - Bell in the sidebar footer (in Me on mobile) with an unread count.
  - A popover panel: "Unread" and "All" tabs, grouped by tier, with mark-read and dismiss actions. Each row deep-links.
  - Before the backend exists, the bell is **not shipped**. No client-only fake read state.

## 3. Trigger mapping

`enums.ts` line numbers refer to `ACTIVITY_TYPES` in `server/src/db/enums.ts`.

| Trigger | Activity event(s) today | Gap | Business rule (server) | Tier | UI surface | Action offered |
|---|---|---|---|---|---|---|
| **Agent finished** | `task.status_changed` (:118) to review, actor_kind agent; `task.checkpoint_saved` (:226) | — | Notify the task's assignee and reviewers in the project | Info, or Action if you're the decider in `/review` | Centre, Recent deliverables, Pending reviews | "Review" → review screen |
| **Agent failed / connection lost** | `task.claim_expired` (:219), `task.claim_reclaimed` (:223), `task.recovered` (:236), `task.stale_flagged` (:205); presence words (services/presence.ts:132) | No failure record; no "session lost" verb distinct from lease expiry | A claim expiring on in-progress work → task owner + agent owner | Critical for claim_expired; Warning for stale | Centre, Agents section, task drawer Execution panel | "Open task", "Offer hand-off" (existing POST handoffs.ts:127) |
| **Blocked** | `task.dependency_added` (:120); blocked rule in summary (services/tasks.ts:1365) | No "became blocked" or "unblocked" event; the state is derived | When a dependency is added to open work, or a blocker is cancelled | Warning; "unblocked → ready" is Info | Centre, Blocked tile | "Open dependency" |
| **Document changed** | `task.updated` (:117) for description/acceptance; `comment.added/edited` (:122-123) | Payload diff granularity unverified **(inferred)**; no file deliverables (SPEC defers uploads) | Notify watchers (`/me/watching`) | Info | Centre, task drawer | "See change" |
| **Tests failed** | CI results stored per commit (`handleCheck`, webhooks.ts:513); `webhook.received` (:135) is generic | **No verb for a failing round** | A failing conclusion on a round's head → task assignee + agent owner | Critical while a review is open, otherwise Warning | Centre, Pending reviews chip "CI ✗", Evidence | "Open evidence", "Send back" (tasks.ts:520) |
| **Management attention** | none | **Gap:** decision requests (audit: M) | Explicit request by a member → the named person | Action-required | Centre, Needs attention | "Respond" |
| **Deadline approaching** | none; `due_on` exists (services/tasks.ts:212) | **Gap:** needs a scheduled sweep, like the cron that writes `task.stale_flagged` | `due_on` within N days on open work → assignee | Warning; overdue becomes Action-required | Centre, Deadlines | "Open task", "Change due date" |
| **Overlapping agent work** | Claims are per task; `task.handoff_*` (:230-235) | **Gap:** no overlap detection across tasks (same branch or files) | Two live claims touching the same branch → both owners | Warning | Agents section, both tasks | "Open both", "Offer hand-off" |
| **Project context changed** | `project.context_updated` (:174), already delivered to agents (§4.77) | Human recipients need notifications | Notify the project's members with in-progress work | Info | Centre, Project changes | "Read context" |
| Hand-offs (existing) | `task.handoff_offered/approved/accepted/declined/cancelled/expired` (:230-235) | — | Existing inbox semantics | Action for the receiver or approver | Centre, Inbox | Approve / accept / decline (handoffs.ts:190-227) |
| Capacity ping | `agent.capacity_requested` (:242) | — | The agent's owner | Action-required | Centre | Reply (agents.ts:357) |

Every **Gap** that adds a verb is a §4.4 three-owner change: the SPEC §4.8 row, `enums.ts`, and the client `STREAM_TYPES` mirror plus the dashboard wording.

## 4. Keeping AI-generated content apart from verified fact, and never claiming early

1. **Provenance on every row.** Each item carries one of: **Fact** (a server row, with source and time), **Derived** (the client computed it from facts; rule shown on hover/focus) or **AI suggestion**. AI suggestions use a dashed outline, a "Suggested" label, an `aria-describedby` explaining the source, and the token-defined muted surface. They never use status colours.
2. **AI never writes a number** into a metric tile. Tiles show only server figures.
3. **Suggestions are links, not actions.** Running one opens the real workflow, where the user confirms.
4. **No optimistic success.** Show "Saving…", then success only from a 2xx response. On error, roll back and give the server's `code` and message. An action that returns 202 or queues reads "Requested", not "Done".
5. **Agent state words come from the server only** (presence words, claim state). The UI never infers "failed" from silence.
6. **No mock data in production.** Demo modules stay under `src/demo/` with the bundle test (D-032).

## 5. AI policy (decision UX-6)

### 5.1 Default and enablement

- **AI is disabled by default.** No AI feature is reachable, and no data is
  sent to any model, until an **org admin** enables an **approved provider**
  and an **AI policy** for the org.
- Enablement is **org-level and per feature** (e.g. task summaries, pack
  summaries, suggestions), separate from meeting review's existing use of the
  provider.
- **Explicit provider configuration.** SPEC §12 already makes the provider
  org-configured, Admin+, one at a time — `anthropic`, `openai_compatible`
  (covering Ollama and vLLM), or `null`, **the default**, with which "Laika is
  fully functional without an LLM". Secrets are encrypted at rest and never
  returned or logged (SPEC §12).
- **No assumption that self-hosted means local AI.** A self-hosted Laika with
  an `anthropic` or remote `openai_compatible` provider sends data off the
  instance. The UI states where the data goes (provider name and base URL
  host), every time.
- **No automatic transmission when disabled.** No background job, prefetch or
  "warm-up" call while a feature is off; turning a feature off stops pending
  requests.

### 5.2 Data categories

| Category | Rule |
| --- | --- |
| Task title and description | allowed **when org AI is enabled** for the feature |
| Comments | **per the configured policy** (off, own space only, or all the reader may read) |
| Agent-generated reports (round `summary_md`, checkpoint summaries, deliverable bodies) | **only within an enabled workflow** that names them; treated as untrusted input (D-115 item 7), delimited in the prompt, output never auto-applied |
| Source code and diffs | a **separate permission**, off unless explicitly granted for the feature |
| Credentials, secrets, tokens, session credentials, sensitive environment variables | **never sent** — under any setting |

Data minimisation: the prompt carries **only fields the requesting reader may
already read** (the service calls `can()` for that reader) and only the fields
the feature needs.

### 5.3 Required controls

1. **Org-level enablement** (admin, per feature) — §5.1.
2. **Explicit provider configuration** — SPEC §12.
3. **Disclosure of what is transmitted** before the first request and on the
   control itself: *"Sends this task's title, description, deliverables, round
   summaries and evidence states to {provider} ({host})."*
4. **Data minimisation** — §5.2.
5. **Secret redaction** before transmission: a server-side pass for token
   formats Laika issues, common credential patterns and high-entropy strings;
   a request containing a redaction is logged as such (never the secret).
6. **Audit record** of every AI summary: provider, model, prompt hash, input
   row ids, requesting actor, created time, and the redaction count — stored,
   readable by admins.
7. **Provider failure handling** — timeouts (the existing client uses 30 s),
   errors and refusals show an honest state ("AI summary unavailable —
   {reason}") with Retry; the page never blocks on it and never shows a stale
   summary as fresh.
8. **No automatic transmission when disabled** — §5.1.
9. **Cost and rate caps** per org, mirroring the meeting-review cap.

### 5.4 Current state (evidence)

- The provider client is `httpProviderClient`
  (`server/src/services/provider.ts:85`), used only by meeting review.
- **The model is hardcoded**: `bodyFor` sends `model: 'claude-sonnet-4-5'`
  for `anthropic` and `model: 'default'` for OpenAI-compatible providers
  (`server/src/services/provider.ts:155-161`). A configurable model is
  **[BE, M]** and a prerequisite for any new AI feature.
- SPEC §10.2 calls the transcript webhook *the one endpoint where a caller
  chooses which data leaves the instance*. A summaries endpoint would be a
  second one, so it **requires a CHIEF decision and a SPEC §12 / §10.2
  amendment before any work** (open question 4 in the README).

### 5.5 UI rules: facts vs interpretations

- The UI **distinguishes system-generated facts from AI-generated
  interpretations** at all times (§4 gives the three provenance kinds).
- AI output carries "AI summary · {model} · {time}", a dashed outline on a
  token-defined muted surface, and `aria-describedby` text naming the source;
  never a status colour; never glass level 3 (it must not look like a system
  toast).
- AI never writes a number into a metric tile, never counts or restates
  evidence states, and never appears inside "Outstanding issues".
- A summary is marked **stale** when any source row is newer than its
  `created_at`.
- With no provider configured, the only AI affordance is a disabled line: "AI
  summary (not enabled by your organisation)".

## 6. Acceptance criteria

- [ ] No bell ships until `/me/notifications` exists.
- [ ] Tier is read from the server row; the client has no tier table.
- [ ] AI and derived items are visibly and programmatically distinct from facts (axe check plus snapshot).
- [ ] No toast or tile says "done" before a 2xx response (test with a delayed or failed mock).
- [ ] Critical items announce once through the existing LiveRegion and are never auto-dismissed.
- [ ] With AI disabled (the default), no request reaches any provider — a test
      asserts zero provider calls across every AI-capable screen.
- [ ] Enabling a feature shows the disclosure text, naming provider and host.
- [ ] A fixture containing a Laika token and a credential-shaped string is
      sent redacted (asserted on the outgoing request body).
- [ ] Every AI summary has an audit row; a provider timeout renders the
      unavailable state with Retry.
- [ ] The model is read from configuration, not from a literal in
      `provider.ts`.

## 7. Dependencies

| UI | Depends on (CORE unless noted) |
| --- | --- |
| Notification centre + bell | `/me/notifications` + ack + fan-out rules + tiers (M) |
| Deadline-approaching triggers | notifications + a due sweep (cron) + new verb (three owners) |
| Tests-failed triggers | notifications + a verb for a failing round (three owners) |
| Overlapping-work warning | overlap detection (M) |
| Management attention | decision requests (M) |
| AI suggestions and summaries | summaries endpoint + configurable model + audit + redaction + SPEC amendment (M + decision) |
