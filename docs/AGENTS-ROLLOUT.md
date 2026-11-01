# Rolling out agent identities and hand-off

**For the person running a Laika instance.** How to release, switch on, look
after and roll back the agent-identity and hand-off programme (LAI-532,
proposal `docs/proposals/LAI-532-agent-identities-and-handoff.md`, decisions
D-114 – D-116a, D-120, D-121).

This file is **not** `docs/OPERATIONS.md`. That file holds only procedures a
test performs. Most of what follows has been read from the code, rehearsed
once on a throwaway instance, or is documented and not yet tested. Each
section says which, with these labels:

| Label | Means |
| --- | --- |
| **Rehearsed** | Run once on a throwaway instance; the record is `docs/acceptance/LAI-560-migration-rehearsal.md` |
| **Tested** | Asserted by a test in `server/test/` or `cli/test/` |
| **Live** | Walked on production (`docs/acceptance/LAI-582-phase-1-2-live.md`) |
| **Read** | Read from the code at `1fe55ff1`; not run |
| **Documented-not-tested** | GitHub's or a harness's documentation says so; nobody here has run it |
| **UNVERIFIED** | Not checked at all. Do not rely on it |

The evidence pack, which says what is verified and what is not, is
`docs/acceptance/LAI-532-evidence-pack.md`.

---

## 1. What the release changes in the database

Nine migrations, all forward-only. Drizzle has no down migrations, so **the
only rollback is restoring the pre-deploy backup** (§ 7).

`0060_time_entry_kinds_design` is the last migration **before** the
programme; it belongs to LAI-516 (time entries) and is listed so the boundary
is exact. A production database already at 0060 or later has it.

| Migration | Task | What it adds | Rebuilds a table |
| --- | --- | --- | --- |
| `0061_registered_agents` | LAI-534 | `agents`, `agent_project_grants`; nullable `tokens.agent_id` | no |
| `0062_selected_agent_work_requests` | LAI-535 | nullable `tasks.selected_agent_id`; `handoff_offers` (work requests); `activity.agent_id` and the `task.agent_selected` verb | **`activity`** |
| `0063_agent_sessions_task_claims` | LAI-541 | `agent_sessions`, `task_claims` (one live claim per task, generation unique per task); the claim-expired and reclaimed verbs | **`activity`** |
| `0064_agent_session_harness_model` | LAI-586 | `agent_sessions.harness`, `harness_version`; on `activity`, the session snapshot `agent_session_id`, `session_harness`, `session_harness_version`, `session_model` | no |
| `0065_recognised_agent_devices` | LAI-590 | `recognised_agent_devices`; every device label already in use starts recognised | no |
| `0066_project_context_revisions` | LAI-555 | `project_context_revisions`, `agent_session_context_deliveries`, `projects.context_revision`; each project's `context_md` becomes revision 1 | no |
| `0067_checkpoints` | LAI-545 | `task_checkpoints`, `checkpoint_refs`, `checkpoint_ref_transitions`, `agent_checkpoint_consents`; the `task.checkpoint_saved` verb | **`activity`** |
| `0068_handoff_offers` | LAI-546 | `project_handoff_policies`, `tasks.handoff_count`; the full hand-off offer columns and the hand-off verbs | **`activity`**, **`handoff_offers`** |
| `0069_agent_events` | LAI-553 | `agent_events`, `agent_event_deliveries` | no |

Every new column on an existing table is nullable or has a default, and no
migration back-fills an agent into history (D-114 item 6).

**Four migrations rebuild `activity`**, the append-only log, by
`INSERT … SELECT`. The migrator switches foreign keys off around them and
`runMigrations` re-establishes the append-only triggers at every boot (**Read**:
`server/src/db/migrate.ts`). In the rehearsal every historical activity row
came through byte-identical, with `agent_id` null (**Rehearsed**). On a large
production log the rebuild takes time while the server is not yet listening;
**how long is UNVERIFIED** for production's row count.

## 2. Before the deploy

A push to `master` deploys (D-073). Nothing below is done by CI.

