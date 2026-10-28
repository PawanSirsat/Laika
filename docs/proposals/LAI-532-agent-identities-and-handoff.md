# Proposal — Agent identities and safe task hand-off

| | |
| --- | --- |
| Task | LAI-532 (parent; children LAI-533 – LAI-560) |
| Status | Proposal. The owner's brief of 2026-10-28 authorises building Phase 1. |
| Author | CHIEF (polly, Belka), 2026-10-28 |
| Baseline | `origin/master` `71dd4217` |
| Decisions needed | D-114 (registered agents under D-010), D-115 (checkpoints are not heartbeats under D-005), D-116 (a checkpoint is proved by a push delivery, so D-083 holds), D-117 (the launcher versus the stop list). The proposed text is §9. Belka writes them once approval arrives as §8 describes (D-097 §4). |
| Related | LAI-863 fleet dispatch (on hold) decides *where* work runs. This proposal decides *who* runs it and how work passes between them. Neither depends on the other. |

## 1. Outcome

A human can register several agents, choose one for a task, see which agent is
actually working on it, and pass that work safely to an allowed receiver.

When a device dies, Laika notices that its heartbeats have stopped and lets the
claim expire. It then offers the task for recovery from the **last pushed and
verified checkpoint**. An allowed agent elsewhere checks that checkpoint and
explicitly accepts it. From then on the old session cannot change the task. The
finished work still goes through Review, where a human accepts it.

**What we promise:** recovery from the last checkpoint that was pushed and
registered.
**What we never promise:** edits that never left the device that failed.

There is no agent-to-agent chat. A hand-off is the only way two agents interact.

## 2. What exists today (audit, 2026-10-28)

Labels: **V** = verified by reading the code, **I** = inference, **U** =
unverified. The full reports are kept with LAI-532 on the board.

| Area | Status | Evidence |
| --- | --- | --- |
| Personal tokens: hashed, project pin, `full`/`read_only`, expiry, revoke | EXISTS **V** | `server/src/auth/tokens.ts`, `server/src/services/tokens.ts`, `routes/tokens.ts` |
| Token rotation endpoint | MISSING **V** | Only mint and revoke exist |
| An agent identity separate from its human | MISSING **V** | `tokens.user_id` is the only owner. Every request with a token is recorded as `actor_kind: agent` (`auth/resolve-actor.ts:166`). D-010: "agents are that user's token". |
| One `can()` for REST and MCP | EXISTS **V** | `server/src/policy/can.ts`, `policy/actions.ts`. MCP calls the same services (`mcp/server.ts:148`). |
| H4: a token pinned to a project can still take org actions | PARTIAL **V** | The fix is unmerged, on `H4-pinned-token-org-actions` (LAIKA-457) |
| Claim | PARTIAL **V** | A compare-and-swap on the human `assignee_id` (`services/tasks.ts:1448`). No lease, no generation and no session, so two agents of the same human count as one claimant. |
| Heartbeats | PARTIAL **V** | They record presence only (`services/heartbeats.ts:417`) and carry metadata only (D-005). M4 (LAIKA-537): they write to projects the sender cannot see. |
| Sessions, leases, fencing, offers, approvals, orphan recovery, durable inbox | MISSING **V** | None of these is in the schema, the routes or the MCP registry |
| Activity | EXISTS **V** | Append-only, written in the same transaction as the change (`db/activity.ts:61`). The verb list `ACTIVITY_TYPES` is in `db/enums.ts:114`. A new verb needs three owners (CLAUDE.md §4.4). |
| SSE | PARTIAL **V** | `GET /api/v1/events` replays from `Last-Event-ID`, up to 500 events, then sends `gap`. **Defect:** a stream that is already open never re-checks whether its token was revoked or expired (`routes/events.ts:162`). Same family as M10 (LAIKA-542). |
| Project context | PARTIAL **V** | One `projects.context_md` field, with no revisions and no concurrency token (`services/projects.ts:780`) |
| Git proof | PARTIAL **V** | Signed `/webhooks/github` deliveries for each configured `repo`. Under D-083 nothing calls GitHub. Delivery rows are kept for 30 days. |
| MCP tools | EXISTS **V** | 19 tools, named the same in the registry and in SPEC §7.1. No tool lists tasks. |
| Developer access: Connect, Projects, Activity, Tokens | EXISTS **V** | `web/src/routes/page-tabs.ts`. Connect is a four-step wizard with guides for about 17 clients and a live verify step. The verify step matches the **user**, not the agent (`connect-live.ts`). |
| Inbox: Review, Unlisted work | EXISTS **V** | `INBOX_TABS`, `inboxCount` |
| Card fields, assignee, claim with "Taken by X first" | EXISTS **V** | `card-fields.ts`, `AssignControl.tsx` |
| "Agent" marker | EXISTS, but it does **not** name the worker **V** | The `created_via==='mcp'` badge (`TaskCard.tsx:328`), "Created via: Agent" (`TaskMeta.tsx:485`), the "AGENT" chip on comments and the `?agent=true` filter all show who *wrote* the card. |
| Hand-off button and claim deadline | FAKE **V** | `web/src/demo/agent-runtime.ts`, shown only in demo builds. It is deleted once real data exists. |
| Space settings, "Agent sessions" switch | PARTIAL **V** | `space-settings/AccessTab.tsx:196`. LAI-976 and LAI-977 are still in review. |
| Subtasks | EXISTS, one level **V** | `services/tasks.ts:522` |
| Sprints | EXISTS **V** | Sprints may not overlap, and at most one is active (`services/sprints.ts:135,156`) |
| CI | **V** | A PR into `master` or `integration-*` runs the gate. A push to a feature branch runs nothing. A push to `master` deploys. |
| Accessible building blocks | EXISTS **V** | `Dropdown` (WAI-ARIA combobox), `useDialogFocus`, `PageTabs`, `ConnectionBanner`, the `/design/states` gallery |
| Agent colour | CONFLICT **V** | The design gives purple (`--pur`) to agents, but the accent is purple too (`theme.css:32`). The colour is the owner's call (D-020). |

