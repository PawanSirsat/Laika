# Agent hand-off failure matrix — server-side qualification

LAI-559 (board LAIKA-811), part of LAI-532 / LAIKA-785. Built on Belka,
2026-10-31, on branch `LAI-559-failure-matrix` from `origin/master` `1fe55ff1`.

**What this document is.** Each failure case from the programme brief (the
LAI-559 task file's *Required failure cases* and the central demonstration),
mapped to the automated test that proves it, **or** marked **UNVERIFIED** with
the real-device or real-GitHub step it still needs. A test in this repo runs in
one process on one machine. It drives the real routes, the real MCP endpoint,
real SQLite and HMAC-signed `push` deliveries. It never touches a second
device, a real harness process tree or GitHub itself, and **no row below
claims otherwise**.

**What is new in LAI-559.** One suite,
`server/test/http/handoff-failure-matrix.test.ts`, covers the two cases no
other test covered. Everything else is cited where it is already proven, not
repeated. A citation is `file` › `test name`, with the name quoted exactly so
it can be grepped.

**Bugs found:** none. No case showed product behaviour that differs from SPEC
§4.66–§4.75, so no task was filed and nothing is `test.todo` or `skip`.

## Summary

| | Count |
| --- | --- |
| Rows wholly proven by automated tests | 21 |
| Rows proven only in part; the rest is UNVERIFIED | 3 |
| Rows wholly UNVERIFIED (need devices or real accounts) | 2 |
| Product bugs found | 0 |

Rows proven in part: 1 (the central demonstration), 12 (agent crash with a
surviving helper) and 15 (push succeeded, registration retried).

Wholly UNVERIFIED: 2 (different vendor accounts) and 26 (agent screens:
keyboard and accessibility scan).

Abbreviations: **SH** `server/test/services/handoffs.test.ts`, **RH**
`server/test/http/routes/handoffs.test.ts`, **SC**
`server/test/services/claims.test.ts`, **RC**
`server/test/http/routes/checkpoints.test.ts`, **AS**
`server/test/http/routes/agent-sessions.test.ts`, **EV**
`server/test/http/routes/events.test.ts`, **AE**
`server/test/http/routes/agent-events.test.ts`, **FM**
`server/test/http/handoff-failure-matrix.test.ts` (new).

## The matrix

| # | Case | Result | Evidence |
| --- | --- | --- | --- |
| 1 | **Central demonstration** (9 steps) | **PROVEN, server half · UNVERIFIED, two-device half** | FM › `claim → verified saves → silence → Connection lost → expiry → recovery offer → a Codex agent accepts → the old holder is stale_claim on REST and MCP → finish → only a person accepts`. In one process, this runs steps 2, 4, 6, 8 and 9 end to end: a work request, a claim, two saves verified only by signed pushes, `connection: suspect`, expiry, one recovery offer for the latest verified save, accept with the exact SHA (a wrong SHA is `checkpoint_mismatch`), the old holder `stale_claim` on REST PATCH, checkpoint POST and MCP `update_task`, finish into review, the agent refused done, a person accepting. **UNVERIFIED:** steps 1, 3, 5 and 7 as written, which are agent A on Belka and B on Strelka, a real `kill -9` of A's harness, B fetching the `laika-ckpt/` tag from GitHub and checking its SHA locally, and B continuing from that commit in its own worktree. That needs the two-machine run booked on LAIKA-660. The CLI side of steps 3 and 5 is covered on one machine by `cli/test/agent-session-e2e.test.ts` and `cli/test/agent-handoff-e2e.test.ts` (rows 12 and 18). |
| 2 | Different vendor accounts | **UNVERIFIED** | Laika never sees a vendor account (an Anthropic or OpenAI login). It sees only the agent's token, harness and device label, so no server test can prove this. Needs: two harnesses signed in to different vendor accounts, on two devices, running row 1. |
| 3 | Claude Code → Codex recovery | **PROVEN (new)** | FM, the row-1 test. Agent A is `harness: 'claude-code'` on `Belka`; agent B is `harness: 'codex'` on `Strelka`. B accepts A's recovery and ends selected and holding generation 2. Before LAI-559, every hand-off and recovery fixture used `claude-code`. |
| 4 | Same-owner hand-off | **PROVEN** | SH › `moves the claim atomically: transferred, generation + 1, the receiver selected, one hand-off counted`; RH › `offer, retry, inbox, accept: the claim moves and the old holder is stale_claim` |
| 5 | Approved cross-owner hand-off | **PROVEN** | SH › `waits for an approver — never its receiver’s owner — and then the receiver accepts`; SH › `an unnamed recovery is the expired claim’s owner’s; another owner’s agent waits for a named approval`; RH › `after a cross-owner accept, the receiver renews its claim though the assignee is the sender’s owner` |
| 6 | Wrong-project rejection | **PROVEN** | `server/test/mcp/agent-tokens.test.ts` › `a project with no grant: create_task and get_project_context both answer agent_not_granted`; `server/test/http/routes/selected-agent-owns-claim.test.ts` › `REST claim, an agent with no grant on the project`; RC › `refuses a repo other than the project’s configured one with repo_not_configured` |
| 7 | Insufficient-scope rejection | **PROVEN** | SC › `refuses a token without full scope: token_read_only`; `server/test/mcp/agent-tokens.test.ts` › `a read_only grant on a full token refuses the write and keeps the read`; `server/test/http/routes/heartbeats.test.ts` › `refuses a read_only token` |
| 8 | Token revoked during a session | **PROVEN** | AS › `a revoked agent’s heartbeat is refused at the door and renews nothing`; SC › `revoking the agent ends its sessions; a heartbeat from them is refused and renews nothing`; SH › `a revoked agent cannot accept: its credentials are read again inside the accept` |
| 9 | Token revoked during an open event stream | **PROVEN** | EV › `closes a revoked token stream with unauthorized before the next event`; EV › `closes an idle revoked token stream on the keepalive check`; EV › `closes with the one unauthorized frame when the owner revokes the agent`; AE › `revoking the agent closes its stream with the unauthorized frame, and refuses its poll`. Also walked live on production in `LAI-582-phase-1-2-live.md` deliverable 8, on one device. |
| 10 | Two receivers race to accept (true concurrency) | **PROVEN** | SH › `two receivers in two processes, released together: exactly one wins, the other is offer_taken`. These are two OS processes, each with its own SQLite connection (`server/test/helpers/accept-racer.ts`), contending for the write lock. |
| 11 | Old session reconnecting after transfer cannot change the task | **PROVEN** | RH › `offer, retry, inbox, accept: the claim moves and the old holder is stale_claim` (REST: `stale_claim`, `claim_state: transferred`); RH › `offer_handoff, agent_sync, respond_handoff: the same answers as REST` (MCP); `server/test/mcp/claims.test.ts`'s per-tool census of stale `claim_generation`; FM, row 1 (after a recovery: late heartbeat restores nothing; REST and MCP `stale_claim`) |
| 12 | Agent crash, helper survives (helper stops renewing) | **PROVEN on one machine · UNVERIFIED across devices** | `cli/test/agent-session-e2e.test.ts` › `a killed harness is renewed no more within one interval; its claim expires and goes stale`, where the harness is SIGKILLed while the watcher lives; `cli/test/agent-session.test.ts` › `a dead harness sends nothing and the session is abandoned, not ended`; server half: SC › `marks a lapsed lease expired on the next scan and writes task.claim_expired as the system`. **UNVERIFIED:** each real harness's process tree (Claude Code, Codex) under the shipped helper on its own device. |
| 13 | Temporary network loss: gap shorter than expiry keeps the claim; longer gives a recovery offer, never auto-restore | **PROVEN** | SC › `a heartbeat in time renews the lease from now`; SC › `is never restored by itself: heartbeats resume, and the old generation is still stale_claim`; SC › `a heartbeat that arrives after the lease lapsed expires it there, rather than reviving it`; SH › `a late heartbeat’s expiry opens the recovery too`; AS › `the expired generation stays refused after heartbeats resume; reclaim issues the next` |
| 14 | Server restart: boot grace, then the expiry scan catches up | **PROVEN** | SC › `nothing lapses during the boot grace; the first scan after it expires everything overdue`; SC › `a session heard during the grace keeps its claim: its heartbeat renews the overdue lease`. Note: a *restart* here is `configureClaims({ bootedAt })`, not a stopped process. Leases are timestamps in SQLite, so the outcome does not depend on the process. |
| 15 | Push succeeded, registration retried with the same idempotency key | **PROVEN · real push UNVERIFIED** | RC › `registering twice with one key returns the same row and writes one checkpoint_saved`; RC › `a retry with the same key and body still answers 200 after the claim was paused by an offer`; `cli/test/agent-checkpoint-e2e.test.ts` › `push succeeds and registration fails: the next run registers with the same key, and the board has one`. **UNVERIFIED:** a real tag push to GitHub whose webhook delivery arrives at production. |
| 16 | Missing checkpoint: no automatic recovery, a person's path only | **PROVEN** | SC › `opens no recovery offer for a claim that expired with no verified checkpoint (§4.73)`; SH › `a task with no verified checkpoint gets no recovery offer`; `server/test/services/task-handoff.test.ts` › `is false for an expired claim with no save` |
| 17 | Stale semantic note ("Note describes an earlier save") | **PROVEN (server half new)** | FM › `a note for an earlier commit is served with summary_commit_sha ≠ commit_sha; hostile text is returned byte for byte, as data`: the server returns both SHAs so a reader can tell. By SPEC §4.70 the label is derived by the reader, not stored: `server/web/test/components/agent/handoff-derive.test.ts` › `summary_commit_sha ≠ commit_sha: Note describes an earlier save`; `server/web/test/browser/handoff-drawer.test.ts` › `the latest verified save, and a newer one whose notice is late, both from API fields` |
| 18 | Conflicting and deleted remote refs (D-116a) | **PROVEN** | `server/test/services/checkpoints.test.ts` › `never returns to verified once the set holds a deletion or a foreign transition (D-116a)`; RC › `create then delete is ref_deleted`; RC › `a delete received before its create is uncertain, and the create makes it ref_deleted, never verified`; RC › `a moved tag (an update) is uncertain`; RH › `an accept on a ref_deleted checkpoint is 409 checkpoint_unverified`; `cli/test/agent-handoff-e2e.test.ts` › `a deleted tag: Save needs attention, and accept is never called` |
| 19 | Expired, declined and cancelled offers | **PROVEN** | SH › `the scan expires a live offer at expires_at and the paused claim resumes`; SH › `refuses an offer past its time even before the scan writes it`; SH › `a decline resumes the sender’s paused claim`; SH › `a cancel — the sender’s, or a person’s — resumes it too`; RH › `decline and cancel resume the sender’s claim` |
| 20 | Hand-off limit (3) | **PROVEN** | SH › `the fourth completed hand-off is refused at the default limit of 3`; SH › `an accept past a limit lowered after the offer is handoff_limit` |
| 21 | Duplicate delivery is idempotent | **PROVEN** | RC › `the same X-GitHub-Delivery twice changes the state once`; RC › `a delivery whose handler failed before applying it is applied on redelivery (a)`; `server/test/http/routes/webhooks.test.ts` › `deduplicates a redelivery within the window`; AE › `acknowledging a replayed delivery twice records one received` |
| 22 | Malicious note stored and returned as inert text | **PROVEN** | FM, the row-17 test: `<script>`, `onerror`, prompt-injection text and a JSON-breaking string are returned byte for byte in the checkpoint list and the receiver's inbox, and so is a hostile offer `reason`. RH › `offer, retry, inbox, accept: the claim moves and the old holder is stale_claim` checks the inbox `next_step` verbatim. `cli/test/agent-handoff-e2e.test.ts` › `show prints the malicious note verbatim inside the untrusted block, and nothing runs` |
| 23 | Context-update replay | **PROVEN** | `server/test/mcp/context-revision.test.ts` › `records the revision delivered, and stamps it on later answers`; › `a session behind gets a short notice naming revisions, never the document`; `server/test/services/context-deliveries.test.ts` › `is the latest delivery only: a session given N+1 leaves N’s list`; AE › `replays after a reconnect with the same event id, and the stream carries the acked state` |
| 24 | Legacy tokens and historical attribution ("agent (unregistered token)") | **PROVEN** | SC › `a person or a legacy token claims by assignee alone: no claim row`; SC › `refuses a legacy token while the claim is live: it cannot bypass it (D-114 item 6)`; `server/web/test/routes/screens/board/actor-presentation.test.ts` › `a legacy token reads as an unregistered one, and a person’s row has no via`. Also walked live in `LAI-582-phase-1-2-live.md` deliverable 5. |
| 25 | Review still needs a person (an agent cannot mark Done) | **PROVEN** | `server/test/services/review.test.ts` › `is refused review → done by category, with the reason and the way forward`; › `both are a web session’s: a token is refused session_required and nothing moves`; FM, row 1 (`agent_cannot_mark_done` after a recovered finish; a person accepts) |
| 26 | Agent screens: keyboard only and an accessibility scan, light and dark, 390 px and desktop | **UNVERIFIED** | This server-side pass does not cover it. It needs the Playwright browser qualification of every agent screen on Strelka (`CLAUDE.md` *Two machines*: heavy browser runs). LAI-559's third acceptance criterion stays open on it. |

## How to re-run the new suite

```bash
cd server
npx vitest run test/http/handoff-failure-matrix.test.ts --maxWorkers=1; echo "EXIT $?"
```

Measured 2026-10-31 on Belka: `Tests 2 passed (2)`, `EXIT 0`. A mutation check
made `openRecoveryIfDue` return `null`. The demonstration then went red at
`expected [] to have a length of 1`. The source was restored and the diff is
empty.

## What is still needed for a full LAI-559 pass

1. The two-device run of row 1, with rows 2, 12 and 15's device and GitHub
   halves, on Belka plus Strelka (book it on LAIKA-660).
2. Row 26's browser and accessibility qualification.
3. The repo-root gate, run by CI on this PR.