1. **Confirm `LAIKA_SECRET` will not change.** A backup restored under a
   different secret boots and then fails on every encrypted field
   (`docs/OPERATIONS.md` § *Restoring from a backup*, step 0).
2. **Take a backup you control, and keep it off the instance.** On production
   this means the deploy runbook's SSM route: the app's own `better-sqlite3`
   `Database.backup()` inside the container, never a copy of the live
   `laika.db` with its `-wal` beside it. Record its sha256.
   *This step was not run against production by LAI-560.*
3. **Know that the server takes one too.** When migrations are pending, boot
   writes `pre-migration-<ISO time>.sqlite` into the backups directory before
   migrating, under a prefix the nightly prune never deletes (**Tested**:
   LAI-468; **Rehearsed**). It lives on the same volume as the database, so it
   does not replace step 2.
4. **Check the webhook is healthy** before relying on checkpoints (§ 5). A
   push to `master` restarts production, and GitHub does not retry a delivery
   that failed during the restart.

## 3. Switching it on, in order

There is no global feature switch. The deploy lands every phase's schema and
code at once; what turns behaviour on is per project, per agent and per
repository, in this order.

| # | Step | Who | Default after the deploy | Label |
| --- | --- | --- | --- | --- |
| 1 | Deploy; confirm `GET /api/v1/health` and that an existing personal token still answers `GET /api/v1/me` | operator | — | **Rehearsed** |
| 2 | Register one agent per harness per device: *Developer access → Agents*. Session only; an agent's token cannot register or mint (D-121 items 4, 6) | each person, signed in | no agents | **Live** (LAI-582) |
| 3 | Grant the agent its projects, `read_only` or `full` | agent's owner | no grants | **Live** |
| 4 | Leave *Space settings → Access → Agent sessions* (`projects.agents_allowed`) on for the projects agents may work in; turn it off where they may not | project lead or admin | **on** (column default `true`, unchanged by this release) | **Read** |
| 5 | Review the hand-off policy on the same tab (§ 4) | project admin | same owner only, approval for cross-owner, 3 hand-offs, 30-minute offers | **Tested** |
| 6 | Configure the GitHub webhook with **Pushes** selected (§ 5) | repo admin | — | **Documented-not-tested** for checkpoint tags |
| 7 | Add the `laika-ckpt/**/*` tag ruleset (§ 5) | repo admin | none | **UNVERIFIED** |
| 8 | Install the helper on each device and connect the harness (`cli/README.md`) | each person | — | Claude Code **Tested**; Codex **Documented-not-tested** |
| 9 | Give **checkpoint consent** per agent if hooks should save on their own (§ 6) | agent's owner | **off** | **Tested** |
| 10 | Optionally run `laika agent watch` beside the harness | each person | not running | **Tested** with injected readings |
| 11 | Optionally switch on `laika agent launcher` on a device: write `~/.laika/launcher.json` (allowed projects, exact repo paths, argv arrays, limits), `laika agent launcher check`, then `run` (D-117) | each person, on their own device | **off** (no file) | **Tested** with a real child process; a live offer launched end to end is **Unverified** |

**Legacy tokens.** Tokens made before the release keep working with no agent
attached, and their rows read "agent (unregistered token)" (D-114 item 6,
**Rehearsed** for REST and MCP). D-114 asks this plan to propose a date after
which new legacy tokens are discouraged in the UI. **Proposal, for the owner
to decide:** 30 days after the release that ships LAI-551's certification,
because before that the registered-agent path is not certified on two devices.
Nothing in the code does this yet.

## 4. Every configurable default

Where a default can be changed, this says where. **Four of the proposal's
"configurable" settings cannot be changed at deploy time today**: they are
constants in the code (marked *constant*), and one is not built. LAI-1015 is
filed to make the two checkpoint windows §11.7 variables, and LAI-1016 to
build the checkpoint warning.

### Server, per deployment (`docker/` environment, SPEC §11.7)