### 2.1 Reusing existing cards

LAI-539 is the **local implementation task file** for the existing board card
LAIKA-542 ("M10 · Live event stream ignores a token's project limit (SSE)"). It
must not become a second card.

- If LAIKA-542 is open and its `external_ref` is empty, set `external_ref` to
  LAI-539, and widen its description with a comment, not a rewrite. The comment
  says the local task also covers re-checking token revocation and expiry on
  open streams.
- If LAIKA-542 is done, cancelled, or already carries another `external_ref`,
  then and only then create a LAI-539 card, and link it to LAIKA-542 in both
  directions.

Do the same check for each of these. Each existing card gets a link comment,
and no duplicate card is created:

| Existing card | Relates to |
| --- | --- |
| LAIKA-537 (M4 heartbeats) | LAI-541 |
| LAIKA-489 (claim expiry) | LAI-541 |
| LAIKA-506 (hand-off fields) | LAI-546 |
| LAIKA-533 (hand-off button) | LAI-549 |
| LAIKA-456 / LAIKA-457 (token widening / H4) | LAI-534 depends on LAIKA-457 landing first, or on an explicit rebase note |

## 3. The ownership model

These are four separate concepts. None of them is ever worked out from another.

| Concept | Column / table | Meaning |
| --- | --- | --- |
| **Human assignee** | `tasks.assignee_id` (unchanged) | The person accountable for the task. Changing it is always an explicit action of its own. |
| **Selected agent** | `tasks.selected_agent_id` | The agent intended to do the work. Selecting one creates a **work request**. It does not claim the task or start a process. |
| **Active claim** | `task_claims` (one live row per task) | The agent session that accepted the task and holds it now. It has a lease and a `generation`. |
| **Agent owner** | `agents.owner_user_id` | The human who registered the agent. Their permissions cap the agent's. |

A task can stay human-only, with no selected agent and no claim. The first
delegation needs no checkpoint, because no work has happened yet. Changing the
agent while a claim is live **must** go through a hand-off.

## 4. Architecture

### 4.1 Agents and credentials (Phase 1)

- **`agents` table:** `id`, `org_id`, `owner_user_id`, `display_name`,
  `harness` (self-reported: an enum, or `other`), `device_label`
  (self-reported), `status` (`active` | `revoked`), `created_at`, `revoked_at`,
  `last_seen_at`.
- **`agent_project_grants` table:** `agent_id`, `project_id`, `scope`
  (`read_only` | `full`).
- **`tokens.agent_id`:** a nullable foreign key. A token with an agent is that
  agent's credential. Rotation mints the new token and revokes the old one in a
  single transaction, and leaves the owner's other tokens alone.
- **Effective access** is the intersection of four things: `can(owner)`, the
  agent's grant for the project, the token's scope and pin, and the project's
  hand-off policy (§4.5). This is enforced in `can()`'s token-narrowing step,
  so every REST route and every MCP tool applies it the same way.
- **Attribution:** `activity.agent_id` is nullable. Historic rows keep it null
  and are never back-filled, so the UI shows them as "agent (unregistered
  token)". Legacy tokens keep working unchanged.
- **Token secrets** never appear in activity, comments, URLs or screenshots. The
  existing reveal-and-forget display is reused.
- **Rate limits:** the existing per-token bucket, plus a separate bucket for
  offers (§4.4).

### 4.2 Sessions, claims and fencing (Phase 2)

- **`agent_sessions` table:** `id`, `agent_id`, `token_id`, `started_at`,
  `last_heartbeat_at`, `ended_at`, `end_reason`, `client_version` and `model`
  (both self-reported), `context_revision_seen`.
