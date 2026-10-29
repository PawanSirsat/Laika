---
id: LAI-592
title: 'Cloud and shared devices: <harness> · Cloud agents with short-lived credentials and a stated owner; another person''s laptop is their agent'
area: server
assignee: strelka
priority: p2
depends-on: [LAI-590]
discovered-from: LAI-532
status: review
started: 2026-10-29T10:29:42Z
finished: 2026-10-29T10:37:12Z
---

Phase 2.5 slice from `docs/proposals/LAI-532-phase-index.md` (PR #121). Two
owners (§4.4): **docs** — a proposed decision and the SPEC rows — and **CORE**
— the server rule. Named docs edits this task authorises (D-033): a new
proposal section in `docs/proposals/LAI-532-agent-identity-model.md` (or a
sibling proposal file) and SPEC §4.63 and §4.9; nothing else under `docs/`.
Board card: LAIKA-846, parent LAIKA-785.

## Goal

A cloud runner is a device like any other, named `<harness> · Cloud`, but its
credential lives briefly and the agent always says which person it acts for.
And an agent on someone else's laptop is **that person's** agent under their
own owner (D-114), never a credential of yours left on their machine.

**User-visible outcome:** the Devices view (LAI-591) shows a *Cloud* device
whose agents read "Codex · Cloud — owner Pawan — credential expires in 50 min";
registering an agent for a colleague's laptop is refused, with a line telling
the colleague to register their own.

## Scope

- **docs:** a proposed decision (numbered by Belka when recorded; D-120 if
  free) covering: cloud agents carry a token with a mandatory short expiry
  (proposed default ≤ 24 h, the builder proposes the number with a reason);
  the owner is the person who registered it and is shown on every line that
  names it; a laptop that is not the owner's carries the laptop owner's own
  agent. Approval from Pawan's own account, as D-118/D-119.
- **CORE:** an agent marked cloud (device label `Cloud`, or a field the
  decision chooses) can only hold tokens with an expiry within the limit;
  minting one without, or longer, is `422`; an expired token is refused as any
  expired token is today. The owner's display name is on the agent read and
  device list.
- **CORE:** the stated-owner rule is enforced by what exists: an agent's owner
  is always the session user who registered it (§4.63); add no way to register
  an agent for another user. A test proves that path stays closed.

## Exclusions

- No cloud runner integration, secrets store or CI wiring; Laika only bounds
  the credential.
- No UI change beyond fields LAI-591 already renders; if new UI is needed it is
  a new SHELL task.
- No change to D-114's owner-cap rule.

## Acceptance criteria

- [ ] docs: the proposed decision is written and linked from the phase index;
      SPEC §4.63 and §4.9 record the cloud expiry rule; nothing else in
      `docs/` is touched — **Belka's docs half**; the text is below under
      *Proposed docs half (for Belka)*
- [x] Minting a token for a cloud agent with no expiry, or past the limit, is
      `422` with a `code` naming the rule; within the limit it succeeds
- [x] A cloud agent's expired token is refused exactly as an expired personal
      token is; the agent's other devices are untouched
- [x] Agent reads and the device list carry the owner's display name
- [x] No route or tool registers an agent whose owner is not the calling
      session user; a test asserts the refusal
- [x] Tests: REST for each rule, each broken on purpose and seen red
- [ ] Gate: repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 —
      red only on the §4.4 client half (LAI-320's quoted assertion below);
      exit codes in the log and the PR

## Dependencies

- LAI-590 (Devices view, server half) — the device list this extends.
- The proposed decision needs approval from Pawan's own account before merge.

## Role, machine, effort

- Role: Belka (CHIEF for the docs half, CORE for the server half), §4.4.
  Machine: **Belka** (`host-belka`). Cross-vendor review.
- Effort: **L**. Confidence: **low** — the cloud marker and the expiry limit
  are open questions until the decision is written.

## Tests and evidence

- Vitest REST tests beside the agents and tokens tests. No UI evidence in this
  task.

## Rollout

The decision first, then the server rule. Existing agents are not cloud agents,
so nothing changes for them. A cloud agent registered before the rule ships
keeps working until its tokens are rotated; rollback is a revert.

## Depends-on deviation (§2 step 1)

`depends-on: [LAI-590]`, and LAI-590's task file is still in `.tasks/review/`,
not `.tasks/done/`, when this was claimed. Its server half — the device list
this task extends — is merged to `master` as PR #132 (`92997d7a`,
2026-10-29T15:53:14+05:30), and Belka's hand-off on LAIKA-846 says to start
after #132 merges. Strelka claimed on that direction, against `92997d7a`, and
records the deviation here rather than reading the rule loosely.

## CORE half — what was built (Strelka)

Files: `server/src/services/agents.ts`, `server/test/http/routes/agents.test.ts`.

### Design choices

- **The cloud marker is the device label, compared normalised**: an agent whose
  `device_label` key (`deviceLabelKey`, trim + lower-case — the one LAI-590
  groups by) is `cloud` is a cloud agent. `Cloud`, `CLOUD` and ` cloud ` all
  are; `Cloudy laptop` is not. Why: it is the smallest change the server can
  enforce — no column, no migration, no new client field — and LAI-591's
  Devices view already renders it, because it groups by that label and shows
  the agent as `<harness> · <device>`, which is exactly the `Codex · Cloud`
  the task names. A dedicated field would need a migration, a SPEC §4.63 row,
  a client mirror and UI to set it, for no rule the label cannot carry. The
  cost: `device_label` stops "deciding nothing" (§4.63) — it now decides this
  one thing. That is safe because the rule only protects **the owner's own
  credential**: an owner who leaves a runner unlabelled loses the protection
  for their own token and gains no access, and every mint is still capped by
  their role and the agent's grants (D-114).
- **The limit is 24 hours**, in one constant, `CLOUD_TOKEN_MAX_TTL_MS`
  (`server/src/services/agents.ts`). Why: it is the task's proposed ceiling;
  it covers a runner's longest single job and lets a daily schedule mint a
  fresh token per run, while a secret copied out of a runner's environment or
  logs is dead within a day. Anything shorter (e.g. 1 h) breaks long agent
  jobs that cannot re-mint mid-run, since minting is session only.
- **Where the rule bites — every way a token comes to be a cloud agent's:**
  `POST /agents` with a Cloud label; `POST /agents/:id/rotate-token` on a
  Cloud agent (an absent `expires_at` carries the old expiry, which then must
  itself pass — so a cloud agent registered before the rule keeps working
  until it is rotated, as the Rollout section says, and cannot rotate into
  another unbounded token); and `PATCH /agents/:id` relabelling into Cloud,
  refused while any live (unrevoked, unexpired) token is outside the rule.
  `POST /tokens` cannot mint an agent token at all, so it needs nothing.
- **A past or present `expires_at` on a cloud agent is
  `cloud_token_expiry_required`** (review round 1, Codex). The cloud check
  now runs *before* the general `futureExpiry()` on register and rotate, so a
  cloud agent's refusal always names its rule. Why `required` and not a third
  reason: an expiry already past gives the token no life at all, which breaks
  the same rule as no expiry — "a cloud token must carry a usable expiry" —
  while `too_long` is the ceiling. Non-cloud agents keep the general `422`
  with no `reason`, unchanged (asserted).
- **The boundary is inclusive**: exactly `now + 24 h` succeeds and one
  millisecond more is `too_long`, pinned with a fixed clock on register,
  rotate and relabel. `updateAgent()` takes an injectable `now`, as register
  and rotate do.
- **Normalisation is `trim().toLowerCase()`**, the same as LAI-590's device
  key: `String.prototype.trim` strips Unicode white space, so NBSP, em space
  and ideographic space around `Cloud` count as cloud. Compatibility and
  confusable forms — fullwidth `Ｃｌｏｕｄ`, Cyrillic `Сloud`, a zero-width
  space inside — are other labels and stay non-cloud, as the proposed
  decision says.
- **The `code` naming the rule.** §6.3's codes are a closed set of ten, so a
  new code is not available; following the existing convention
  (`agent_revoked`, `session_required`, `claim_held`) the code is
  `unprocessable` (`422`) and `details.reason` names the rule:
  `cloud_token_expiry_required` (no expiry) or `cloud_token_expiry_too_long`
  (past the limit; `details` also carries `max_expires_at` and `max_ttl_ms`).
- **Expired cloud tokens**: no new code. `findTokenBySecret` already refuses
  any expired token; the test proves the cloud token's `401` body is
  byte-identical to an expired personal token's, and that the owner's agent on
  another device keeps working and the cloud agent is not revoked.
- **The owner's display name**: `AgentView.owner_display_name`, read live from
  `users.name` (a rename shows at once). It is on `GET /agents`,
  `GET /agents/:id`, each device's `agents` in `GET /agents/devices`, and the
  register/rotate `201`s.
- **The stated owner** is enforced by what exists: `owner_user_id` is
  `actor.userId`, `RegisterBody` is strict, and registration is session only.
  Tests: a body naming `owner_user_id`, `user_id` or `owner_id` is `422` for a
  member and for the org owner, and inserts nothing; the org owner registering
  owns the agent; and a source scan proves the only `insert(agents)` is in
  `services/agents.ts`, the only caller of `registerAgent` is
  `http/routes/agents.ts`, and no `server/src/mcp/` file imports the agents
  service. No new way to register for another user was added.
- One existing LAI-590 test (`recognition belongs to an owner and label…`)
  relabelled an unbounded agent to `Cloud` as an arbitrary label; its agent
  now registers with a 1 h expiry so it still tests the label move.

### Mutations (each broken on purpose, seen red, restored)

Run on `server/test/http/routes/agents.test.ts` with
`npx vitest run test/http/routes/agents.test.ts`; the harness asserted the
anchor matched exactly once and the file changed before running, and
restored the file and compared its SHA-256 after. **Re-run in full after
review round 1** on `bae80dd3`; baseline 48/48 pass. Every mutation exits 1.

| # | mutation | result | red test(s) |
| --- | --- | --- | --- |
| M1 | register skips the cloud check | 5 failed | no expiry; past the limit; past/present expiry; exact boundary; Unicode spaces |
| M2 | the limit is never enforced (`false &&`) | 3 failed | register past the limit; rotate past the limit; exact boundary |
| M3 | rotate skips the cloud check | 4 failed | rotate within the limit; pre-rule cloud agent; past/present expiry; exact boundary |
| M4 | relabel into Cloud skips the check | 2 failed | relabelling is refused; exact boundary (relabel) |
| M5 | `lapsed()` ignores expiry for agent tokens | 1 failed | expired cloud token refused exactly as an expired personal token |
| M6 | `owner_display_name` always `''` | 1 failed | agent reads and the device list carry the owner's name |
| M7 | `RegisterBody` is `z.object` (strips unknown) | 2 failed | a body naming an owner is refused; (existing) body naming an agent id |
| M8 | `mcp/write-tools.ts` imports `registerAgent` | 1 failed | no route or MCP tool reaches registration except `POST /agents` |
| M9 | a past expiry is not the cloud rule (`<= now` dropped) | 1 failed | past/present expiry is `cloud_token_expiry_required` |
| M10 | register: `futureExpiry()` before the cloud check | 1 failed | past/present expiry (register) |
| M11 | rotate: `futureExpiry()` before the cloud check | 1 failed | past/present expiry (rotate) |
| M12 | boundary off by one (`>=`) | 1 failed | exactly now + limit succeeds |
| M13 | relabel checks against `now − 1 ms` | 1 failed | exact boundary (relabel) |
| M14 | ASCII-only trim in `cleanDeviceLabel` and `deviceLabelKey` | 2 failed | Unicode spaces around Cloud count; (existing) LAI-590 grouping |
| M15 | cloud match folds compatibility forms (NFKC) | 1 failed | look-alikes stay non-cloud |

### §4.4: the client half is red, and is LAI-320

`AgentView` is mirrored by `RegisteredAgent` in `server/web/`, and
`clientOmits` lives there (SHELL's), so CORE could take no exemption. This
branch is red on exactly one assertion:

```
server/web/test/api/view-type-drift.test.ts
  not ok 2 - no server field is missing from its client type
    AgentView.owner_display_name is served and RegisteredAgent does not declare
    it — add it, or list it in clientOmits with a reason
```

**LAI-320** (`area: shell`, filed from Strelka's block) declares the field and
turns it green. Merge per §4.4: this half into local `master` unpushed, then
LAI-320, then push as one state.

## Proposed docs half (for Belka)

Belka's half; Strelka edits nothing in `docs/`. Number at recording (D-120 if
free). Approval from Pawan's own account, as D-118/D-119.

### Proposed decision

> **D-120 — A cloud agent holds only short-lived tokens, and every agent is
> its registering person's (LAI-592)**
>
> 1. **A cloud agent is one whose device label is `Cloud`**, compared as
>    §4.63 normalises labels (trimmed, lower-cased): no new field. The
>    Devices view already shows it as `<harness> · Cloud`.
> 2. **Its tokens must expire, within 24 hours** of being minted
>    (`CLOUD_TOKEN_MAX_TTL_MS`). Registering one, rotating one of its
>    tokens, or relabelling an agent into `Cloud` while it holds a token
>    outside the rule is `422 unprocessable` with `details.reason`
>    `cloud_token_expiry_required` (none, or one already past) or
>    `cloud_token_expiry_too_long` (more than 24 hours; exactly 24 is allowed).
>    A label is cloud when `trim().toLowerCase()` gives `cloud`; look-alike
>    and compatibility forms (fullwidth, Cyrillic, zero-width) are not.
>    Why 24 h: a runner's longest job and a daily schedule both fit, and a
>    secret leaked from a runner is dead within a day; minting is session
>    only, so a shorter limit would cut long jobs off mid-run.
> 3. **An expired cloud token is refused as any expired token is** — `401`,
>    the same body; the agent and the owner's other devices are untouched.
> 4. **The owner is the person who registered it**, always the session user;
>    no route, body field or tool registers an agent for anyone else. Every
>    agent read names them (`owner_display_name`).
> 5. **Another person's laptop carries that person's own agent**, registered
>    by them under their own owner (D-114); you never leave a credential of
>    yours on their machine. Laika enforces the half it can — nobody can
>    register an agent for someone else.
> 6. A cloud agent registered before this keeps its token until rotated;
>    `device_label` now decides this one thing, which protects only the
>    owner's own credential and grants no access.

### Phase index link (`docs/proposals/LAI-532-phase-index.md`, Phase 2.5)

The *Cloud and shared devices* row: append `— D-120 (proposed), LAI-592` to
its Slice cell and set Status to `Review (CORE #<PR>)`.

### SPEC §4.63 — exact wording

In the field table, replace the `device_label` row with:

> | `device_label` | nullable, at most 80 characters, **self-reported**. Decides one thing: a label whose normalised key (trimmed, lower-cased) is `cloud` marks a **cloud agent**, whose tokens must expire within 24 hours (§4.9, D-120). Otherwise decides nothing |

After the paragraph that begins **Revoking an agent**, add:

> **A cloud agent's tokens are short-lived** (D-120, LAI-592). Registering a
> cloud agent, rotating one of its tokens, or relabelling an agent into
> `Cloud` while any live token it holds breaks the rule is `422` with
> `reason` `cloud_token_expiry_required` (no `expires_at`, or one not in
> the future) or `cloud_token_expiry_too_long` (more than 24 hours ahead;
> exactly 24 hours is allowed;
> `CLOUD_TOKEN_MAX_TTL_MS`). A rotation with no `expires_at` carries the old
> expiry, which must itself pass. **The owner is always the session user who
> registered it**: no body field names an owner, and nothing registers an
> agent for another person — an agent on someone else's laptop is theirs to
> register (D-114). Every agent read carries `owner_display_name`, the
> owner's current `users.name`.

### SPEC §4.9 — exact wording

Append to the `agent_id` row's notes:

> A token whose agent is a cloud agent (§4.63) always has an `expires_at` at
> most 24 hours after it was minted (D-120); once past it, it is refused like
> any expired token — same status, same body.

### SPEC §6.4 (not authorised by this task; flag only)

The `POST /api/v1/agents` and `rotate-token` lines could name the two
`reason`s, and the `devices` line's `agents` now carry `owner_display_name`.
This task's D-033 grant names §4.63 and §4.9 only, so these are for Belka to
take or file.

## Review round 1 (Codex, PR #141) — addressed

Blocking: a cloud agent's past `expires_at` was refused by `futureExpiry()`
with no `reason`. Fixed in `bae80dd3` as described under *Design choices*;
REST tests for a past and a present expiry on register and rotate (M9–M11).
Non-blocking: exact boundary with a fixed clock and an injectable `now` on
`updateAgent()` (M12, M13); Unicode-space and look-alike labels (M14, M15);
the `device_label` comment in `AgentView` no longer says it decides nothing.
Criteria unchanged (frozen in review).

## Belka takes over (2026-10-30) — what was waiting, and what was added

Strelka was idle; Pawan told Belka to finish the CORE half and proceed on the
decision himself.

**What the draft waited on.** Only the decision: the proposed D-120 (*Proposed
docs half* above) needed approval from Pawan's own account before merge
(*Dependencies*, and the PR body's "Draft until the decision is approved from
Pawan's account"). D-120 was not recorded anywhere — no `docs/DECISIONS.md`
entry, no proposal section, on any branch. LAI-320 (the web half) was also
open, and is what keeps the gate red.

**Owner direction applied (Pawan, 2026-10-29, through polly):** an agent is
exactly harness · device; one active agent per harness per device per owner; a
cloud runner is a device like `Cloud`. The one product choice still open was
how strict "one active agent" is; the more restrictive reading was taken:
per owner, an unnamed device counts as a device, and both register and
rename/relabel are refused (`409`, not a silent revoke of the old one).

**Added in this branch (CORE):**

- `server/src/services/agents.ts` — `assertHarnessDeviceFree()`, called inside
  the write transaction of `registerAgent()` and `updateAgent()` (harness or
  label change). `409 conflict`, `reason` `agent_exists_for_harness_device`.
- `server/src/services/tokens.ts`, `server/src/auth/resolve-actor.ts`,
  `server/src/policy/can.ts` — `TokenContext.expiresAt`, and
  `assertWithinOwnExpiry()` in `createToken()`: a token that expires cannot
  mint one with no expiry or a later one, `403` `token_expiry_bounded`. This is
  LAI-563's criterion (CHIEF's block, backlog, unclaimed); CHIEF can close
  LAI-563 against this branch.
- Tests: `agents.test.ts` — D-120 (normalised device, unnamed device, revoked
  frees, rename/relabel, never names another owner's) and *missing, not
  hidden* (every agent route, a foreign Cloud agent vs an unknown id, bodies
  compared with the id substituted; neither list mentions it);
  `middleware/auth.test.ts` — the mint bound against the same bodies from a
  session and a never-expiring token. Twelve fixture files gave each fixture
  agent its own device (or, in `agents.test.ts`, the next known harness),
  the first one unchanged so existing assertions hold.

**Mutations M16–M26**, same harness discipline (anchor matched once, file
changed, restored, SHA-256 compared, `git status` clean after):

| # | mutation | red test(s) |
| --- | --- | --- |
| M16 | register skips the pair check | 4: same pair; unnamed device; another owner's; idempotency retry count |
| M17 | update skips it | rename/relabel onto a held pair |
| M18 | compares every owner's agents | never compares against, or names, another owner's |
| M19 | device compared raw, not by key | same pair normalised; rename/relabel |
| M20 | revoked agents still hold the pair | a revoked agent frees its pair |
| M21 | an agent clashes with itself | rename/relabel (keeping its own pair) |
| M22 | a foreign agent is `403`, not `404` | another person's agent is a 404; missing, not hidden |
| M23 | `createToken` skips the expiry bound | token_expiry_bounded |
| M24 | an unbounded mint allowed | token_expiry_bounded |
| M25 | the bound is exclusive | token_expiry_bounded (own expiry allowed) |
| M26 | token context drops `expiresAt` | token_expiry_bounded |

M1–M7 re-run on the merged tree: each still red on the same tests as the table
above.

**Proposed decision, superseding the draft above** (number D-120; approval
from Pawan's account still required; the same text is in PR #141's body):

> **D-120 — An agent is one harness on one device, at most one active per owner; a cloud runner is the device `Cloud`, whose tokens live at most a day; every agent is its registering person's (LAI-592)**
>
> 1. **An agent is exactly `<harness> · <device>`** (D-118), and **an owner
>    holds at most one active agent for each pair.** The device is compared
>    by its normalised key (§4.63: trimmed, lower-cased); an agent with no
>    device label is on one unnamed device. Registering a second, or renaming
>    the harness or relabelling onto a pair another active agent of yours
>    holds, is `409 conflict` with `reason` `agent_exists_for_harness_device`
>    and `agent_id` naming yours. A revoked agent frees its pair. Only your
>    own agents are compared: another person's agent on the same label and
>    harness is no conflict and is never named. Agents that already share a
>    pair before this ships keep working; the rule bites on the next register,
>    rename or relabel.
> 2. **A cloud runner is a device like any other, labelled `Cloud`** (the
>    same normalisation; look-alike and compatibility forms — fullwidth,
>    Cyrillic, zero-width — are other labels). No new field.
> 3. **A cloud agent's tokens must expire, within 24 hours of minting**
>    (`CLOUD_TOKEN_MAX_TTL_MS`; exactly 24 h is allowed). Registering one,
>    rotating one of its tokens, or relabelling an agent into `Cloud` while a
>    live token breaks the rule is `422 unprocessable` with `reason`
>    `cloud_token_expiry_required` (none, or not in the future) or
>    `cloud_token_expiry_too_long`. A rotation with no `expires_at` carries
>    the old expiry, which must itself pass. Why 24 h: a runner's longest job
>    and a daily schedule both fit, a secret leaked from a runner is dead
>    within a day, and minting is session-only, so a shorter limit would cut
>    long jobs off mid-run.
> 4. **No token mints a token that outlives it.** A token with an expiry
>    asking `POST /tokens` for no expiry or a later one is `403 forbidden`,
>    `reason` `token_expiry_bounded` — refused, never clamped, as LAI-562's
>    project pin is. An agent's token, a cloud one included, cannot mint at
>    all (`agent_token`), and registering or rotating is session-only, so a
>    short-lived credential can never produce a longer-lived one.
> 5. **An expired cloud token is refused as any expired token is** — `401`,
>    byte-identical body; the agent and the owner's other devices are
>    untouched.
> 6. **The owner is the person who registered it**, always the session user;
>    no route, body field or tool registers an agent for anyone else. Every
>    agent read and the device list name them (`owner_display_name`, live
>    `users.name`).
> 7. **Another person's agents and devices are missing, not hidden**: every
>    agent route answers a foreign agent — a cloud one included — exactly as
>    an id that does not exist (`404`, same body), and neither list mentions
>    it. Another person's laptop carries that person's own agent, registered
>    by them (D-114).
> 8. `device_label` now decides two things — the one-per-pair rule and the
>    cloud rule — both of which only constrain the owner's own credentials and
>    grant no access.