| Setting | Default | How to change it | Bounds |
| --- | --- | --- | --- |
| Claim heartbeat, and the boot grace | 30 s | `LAIKA_CLAIM_HEARTBEAT_SECONDS` | 1 – 86400 |
| Connection suspect | 90 s | `LAIKA_CLAIM_SUSPECT_SECONDS` | 1 – 86400 |
| Claim expires | 5 min | `LAIKA_CLAIM_EXPIRE_SECONDS` | 1 – 86400, and more than the heartbeat or boot refuses |
| Expiry scan (also the offer-expiry scan) | 30 s | `LAIKA_CLAIM_SCAN_SECONDS` | 1 – 86400 |
| Checkpoint "Verification pending — no push notice from GitHub yet" | 10 min | *constant* `DEFAULT_CHECKPOINT_SETTINGS.pendingNoticeMs` (`server/src/services/checkpoints.ts`) | — |
| Checkpoint record retention after Done / Cancelled | 90 days | *constant* `DEFAULT_CHECKPOINT_SETTINGS.retentionMs`; the `checkpoint.retention` job runs daily | — |
| Checkpoint warning "No save in the last 5 minutes" | 5 min | **not found**: no code at `1fe55ff1` produces it (`grep` of `server/src`, `server/web/src`, `cli/src`) | — |
| Longest-lived token for a `Cloud` agent | 24 h | *constant* `CLOUD_TOKEN_MAX_TTL_MS` (D-121 item 3) | — |
| GitHub delivery and proof rows | 30 days | *constant* `GITHUB_RECORD_TTL_MS` (unchanged by this release) | — |

### Per project (*Space settings → Access*, `project_handoff_policies`)

| Setting | Default | Bounds |
| --- | --- | --- |
| `allow_other_owners`: other members' agents may receive | false | — |
| `cross_owner_requires_approval`: a human (assignee or project admin, never the receiver) approves | true | — |
| `max_handoffs`: completed hand-offs per task | 3 | 0 – 20 |
| `offer_ttl_minutes`: how long an offer stays open | 30 | 5 – 1440 |
| `agents_allowed`: the *Agent sessions* switch | true | — |

### Per agent

| Setting | Default | How to change it |
| --- | --- | --- |
| Checkpoint consent (automatic saves by hooks) | off | *Developer access → Agents* switch, or `laika agent checkpoint consent on\|off`, which asks for the owner's password in a terminal |
| Project grants | none | *Developer access → Agents* |

### Per device (the helper, `cli/`)

| Setting | Default | How to change it |
| --- | --- | --- |
| Session heartbeat | 30 s | `LAIKA_AGENT_HEARTBEAT_SECONDS` (1 – 3600) |
| Pending notice the helper prints | 10 min | `LAIKA_CHECKPOINT_PENDING_NOTICE_SECONDS` |
| Prune listing's retention | 90 days | `laika agent checkpoints prune --dry-run --days N` |
| Watcher: battery threshold, unplugged | 15 % | `--battery-percent` (1 – 99) |
| Watcher: memory pressure sustained | 60 s | `--memory-seconds` (1 – 3600) |
| Watcher: reading interval | 10 s | `--interval-seconds` (1 – 3600) |
| Watcher: Linux PSI threshold | 10 % | `--psi-percent` (1 – 100) |
| Watcher: wait for a verified save before offering | 120 s | `--offer-wait-seconds`; offering at all needs `--offer-to` |
| Launcher | **off** | `~/.laika/launcher.json` with `"enabled": true` (D-117, `cli/README.md`) |
| Launcher: runs at once | none (required) | `max_concurrent`, 1 – 4 |
| Launcher: runtime per run | none (required) | `max_runtime_seconds`, 60 – 86400; SIGTERM, then SIGKILL after 10 s |
| Launcher: poll interval | 30 s | `poll_seconds`, 10 – 3600 |

## 5. GitHub: the webhook and the checkpoint-tag ruleset

Laika never calls GitHub (D-083). A checkpoint becomes `verified` only from a
signed `push` delivery that shows its tag created at its commit (D-116,
D-116a).