- **`task_claims` table:** `task_id`, `session_id`, `agent_id`, `generation`
  (a per-task number that only goes up), `lease_expires_at` (server time),
  `state` (`active` | `paused` | `released` | `expired` | `transferred`). A
  partial unique index allows only one live row per task.
- **Fencing.** Every task change made by an agent session carries
  `X-Laika-Claim-Generation` (REST) or `claim_generation` (MCP). A stale
  generation, or an expired lease, gets `409 stale_claim`. The check sits in
  the shared service, so REST and MCP behave the same. Two agents of the same
  human are fenced from each other exactly as two different people's agents
  are.
- **Defaults** (each configurable per deployment):

  | Setting | Default |
  | --- | --- |
  | Heartbeat | every 30 s |
  | Connection suspect | after 90 s |
  | Claim expires | after 5 min |
  | Expiry scan | every 30 s |
  | Checkpoint warning | after 5 min |
  | Offer expires | after 30 min |
  | Completed hand-offs per task | at most 3 |

  Tests use an injected clock.
- **An expired claim is never restored by itself.** Once the expiry scanner has
  marked a claim `expired`, its generation is invalid for good. Any request
  carrying it gets `409 stale_claim`, even if the same session's heartbeats
  start again.
- **Reclaiming is an explicit act.** If no one has accepted the recovery offer,
  the old session may call `POST /api/v1/tasks/:id/claim/reclaim` (MCP: the
  `start_working` argument `reclaim: true`). This is one atomic `BEGIN
  IMMEDIATE` operation that:
  - checks again the owner's permissions, the agent's status and grant, and the
    token's scope;
  - refuses with `409 offer_taken` if any offer for the task is already
    accepted;
  - cancels every open or pending-approval offer for the task with reason
    `reclaimed`;
  - inserts a **new** claim at `generation + 1`;
  - appends activity `claim_reclaimed`. This is one more verb, and it is
    three-owner.

  The helper then carries the new generation. The old one never becomes valid
  again.
- **Recovery speed versus disconnects.** A short expiry recovers work quickly,
  but it also turns a laptop lid closed for six minutes into an orphan. Nothing
  is lost when that happens: expiry only opens an offer, and the owner of the
  laptop can reclaim explicitly as long as nobody has accepted.
- **Heartbeats come from the working process.** The helper renews a claim only
  while the harness process that holds the session is alive, which it checks by
  PID. A helper that outlives its harness stops renewing.
- **Server restart.** Leases are stored as timestamps, so the first expiry scan
  after boot catches anything overdue. During a boot grace period of one
  heartbeat interval, nothing expires.

### 4.3 Checkpoints (Phase 3)

