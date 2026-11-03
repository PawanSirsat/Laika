---
id: LAI-1038
title: 'Launcher status row per device in Developer access › Agents › Your devices'
area: server
assignee: core
priority: p3
depends-on: [LAI-558]
discovered-from: LAI-558
status: review
started: 2026-11-03T14:27:03+05:30
finished: 2026-11-03T15:01:39+05:30
---

## Goal

D-117 item 7: show a read-only *Launcher* row per device in *Developer access ›
Agents › Your devices* — enabled?, last start, running count — once the board
has data to show.

## Why it is not built yet

The launcher (LAI-558) keeps its state on the device only
(`~/.laika/launcher/status.json`, `audit.jsonl`). The board has no field for it,
and §5.1 forbids building the screen on stubbed data. This needs, in order:

1. **CORE:** a minimal, read-only report — e.g. the launcher sending
   `{ enabled, running, last_start_at }` with the agent's own token on its
   existing poll, kept per agent/device, never a command channel. A SPEC §6.4
   row and its `can()` action.
2. **SHELL:** the CLI sending it (`cli/src/agent-launcher.ts`), and the row in
   `server/web/` with Playwright evidence in both themes.

## Acceptance criteria

- [x] The board stores only the three read-only facts; nothing on it can start,
      stop or configure a launcher (D-117: no general runner). *(As amended by
      D-126 item 4: the closed report §4.83 names, read-only.)*
- [ ] The row shows "Launcher: off" when a device has never reported.
- [ ] Repo-root gate exits 0.

## Claim note — slice A of the auto-pickup plan (2026-11-03, core, dispatched by CHIEF)

Claimed as **slice A** of `.polly/plans/auto-pickup-capacity.md` §8, which
"absorbs LAI-1038's server half": step 1 above, plus the capacity ping D-126
puts beside it (D-126's header names this task). The decisions are D-117a,
D-126 and D-127, written by CHIEF in PR #251; this branch cites them and
writes none. Its SPEC rows are the named CHIEF crossing the plan gives slice A.

**Deviation from §2 step 1, recorded rather than read loosely:** `depends-on`
names LAI-558, which is in `.tasks/review/` on `master`. CHIEF accepts it in
PR #251 (`chore(tasks): accept LAI-553, LAI-554, LAI-558, LAI-1041`) and
dispatched this slice against that acceptance.

**How the criteria above read for slice A.** The first is amended by D-126
item 4: the report is the closed object D-126 names, and it stays read-only —
nothing on the board starts, stops or configures a launcher. The second is
the web row (slice C): this branch serves `launcher.state: 'off'` for an agent
or device that never reported, which is what that row reads. The third cannot
hold for this half alone: the new §4.8 verb is three owners (CLAUDE.md §4.4),
so this branch is submitted red on the web mirrors only, quoted in the review
note when it moves to review, and turned green by slice C landing on top.

## Builder's review note — slice A (2026-11-03, core)

**Built** (SPEC §3.2, §4.8, §4.76, §4.77, §4.83, §4.84, §6.4, §7.1, §11.5):
`agent.ping`; the verb `agent.capacity_requested`, delivered to the pinged
agent only; `capacity_pings` and `agent_launcher_reports` (migration 0074);
`PUT /agents/me/launcher`, `POST /agents/:id/capacity-pings`,
`POST /agents/me/capacity-pings/:id/reply`, `GET /capacity-pings/:id`,
`GET /agents/:id/capacity`; `AgentView.launcher`, `DeviceView.launcher`;
MCP `ping_agent`, `get_agent_capacity`; envelope schema 2 with `ping`,
`task_key`, `project_slug`. The log is `logs/core-2026-11-03-LAI-1038.md`.

**Criterion 2** is the web row, LAI-1102's: this branch serves
`launcher.state: 'off'` with every other field null for an agent or device
that never reported (asserted in `test/http/routes/capacity-pings.test.ts`,
*never reported is off; an old report is unknown; disabled is off*).

**Criterion 3 — red by design, CLAUDE.md §4.4.** The new verb is three
owners. On this branch alone exactly these five web assertions fail, each
measured with `node --test <file>` from `server/web`; **LAI-1102 turns them
green** and nothing else may be red:

1. `server/web/test/api/use-events.test.ts` › *the stream subscribes to
   exactly what the server emits* › **STREAM_TYPES equals ACTIVITY_TYPES, in
   order** — expected list has `'agent.capacity_requested'`, actual does not.
2. `server/web/test/api/activity-labels.test.ts` › *activity wording covers
   the server’s vocabulary* › **every type the server emits has wording** —
   `+ ['agent.capacity_requested']  - []`.
3. `server/web/test/routes/screens/dashboard/dashboard-derive.test.ts` ›
   *describeProjectEvent* › **covers every verb the server can write** —
   `+ ['agent.capacity_requested']  - []`.
4. `server/web/test/api/view-type-drift.test.ts` › *every server field is
   visible to the client* › **no server field is missing from its client
   type** — `AgentView.launcher is served and RegisteredAgent does not declare
   it`, the same for `DeviceView.launcher` (Device) and
   `AgentDetailView.launcher` (AgentDetail).
5. `server/web/test/api/endpoint-coverage.test.ts` › *every served endpoint
   has a caller, or a named reason* › **no endpoint is served, uncalled and
   unexplained** — `api/v1/agents/*/capacity`, `api/v1/agents/*/capacity-pings`,
   `api/v1/agents/me/capacity-pings/*/reply`, `api/v1/agents/me/launcher`,
   `api/v1/capacity-pings/*`.

**Mutation proofs** (each anchor matched once, the edit confirmed on disk,
the file restored byte for byte; every one red on a named assertion):
the person-path owner check dropped; the agent-path receiver rule bypassed;
a reply after expiry accepted; an unaddressed agent's reply accepted; the
ping delivered to every granted agent; an extra key in a reply accepted
(top-level `strictObject` → `z.object`); presence `on` past 180 s (freshness
dropped, and separately `<` → `<=` at the boundary); the rate bucket skipped.