**The webhook** (SPEC §10.1): repository or organisation → *Settings →
Webhooks*: *Payload URL* `<LAIKA_PUBLIC_URL>/webhooks/github`, content type
`application/json`, the secret the Organisation screen shows, and at least
**Pushes** among the individual events. One repository per project: a
checkpoint in any other repository is refused `422 repo_not_configured`.

Whether GitHub sends a `push` delivery for creating and for deleting a
`laika-ckpt/*` tag is **Documented-not-tested** (proposal §4.3.1; LAI-545's
live criterion is unticked).

**The ruleset** (D-116 item 2). Repository → *Settings → Rules → Rulesets →
New ruleset → New tag ruleset*:

1. Name it `laika-ckpt`, enforcement **Active**.
2. *Target tags → Add target → Include by pattern*: `laika-ckpt/**/*`. The
   `**` is needed because a ruleset's `*` does not match `/`.
3. Enable **Restrict updates** and **Restrict deletions**.
4. Keep the bypass list to the people who prune (§ 8).

A private repository needs GitHub Pro, Team or Enterprise Cloud for rulesets.
Laika cannot see whether the ruleset exists. Check it by hand at each
release: the ruleset page lists it as Active with that pattern. **That the
ruleset refuses a move or delete of a checkpoint tag is UNVERIFIED** (D-116
testing item f).

## 6. Recovery when a checkpoint is not verified

D-116 item 7. **Not run against a real repository** (D-116 testing items a – c
are unticked on LAI-545); the server half is **Tested** on signed fixture
deliveries.

| Situation | What the board shows | What to do |
| --- | --- | --- |
| `pending` < 10 min | "Verification pending" | wait |
| `pending` > 10 min | "Verification pending — no push notice from GitHub yet" | **Redeliver**: a repository admin opens the webhook's *Recent Deliveries* and redelivers the failed one. Only possible for **3 days** |
| older than 3 days, or never delivered | the same | **Re-tag**: `laika agent checkpoint reverify <id>` pushes `laika-ckpt/<LAI-NNN>/<id>-r<n>` at the same commit, alone in its own push; the new ref's delivery verifies it |
| `uncertain` | "Save needs attention — GitHub's notices do not match a single clean save" | re-tag. `uncertain` is final for that ref |
| webhook down or misconfigured | every new checkpoint stays `pending`; automatic recovery falls back to older verified saves | repair the webhook, then re-tag |

The receiving helper fetches the newest ref and refuses locally if it is
missing or at another SHA, before it accepts. The server records the SHA it
is sent as the **receiver's acknowledgement**, not as proof (D-116 item 8).

## 7. Rollback

**Rehearsed once**, on a synthetic database, not on a copy of production.

### Full rollback: restore the database, then the image

This is the only rollback that returns the instance to its pre-release state.

1. Stop the server.
2. Restore the backup from § 2 step 2 (or the server's `pre-migration-*`
   snapshot) by `docs/OPERATIONS.md` § *Restoring from a backup*: copy **one
   file** over the database and delete any `-wal` and `-shm`. Compare the
   sha256 with the one recorded.
3. Run the pre-release image on it. In the rehearsal the pre-programme code
   (`71dd4217`) booted on the restored file with nothing pending, and the
   legacy token read and wrote over REST and MCP.

**What it loses:** everything written after the deploy, by anyone. In the
rehearsal an edit, a comment and a claim made after the forward migration
were gone after the restore.

On production the image half needs care: CI keeps only the live image in ECR
after a healthy deploy, and a push to `master` deploys. Reverting on `master`
redeploys old code, but **onto the database as it is**, so the restore has to
happen around that deploy, with the instance stopped. The exact production
sequence is the deploy runbook's, and **was not run by LAI-560**.

### Image-only rollback: what CI does by itself

A deploy that does not come up healthy is rolled back to the previous image
**with the database left as migrated**. In the rehearsal, pre-programme code
on the migrated database booted and served legacy tokens. But by the code at
`71dd4217`, which has no notion of agents:

- a registered agent's token is resolved as its owner's token, narrowed only
  by its own scope and pin: **project grants stop narrowing it** (**Read**,
  not run);