- **`task_checkpoints` table** (rows are never changed):
  - what was saved: `id`, `task_id`, `session_id`, `claim_generation`, `repo`
    (must be the project's configured repo), `branch`, `remote_ref`,
    `commit_sha` (full), `manifest` (files changed, with counts);
  - what the agent wrote: `summary` (work done, next step, decisions, open
    questions, known failing tests) and `summary_commit_sha`, the commit that
    summary describes;
  - bookkeeping: `context_revision`, `created_at`, `verified_at`,
    `verification` (`pending` | `verified` | `missing` | `ref_deleted`), and a
    unique `idempotency_key`.
- **The mechanical manifest and the written summary are separate.** If the
  summary describes an older commit than `commit_sha`, the UI says "Note
  describes an earlier save". If there is no summary, it says "No continuation
  note".
- **The client pushes first and registers second.** If the push succeeds and
  the registration fails, the next attempt registers with the same key.
- **D-005.** A checkpoint is work the agent chooses to register, not telemetry.
  It names files only in the manifest, and never includes file content, diffs
  or prompt text. D-115 records this.
- **Failing tests do not invalidate a checkpoint.** A work-in-progress
  checkpoint with failing tests is valid, and its test status is shown as it
  is.
- **Proof** is set out in §4.3.1. Nothing calls GitHub (D-083, D-116).

### 4.3.1 Verifying a checkpoint, and what that does not prove

- **What a push proves.** A signed GitHub `push` delivery proves that the SHA
  was on that ref **when the push happened**. It does not prove that the
  commit is still available later. Laika never claims that it is.
- **A durable reference.** The checkpoint helper pushes two things: the work
  branch `LAI-NNN-…`, and a lightweight tag
  `laika-ckpt/<LAI-NNN>/<checkpoint-id>` pointing at the checkpoint SHA. The tag is what keeps the commit reachable
  after the work branch is rebased, force-pushed or deleted.
  - Operators are told to protect `laika-ckpt/*` with a repository ruleset
    that blocks deletion and update. The operator guide says how.
  - Whether GitHub sends a `push` delivery for tag creation and tag deletion
    on these refs is **Documented-not-tested**. LAI-545 has to test it.
- **States.** A checkpoint is in exactly one of these states:

  | State | Meaning | UI wording |
  | --- | --- | --- |
  | `pending` | The checkpoint is registered and no matching delivery has arrived | **"Verification pending"** |
  | `verified` | A delivery for the project's configured repo shows the tag, or the branch, at exactly that SHA | — |
  | `ref_deleted` | A later delivery removed the tag | — |
  | `superseded` | Informational only. A newer verified checkpoint exists on the same claim | — |

- **Duplicate deliveries.** Deliveries are de-duplicated by `X-GitHub-Delivery`,
  using the mechanism that already exists. Processing the same delivery twice
  never changes the state twice.
- **Deliveries that arrive out of order.** GitHub gives deliveries no sequence
  number, so the state for each ref is worked out from the *set* of deliveries
  received for it, not from the most recent one:
  - **Verified:** at least one delivery puts the ref at the checkpoint's SHA,
    and nothing later in receipt order deletes or moves the tag.
  - **Ref deleted:** a delete (`deleted: true`) wins over a create that arrived
    *earlier* in receipt order. A create that arrives after a delete restores
    `verified`.
  - The receiver's own fetch (below) is the final check either way.
- **When the webhook never arrives.** The checkpoint stays `pending`.
  - After 10 minutes (configurable), the drawer says **"Verification pending —
    no push notice from GitHub yet"**, and owners and admins are told to check
    the webhook's recent deliveries and use **Redeliver** in GitHub.
  - Laika never marks a checkpoint verified on the agent's word.
  - An automatic recovery offer uses the **latest verified** checkpoint. A
    newer checkpoint that is still pending is shown beside it as unverified.
  - If no checkpoint is verified, the task follows the path in §4.4 for "no
    checkpoint": a human path, never an automatic one.
- **The receiver verifies before it accepts, and that is required.** Before
  accepting, the receiver's helper must:
  1. fetch the checkpoint tag;
  2. check that the tag resolves to exactly `commit_sha`, using
     `git rev-parse` and `git cat-file -e`;
  3. check out that commit in a new worktree;
  4. send `verified_commit_sha` with the accept call.

  The server refuses an accept whose `verified_commit_sha` differs from the
  checkpoint's, with `422 checkpoint_mismatch`, and an accept on a checkpoint
  whose state is not `verified`, with `409 checkpoint_unverified`.
- **Retention.** A `laika-ckpt/*` tag is kept for 90 days after its task
  reaches Done or Cancelled (configurable). Laika keeps the delivery and
  checkpoint rows for at least that long. Laika never deletes tags, because
  nothing calls GitHub. Instead, `laika agent checkpoints prune --dry-run`
  lists the tags that are due for removal, and the operator decides.
- **What keeping D-083 costs.** These are limitations, and they are written
  down as such:
  1. The server cannot confirm that a commit is still available. Only the
     receiver's fetch does that, at accept time.
  2. A deleted ref is seen only if its delivery arrives. If the webhook is down
     or misconfigured, the board says `verified` for something that may be
     gone. The receiver's fetch catches it, with `checkpoint_mismatch` or a
     fetch error, and the offer becomes "Save needs attention".
  3. While the webhook is out, every checkpoint stays pending, so automatic
     recovery quietly falls back to older checkpoints.
  4. Verification is limited to the project's single configured repo. A
     checkpoint in any other repo is refused (`422 repo_not_configured`).
  5. Laika cannot see into private-repo access. Whether the receiver can fetch
     depends on its own local git credentials, and Laika access grants no repo
     access.

### 4.4 Hand-off offers (Phase 3)

`handoff_offers` has these columns:

| Group | Columns |
| --- | --- |
| What and where | `id`, `task_id`, `kind` (`work_request` \| `handoff` \| `recovery`), `idempotency_key` |
| Who | `from_session_id` (null for a work request or a recovery), `to_agent_id` (null means any eligible agent; recovery may use this) |
| What travels with it | `checkpoint_id`, `reason`, `note_hash` |
| Approval | `requires_approval`, `approved_by_user_id`, `approved_at` |
| Life cycle | `state` (`pending_approval` \| `open` \| `accepted` \| `declined` \| `cancelled` \| `expired`), `expires_at`, `accepted_session_id` |

All of the following runs inside one `BEGIN IMMEDIATE` transaction:

- **Only the holder can offer.** A sender may offer a task only while it holds
  that task's active claim. Offering **pauses** the sender's claim: any further
  change gets `409 claim_paused`, although the lease keeps renewing.
- **Recovery offers come from the server.** The expiry job creates them through
  a separate, audited path that acts as the system actor (§3.4). An orphan is
  offered. It is never assigned.
- **Who may receive.** By default, only the same owner's agents. A project may
  open this to other members' registered agents. A transfer to a different
  owner then needs a human approver: the task's assignee or a project admin,
  and **never the receiver itself**.
- **What a hand-off carries.** A hand-off or recovery needs a structured note
  and a **verified** checkpoint. A work request needs neither.
- **Accepting.** The server checks again: permissions, approval, expiry, that
  the checkpoint is still verified, and the hand-off limit. In the same
  transaction it then:
  - marks the old claim `transferred`;
  - inserts the new claim at generation + 1;
  - increments `tasks.handoff_count`;
  - appends the activity rows.
- **Racing receivers.** When two receivers accept, the first commit wins. The
  second gets `409 offer_taken`.
- **Repeats and abuse.** Requests are idempotent by key, and offers have their
  own rate limit. A revoked agent cannot offer, accept or renew.
- **Cancel or decline.** Either one resumes the sender's paused claim. That path
  is explicit, and it is tested.
- **No checkpoint.** The task shows "Automatic recovery unavailable — no saved
  checkpoint". A human then either reassigns the task or releases it to the
  backlog.
- **Untrusted text.** Notes, branch names and repo content are data. The helper
  prints a note inside a delimited block marked untrusted. It never executes
  it or promotes it to an instruction.
- **What fencing cannot do.** It protects Laika's state. It cannot stop a
  disconnected process from editing its own files, or from pushing with its own
  git credentials. That risk is contained by giving each run its own branch,
  and by Review.

**New activity verbs:** `agent_selected`, `claim_expired`, `claim_reclaimed`,
`checkpoint_saved`,
`handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`,
`handoff_cancelled`, `handoff_expired`, `task_recovered`. Each one is a
three-owner change: CHIEF writes the SPEC §4.8 row, CORE adds the enum, and
SHELL adds the client mirror and its wording.

### 4.5 Project hand-off policy

`project_handoff_policies` holds four settings. They are edited on the existing
Access tab of space settings.

| Setting | Default |
| --- | --- |
| `allow_other_owners` | false |
| `cross_owner_requires_approval` | true |
| `max_handoffs` | 3 |
| `offer_ttl_minutes` | 30 |

### 4.6 Delivery and context (Phase 4)

- **The durable inbox comes first.** `GET /api/v1/agents/me/inbox` and the MCP
  tool `agent_sync` return the work requests and offers addressed to the
  calling agent. The helper polls at session start, at each prompt, and every
  N tool calls.
- **SSE is a notice, not the record.** Hand-off events travel on the existing
  `/api/v1/events` stream, filtered to the agent that receives them. Before
  each event the server checks the token's expiry and revocation, the agent's
  status and its grant. This first needs the open-stream revocation fix
  (LAI-539). Cursor replay, gap recovery and de-duplication by event id come
  from the existing stream.
- **Four delivery states,** recorded separately: `available` → `received` (the
  helper acknowledged it) → `presented` (a hook showed it to the agent) →
  `accepted`. None of them claims that the model understood the message.
- **Why SSE and not webhooks.** Laika is self-hosted and the helpers run on
  laptops behind NAT. An outbound SSE connection reaches them; an inbound
  webhook would not. We add no second transport.
- **Context revisions.**
  - `project_context_revisions` rows are never changed: `revision`, `body`,
    `author`, `created_at`.
  - `projects.context_revision` points at the current one, and a write must
    name the revision it replaces.
  - A session records the last revision it saw in
    `agent_sessions.context_revision_seen`.
  - MCP responses carry `context_revision`.
  - The hook injects a notice of at most 300 characters, such as "Project
    context changed: r12 → r14. Call get_project_context or
    `laika context diff`". It never injects the whole document.

### 4.7 The local helper

There is one shared helper, `laika agent …` in `cli/`, with a small adapter for
each harness.

| Command | What it does |
| --- | --- |
| `laika agent session start\|heartbeat\|end` | Opens, renews and closes the agent's session |
| `laika agent checkpoint` | Saves the work (rules below) |
| `laika agent inbox` | Lists work requests and offers for this agent |
| `laika agent accept <offer>` | Fetches the checkpoint, verifies the SHA and prepares a worktree, and only then accepts |
| `laika agent handoff` | Offers the task to another agent |
| `laika agent watch` | The resource watcher. It reports unsupported OS metrics as unsupported. |
| `laika agent launcher` | Opt-in, Phase 5, subject to D-117 |

The checkpoint rules:

- It works in the task's own worktree, on the task's own branch.
- It stages only files that are already tracked or explicitly listed, and it
  refuses any file that matches a secrets pattern.
- It does not run while a git index lock exists or a tool is still running.
- It never force-pushes, and never pushes `master`.

### 4.8 The reviewable UI

The proposed agent UI (LAI-536) is shown as states on `/design/states`, using
neutral chips. The owner decides the agent colour **after** seeing it. Until
then, no design token changes.

## 5. Harness capabilities (documented 2026-10-28)

Every cell is **Documented-not-tested** until an adapter task certifies it on a
real version. "Inject" means hook output that can add context for the model.

| Harness (local version) | Credential | Session start / end | After a tool call | At a prompt | Inject | Headless |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code 2.1.280 | `headers` / `headersHelper` | `SessionStart` / `SessionEnd` | `PostToolUse` | `UserPromptSubmit` | `hookSpecificOutput.additionalContext` | `claude -p` |
| Codex 0.162.1 | `bearer_token_env_var` | `SessionStart` / `SessionEnd` (advisory) | `PostToolUse` | `UserPromptSubmit` | Same as Claude Code, except that a block **replaces** the tool result | `codex exec --json` |
| Cursor IDE / CLI 2026.01.28 | header with `${env:LAIKA_TOKEN}` | `sessionStart` / `sessionEnd` (IDE); the CLI's are unverified | `postToolUse` → `additional_context` | `beforeSubmitPrompt`, which **cannot** inject | After a tool call only | `agent -p` |
| Copilot CLI / VS Code / cloud (not installed) | header with `${LAIKA_TOKEN}`; cloud uses `COPILOT_MCP_*` secrets | `sessionStart` / `sessionEnd` | `postToolUse` → `additionalContext` | `userPromptSubmitted`, whose output is **discarded** | After a tool call only | `copilot -p`; `gh agent-task create` (cloud) |
| Gemini CLI 0.49.0 | `headers`; whether env vars expand in headers is unverified | `SessionStart` / `SessionEnd` | `AfterTool` | `BeforeAgent` | `hookSpecificOutput.additionalContext` | `gemini -p` |
| Antigravity (not installed) | headers in `mcp_config.json` | `SessionStart` / `Stop` | `PostToolUse`, which **cannot** inject (its output is `{}`) | `PreInvocation` | `injectSteps` | `agy -p` |

No harness can interrupt a turn that is already running. The earliest a notice
can arrive is the next tool or model boundary. No harness documents MCP
resource subscriptions, so subscriptions can only ever be an optional extra.

## 6. UX summary

The reviewable screen states come first (LAI-536, on `/design/states`), before
any screen is built.

- **Cards**
  - The human avatar stays.
  - A compact agent chip is added, for example "Claude Code · laptop-1".
  - Exceptional states are spelled out in text, never shown by colour alone:
    Waiting for agent, Waiting for approval, Connection lost, Recovery
    available, Save needs attention.
  - The chip is a new `CardFields` entry, on by default.
  - The existing "created through MCP" badge keeps its current meaning.
- **The task drawer**
  - An **Agent** row sits under Assignee. It is a `Dropdown` combobox of
    eligible agents showing each one's owner, device and availability, and it
    says why an agent cannot be picked.
  - An execution panel shows the intended agent, the session actually working,
    when it was last seen, the last verified checkpoint and its age, and the
    hand-off status.
  - The claim generation and the full SHA sit under "Details".
- **The hand-off dialog**
  - It uses `useDialogFocus`.
  - It shows from → to, the reason, the checkpoint summary and its age, the
    note, and whether approval is needed, with the line "The receiver must
    accept".
  - The sender's screen never shows "accepted" on the receiver's behalf.
- **Inbox → Hand-offs**
  - Filters: Received, Sent, Needs approval, Recovery.
  - The badge counts open items that need *your* action. Expired or resolved
    items never count.
- **Developer access → Agents**
  - A registration wizard in five steps: name, harness and device → projects
    and permissions → credential → harness instructions → verify a request
    from *this* agent.
  - Three states are kept apart: credential created, connected, ready for
    recovery.
- **Settings → Access** holds the hand-off policy.
- **Project context** shows its revision history and which sessions have
  received the latest revision. It never claims a session understood it.

## 7. Phases and estimates

Estimates assume one maintainer working with coding agents. Confidence is H, M
or L. None of this is a promised date.

| Phase | Priority | Children | Effort | Confidence | Main risk |
| --- | --- | --- | --- | --- | --- |
| 1 Identity and visible delegation | P0 | LAI-533 – LAI-539 | 6–9 days | M | `can()` intersection versus the unmerged H4 fix |
| 2 Exclusive sessions | P0 | LAI-540 – LAI-543 | 5–8 days | M | Fencing every path that changes a task, including the MCP wrappers |
| 3 Checkpoints and recovery | P0 | LAI-544 – LAI-551 | 10–15 days | L–M | Verification by webhook only; the two-device experiment |
| 4 Watcher, live notices, context | P1 | LAI-552 – LAI-556 | 6–9 days | M | Delivery behaves differently in each harness |
| 5 Adapters and launcher | P2 | LAI-557 – LAI-558 | 5–8 days | L | Copilot and Antigravity are not installed; the launcher is on the stop list |
| 6 Release qualification | P0 gate | LAI-559 – LAI-560 | 4–6 days | M | Needs both laptops and both vendor accounts |

## 8. Owner decisions and approval

**Who acts.** Every card, comment and task file in this programme is created
through the Laika token in `~/.laika/env` on Belka. That token authenticates as
**Pawan Sirsat** (owner, scope `full`) and records `actor_kind: agent`. Every
commit and PR is authored by GitHub account **PawanSirsat**, through the `gh`
CLI on Belka. A message in a chat session does not change either account's
permissions.

**What counts as approval.** Agents on Belka can write as Pawan, so approval of
D-114 – D-117 must come from somewhere an agent cannot write. It counts only
if it is one of these two:

1. A comment from Pawan's **signed-in web session** on the parent card. The
   activity row must show `actor_kind: user`, not `agent`. The comment reads,
   for example, "Approve D-114, D-115, D-116".
2. A PR review with state **Approved**, submitted in the GitHub web UI by
   PawanSirsat.

Until one of those exists, the decision status stays `proposed`, and the tasks
that depend on it stay `blocked-on-decision`.

**What may proceed without the decisions.**

- LAI-539, the live-stream security fix, depends on no decision.
- LAI-536, which shows the proposed UI as reviewable states on
  `/design/states`, changes no design tokens and builds no live screen.
- LAI-533 drafts the decision and SPEC text.

LAI-534, LAI-535, LAI-537 and LAI-538 are blocked on D-114. Phase 3's server
tasks are blocked on D-115 and D-116.

**Sprints.** The cards stay in the backlog with `phase-N` tags. §8.1 gives a
proposal for which Sprint 10 or 11 items would move to make room for Phase 1
and Phase 2. Nothing is scheduled after January automatically.

**Launcher.** LAI-558 stays parked behind D-117, which is a separate decision
and is not bundled with D-114 – D-116.

**Agent colour.** Until the owner sees the proposed UI in LAI-536 and decides,
agent chips are neutral (`--text-2` on `--bg-2`, using the existing tokens)
with the client's agent mark. No design token changes.

### 8.1 Fitting the critical work into the next sprints (proposal only, not scheduled)

These figures come from a read of the board taken on 2026-10-28 through REST.
No card was moved. Keys are board keys (`LAIKA-NNN`).

**What the sprints hold today.**

- **Sprint 9 (active, ends 28 Oct).**
  - Open: 43 items (4 in progress, 16 to do, 23 backlog).
  - In Review: 77 items.
  - Closing a sprint moves no tasks, so any rollover is a deliberate act.
- **Sprint 10 · Build the gate (29 Oct – 14 Nov).**
  - Seven items, all to do: 423, 479, 480, 481, 482, 483, 484.
  - Six are size L and one is XL.
  - The three P0 build items, #7 – #9 (LAIKA-476 – 478), are **already in Review
    in Sprint 9**. They are not waiting to be built in Sprint 10.
- **Sprint 11 · Open it up + pilot (15 Nov – 14 Dec).**
  - Eleven items, all in the backlog: 437, 485 – 494.

**The proposal.**

1. **Phase 1 (LAI-533 – LAI-539, about 6 – 9 maintainer-days) goes into Sprint
   10.**
   - **Where the room comes from:** the gate's build items, which are already
     in Review. This assumes their review needs little rework.
   - **Nothing moves out of Sprint 10.** The release and pilot chain (479 –
     484) stays where it is.
   - **Absorbed, not displaced:** LAIKA-423 (claim-protocol skill) and
     LAIKA-481 (rules file for every agent) get their agent-session guidance
     rewritten for registered agents. That work is counted once.
2. **Phase 2 (LAI-540 – LAI-543, about 5 – 8 maintainer-days) goes into Sprint
   11.**
   - **Moves later, in this order:**
     1. LAIKA-492 (MCP SDK v2 spike)
     2. LAIKA-437 (MCP list/bulk tools)
     3. If more room is still needed, LAIKA-487 (automatic proof capture).
        Phase 3's checkpoint helper later covers part of it.
   - **Absorbed:**
     - LAIKA-489's claim expiry becomes LAI-541.
     - The "Alice via Codex" attribution half of LAIKA-491 becomes LAI-538.
       Its "needs a human" state stays a card of its own.
   - **Moves only if no pilot team needs it:** LAIKA-490 (GitHub Issues import).
3. **Never moved for this programme:** the security work (LAIKA-456 / 457,
   PR #96) and the pilot itself (483, 485, 493, 494).
4. **Phases 3 – 6** are not placed in any sprint. They wait for the owner's
   verdict at the Sprint 11 checkpoint (LAIKA-494) and for D-114 – D-116.

**Limits.** The forecast API's history is imported and its sizes are relative,
so 6 – 9 and 5 – 8 maintainer-days are a reservation, not capacity anyone has
measured. Sprint 9's 77 items in Review are themselves a real load on the
reviewer.

## 9. The decision text proposed for approval

LAI-533 copies this text into `docs/DECISIONS.md`, but only after approval
arrives as §8 describes. Until then each decision's status is `proposed`.

### D-114 — A registered agent is a named identity owned by one person, acting through its own credential, never with more access than its owner (proposed)

**In one line:** an agent becomes something Laika can name, grant, revoke and
attribute, without stopping being its owner's agent.

**Decision.**

- Laika records **registered agents**. Each agent has:
  - exactly one owner, a human user;
  - a display name;
  - a harness and a device label, both self-reported and labelled as such;
  - project grants (`read_only` or `full`);
  - a status (`active` or `revoked`).
- Each agent authenticates with **its own tokens**. Rotating or revoking one
  agent's token does not affect its owner or the owner's other agents.
- **Effective access** is the intersection of four things:
  - the owner's current permissions;
  - the agent's grant for the project;
  - the token's scope and project pin;
  - the project's hand-off policy.

  `can()` enforces this on every REST route and MCP tool.
- Every action records **both** the owner's `user_id` and the `agent_id`.
- D-010 is unchanged: an agent still acts as its owner and under its owner's
  role. This decision only makes the agent distinguishable and narrowable.
- Tokens issued before this decision keep working, with no agent attached.
  Their history is never back-filled with an invented agent; the UI shows them
  as "agent (unregistered token)".
- The **human assignee**, the **selected agent** and the **active claim** are
  three separate facts.
  - Selecting an agent creates a work request. It does not claim the task, does
    not start a process, and does not change the human assignee.
  - Changing the human assignee is always a separate, explicit action.

**Consequences.** A stolen agent token can act as that agent within its grants.
It is contained by:

- narrow grants;
- local storage of the credential only;
- expiry and rotation;
- immediate revocation, which also closes open event streams (LAI-539);
- the activity log;
- rate limits.

### D-115 — A checkpoint is work an agent registers on purpose, not a heartbeat; D-005 stands unchanged (proposed)

**In one line:** heartbeats stay `{repo, branch, timestamp}`. A checkpoint is a
deliberate save, and it carries only what a person taking the work over needs.

**Decision.**

- A checkpoint is created only by an explicit agent or helper action, inside a
  claimed task.
- It contains:
  - the repo, the branch and the durable checkpoint ref;
  - the full commit SHA;
  - the list of files changed, with line counts;
  - a structured continuation note: work done, next step, decisions, open
    questions, and known failing tests or builds;
  - the commit that note describes;
  - the context revision;
  - the source session and the claim generation;
  - the creation time.
- It **never** contains file contents, diffs, prompts or transcript text.
- The mechanical manifest and the written note are stored separately. A note
  that describes an older commit is shown as **stale**, and a missing note is
  shown as **missing**.
- Notes, branch names and repo content are **untrusted data**. Nothing executes
  them or promotes them into instructions.
- Checkpoints are immutable. They are kept for 90 days after the task is Done
  or Cancelled (configurable).
- A failing test does not invalidate a work-in-progress checkpoint. Its test
  status is shown as it is.

**Consequences.**

- D-005's promise about presence is unchanged.
- The new data is opt-in by action, scoped to one task, and visible to anyone
  who can read that task.

### D-116 — A checkpoint is proved by a signed push delivery and by the receiver's own fetch; Laika still never calls GitHub, so D-083 holds (proposed)

**In one line:** the server learns that a commit *was* pushed. Only the
receiver can confirm that it is *still* there, and it must do so before
accepting.

**Decision.**

- The helper pushes the work branch and a lightweight tag,
  `laika-ckpt/<LAI-NNN>/<checkpoint-id>`, at the checkpoint SHA. Only then does
  it register the checkpoint. Registration is idempotent by key, so a push that
  succeeded followed by a registration that failed is retried safely.
- A checkpoint is `verified` only when a signed `push` delivery for the
  project's configured repo puts that ref at that SHA. Until then the UI says
  **"Verification pending"**.
- Duplicate deliveries are ignored. Deliveries that arrive out of order are
  handled as §4.3.1 describes, and a deletion that arrives later wins.
- A checkpoint is never verified on an agent's word. A checkpoint that is still
  pending cannot be offered or accepted.
- **The receiver must check before accepting.** It fetches the checkpoint ref,
  checks that it resolves to exactly the recorded SHA, and sends that SHA with
  its accept. The server refuses a mismatch.
- Operators protect `laika-ckpt/*` against deletion with a repository ruleset.
- Laika never deletes checkpoint tags. A dry-run command lists the tags that
  are due for removal after 90 days.

**Limitations.**

- **No server-side check of availability.** The server cannot confirm a commit
  is still there.
- **Deletions depend on the webhook.** A deletion is seen only if its delivery
  arrives.
- **An outage leaves checkpoints pending.** While the webhook is out, every
  checkpoint stays pending.
- **One repo.** Verification covers the project's single configured repo.
- **Repo access is separate.** Fetch access is the receiver's own git
  credential, not something Laika grants.
