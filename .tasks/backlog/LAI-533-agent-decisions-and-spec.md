---
id: LAI-533
title: 'Decisions D-114–D-116 and SPEC sections for agents, agent credentials and task agent fields'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

Implements **proposal §3, §4.1, §4.4 (verbs), §8, §9** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

The contract for registered agents exists in writing before any code:
the owner's rulings are recorded as decisions, and SPEC names the new tables,
columns, permissions, endpoints and the `agent_selected` verb, so CORE and SHELL
build against one text.

## Scope

- Draft D-114, D-115 and D-116 — the wording is below, from proposal §9 — and copy it into `docs/DECISIONS.md` **only after approval arrives as proposal §8 describes**. Drafting may proceed now.
- SPEC §2 Glossary: *agent*, *agent owner*, *selected agent*, *work request*, *effective access*.
- SPEC §3.1 / §3.2: rows for registering, renaming, granting, rotating and revoking an agent; SPEC §3.3: the four-way effective-access intersection inside `can()`'s token-narrowing step.
- SPEC §4: new sections for `agents` and `agent_project_grants`; §4.9 `tokens.agent_id`; §4.5 `tasks.selected_agent_id`; §4.8 `activity.agent_id` and the `agent_selected` row.
- SPEC §6.4: the agent register / rename / grants / rotate / revoke endpoints and the task agent-selection write; SPEC §7.1: `laika_whoami` reports the agent.

## Out of scope

- Sessions, claims, checkpoints and offers (LAI-540, LAI-544).
- D-117 (the launcher) — that waits on the owner and LAI-558.
- Any code, and the agent colour (owner question §8.3, D-020).

## Acceptance criteria

- [ ] The draft text of D-114, D-115 and D-116 below matches proposal §9 word for word.
- [ ] D-114, D-115 and D-116 are copied into `docs/DECISIONS.md` only after an approval proposal §8 accepts exists — a comment from Pawan's signed-in web session on the LAI-532 card whose activity shows `actor_kind: user`, or an Approved GitHub review by PawanSirsat — and the entry cites it. Until then this task stays in progress with the decisions `proposed`.
- [ ] SPEC §4 has sections for `agents` and `agent_project_grants` whose columns match proposal §4.1 exactly.
- [ ] SPEC §4.9, §4.5 and §4.8 name `tokens.agent_id`, `tasks.selected_agent_id` and `activity.agent_id`, each nullable, and §4.8 states historic rows are never back-filled.
- [ ] SPEC §3.3 states effective access = `can(owner)` ∩ agent grant ∩ token scope and pin ∩ project hand-off policy, applied identically to REST and MCP.
- [ ] SPEC §4.8 carries the `agent_selected` row, and the task names LAI-535 (enum) and LAI-538 (client mirror) as the other two owners.
- [ ] SPEC §6.4 lists every new endpoint with its `can()` action, and each action has a §3.1 or §3.2 row.
- [ ] The repo-root gate exits 0 after the last edit (`pnpm test`, `pnpm lint`, `pnpm format`), with the parity guards green or red only with a named exemption that LAI-534 retires.

## Tests and UI evidence required

Repo-root gate, three exit codes recorded. `parity.test.ts` and the SPEC/table drift guards: quote any red assertion and the task that turns it green (§4.4 step 1).

## Dependencies

`depends-on: none`.

`agent_selected` is a three-owner verb (CLAUDE.md §4.4): **LAI-533** writes the SPEC §4.8 row, **LAI-535** adds the enum and CHECK, **LAI-538** adds the client mirror and its wording.

**May proceed now, as drafting** (owner, 2026-10-28; proposal §8). It therefore depends on nothing, although it implements LAI-532. D-115 and D-116 are drafted here so the owner rules on D-114 – D-116 together; LAI-544 writes the checkpoint SPEC that cites them.

## Role / machine

CHIEF (polly) on Belka. Only Belka writes `docs/DECISIONS.md` (D-097 §4). Owner area: `docs` (CHIEF).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1–2 days, confidence M.

## Branch

`LAI-533-agent-decisions-spec`

## Migration / rollout notes

Docs only. A SPEC table that has no table yet is carried by the existing `TABLES_NOT_IN_SPEC`-style self-expiring exemption shape, retired by LAI-534.

## Draft decision text (proposal §9, verbatim — status `proposed`)

#### D-114 — A registered agent is a named identity owned by one person, acting through its own credential, never with more access than its owner (proposed)

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

#### D-115 — A checkpoint is work an agent registers on purpose, not a heartbeat; D-005 stands unchanged (proposed)

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

#### D-116 — A checkpoint is proved by a signed push delivery and by the receiver's own fetch; Laika still never calls GitHub, so D-083 holds (proposed)

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

## Approval rule (proposal §8)

**Who acts.** Every card, comment and task file in this programme is created
through the Laika token in `~/.laika/env` on Belka. That token authenticates as
**Pawan Sirsat** (owner, scope `full`) and records `actor_kind: agent`. Every
commit and PR is authored by GitHub account **PawanSirsat**, through the `gh`
CLI on Belka. A message in a chat session does not change either account's
permissions.

**What counts as approval** of D-114 – D-117 — only one of these two, because
agents on Belka can write as Pawan:

1. A comment from Pawan's **signed-in web session** on the parent card, whose
   activity row shows `actor_kind: user`, not `agent` (for example "Approve
   D-114, D-115, D-116").
2. A PR review with state **Approved**, submitted in the GitHub web UI by
   PawanSirsat.

Until one exists, each decision stays `proposed` and the tasks that depend on
it stay `blocked-on-decision`. The proposed decision text is proposal §9.