- live claims are ignored, so fencing stops;
- new rows carry no agent and no session.

**So after an image-only rollback past 0061: revoke every registered agent's
token, or do the full rollback.** An agent's tokens are its owner's rows in
`tokens`, so they appear under the owner's *Tokens* in pre-release code; that
revoking them there works is **UNVERIFIED**.

## 8. Retention and pruning

| What | Kept | Removed by |
| --- | --- | --- |
| `task_checkpoints`, their refs and transitions | 90 days after the task is Done or Cancelled | the daily `checkpoint.retention` job |
| Transitions for a ref never registered | 90 days after arrival | the same job (**Read**; LAI-545's retention criterion is unticked for the closed-offer half) |
| Activity rows that name a checkpoint | for ever (append-only), keeping its id and SHA | — |
| `laika-ckpt/*` tags in Git | until an operator deletes them | **never Laika**. `laika agent checkpoints prune --dry-run` lists tags of tasks done or cancelled at least `--days` (90) ago and deletes nothing; delete them yourself under the ruleset's bypass |

## 9. Consent and what a checkpoint holds

- Automatic saves need the owner's consent, recorded on the agent with who and
  when; withdrawing it stops automatic saves and leaves manual ones working
  (D-115 item 2).
- A checkpoint holds the repo, branch, ref, full SHA, the files changed with
  line counts and a continuation note. It never holds file contents, diffs,
  prompts or transcripts: there is no column for them (D-115 item 4).
- The note is free text. The helper refuses one that matches its secret
  patterns; that is a mitigation, not a guarantee. Anyone who can read the
  task can read the note.

## 10. Known limitations

From D-116's *Limitations*, the proposal, and the capability matrices in
`cli/README.md`:

1. **The unsaved-work window.** Recovery starts from the last **pushed and
   verified** checkpoint. Work after it, and work that never left the failed
   device, is not recovered. A save the hooks never trigger (a harness that
   does not fire `Stop`, a crash before `SessionEnd`) is not made. With
   consent off, only manual saves exist.
2. **No live check that a commit still exists.** Only the receiver's fetch
   checks, at accept time.
3. **Deletions can go unreported.** GitHub sends no event when more than three
   tags are pushed or deleted at once, and never redelivers on its own. The
   board can show `verified` for a ref that is gone until a receiver fetches.
4. **Webhook outage.** New checkpoints stay `pending`; automatic recovery uses
   older verified ones.
5. **One repository per project.**
6. **Repository access is the receiver's own.** Laika access grants none.
7. **Tag protection depends on the plan and on people.** Anyone with bypass
   can delete a tag early, and Laika cannot see a missing ruleset.
8. **Fencing protects Laika's state only.** A disconnected process can still
   edit its own files and push with its own credentials; a per-run branch
   and Review contain that.
9. **Notices arrive at the next tool or model boundary.** No harness can
   interrupt a running turn.
10. **Short expiry versus a closed lid.** A claim expires after 5 minutes of
    silence. Nothing is lost: expiry opens a recovery offer, and the owner can
    reclaim explicitly until someone accepts.
11. **Self-reported fields.** Harness, device label, version and model come
    from the client and are shown as self-reported.
12. **The launcher starts nothing on a device that is off.** It never wakes,
    powers on or reaches a sleeping laptop; offers wait on the board. It
    enforces runtime and concurrency, not cost or tokens (D-117 item 5), and
    it does not launch work requests (LAI-1039). It has no status on the
    board yet (LAI-1038).

## 11. Release checklist

- [ ] `LAIKA_SECRET` unchanged.
- [ ] Off-instance backup taken, sha256 recorded.
- [ ] Webhook delivering (*Recent Deliveries* shows recent `push` events
      answered 2xx).
- [ ] `laika-ckpt/**/*` ruleset Active, with Restrict updates and Restrict
      deletions, on every repository a project names.
- [ ] After the deploy: health, an old personal token's `GET /me`, a project's
      activity history.
- [ ] Rollback owner named, and this file's § 7 read by them.
