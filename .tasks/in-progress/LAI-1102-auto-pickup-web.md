---
id: LAI-1102
title: 'Auto-pickup slice C (web): agent.capacity_requested mirrors, Auto-pickup chips, Ping'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1038]
discovered-from: LAI-1038
status: in-progress
started: 2026-11-03T15:26:56+05:30
---

## Goal

Slice **C** of `.polly/plans/auto-pickup-capacity.md` §8 (D-126, D-117a): the
web half of LAI-1038 — the third owner of the new §4.8 verb, the launcher
presence LAI-1038 serves, and the Ping action. LAI-1038 (slice A, the server)
is submitted red on the web mirrors only, under CLAUDE.md §4.4; **this task is
what turns it green**, landing on top of CHIEF's local, unpushed merge of
LAI-1038.

## What slice A serves (the contract to code against)

- `AgentView.launcher` and `DeviceView.launcher`:
  `{ state: 'on' | 'off' | 'unknown', reported_at, started_at, running,
  max_concurrent, auto_pickup: { work_requests, handoffs } | null, cli_version }`
  — `on` only from an enabled report under 180 s old; `off` when never
  reported (every other field null); `unknown` for an older enabled report.
  A device is its active tools' best (§4.83).
- `POST /api/v1/agents/:id/capacity-pings` body `{ project, task_id?,
  wait_ms? ≤ 10000 }` → `201 { ping, created: true }` / `200 { ping, created:
  false }` (repeat within 15 s); held up to `wait_ms`; refusal is the agent
  `404`; `429 capacity_ping_rate` with `Retry-After`.
- `GET /api/v1/capacity-pings/:id` → `{ ping }`; `GET /api/v1/agents/:id/capacity?project=`
  → `{ agent_id, launcher, latest_answer, now }`.
- `ping` is `{ id, agent_id, project_id, task_id, state: pending | answered |
  expired, requested_by: { user_id, agent_id }, created_at, expires_at,
  answered_at, answer }`; `answer` is §4.84's closed object. A client calls an
  answer older than 5 minutes stale.
- The verb `agent.capacity_requested`: project-scoped, `task_id` optional,
  payload `{ ping_id, agent_id, expires_at }`, actor whoever pinged.

## Scope (plan §6 and §8 C)

- **Mirrors of the verb** (three owners): `api/stream-types.ts`,
  `api/activity.ts` LABELS, `dashboard-derive.ts` wording (+ `FEED_SILENT`),
  and whatever else the red assertions below name.
- **Types**: `api/agents.ts`, `api/devices.ts` gain `launcher`
  (`view-type-drift.test.ts`); new `api/capacity.ts`.
- **UI**: the Tools row chip *Auto-pickup: on · 40 s* / *off* / *not heard
  since …* and a Ping button; the Devices row aggregate chip; the tool and
  device panels; the task drawer's agent row Ping and the picker hint — per
  plan §6, `AutoPickupChip.tsx`, `PingButton.tsx`. Playwright in both themes.
- The `WEB_*` maps in `server/test/tooling/structure.test.ts`, if new files
  need them.

## Red on LAI-1038 alone — what this task turns green

Measured on LAI-1038's branch, each web test file run on its own with
`node --test <file>` from `server/web` (33 files: the 31 non-browser tests
that read the server's source, and `endpoint-coverage` and
`permissions-view`; these five failed, the other 28 passed):

1. `test/api/use-events.test.ts` › *the stream subscribes to exactly what the
   server emits* › **STREAM_TYPES equals ACTIVITY_TYPES, in order** — missing
   `'agent.capacity_requested'` (`api/stream-types.ts`).
2. `test/api/activity-labels.test.ts` › *activity wording covers the server’s
   vocabulary* › **every type the server emits has wording** — actual
   `['agent.capacity_requested']`, expected `[]` (`api/activity.ts` LABELS).
3. `test/routes/screens/dashboard/dashboard-derive.test.ts` ›
   *describeProjectEvent* › **covers every verb the server can write** —
   actual `['agent.capacity_requested']`, expected `[]`.
4. `test/api/view-type-drift.test.ts` › *every server field is visible to the
   client* › **no server field is missing from its client type** —
   `AgentView.launcher` (RegisteredAgent), `DeviceView.launcher` (Device),
   `AgentDetailView.launcher` (AgentDetail).
5. `test/api/endpoint-coverage.test.ts` › *every served endpoint has a
   caller, or a named reason* › **no endpoint is served, uncalled and
   unexplained** — `api/v1/agents/*/capacity`, `api/v1/agents/*/capacity-pings`,
   `api/v1/agents/me/capacity-pings/*/reply`, `api/v1/agents/me/launcher`,
   `api/v1/capacity-pings/*`. The reply and `PUT /agents/me/launcher` are the
   CLI's (slice B), so they want a named reason, not a web caller.

Nothing else may be red.

**Also expiring with this task:** LAI-1038 named `AgentCapacityView`,
`CapacityPingView`, `LauncherView` and `PingAgentResult` in
`server/test/tooling/response-type-coverage.test.ts`'s `UNPAIRED` as *no
client type exists*. When the client types exist, pair them in
`view-type-drift.test.ts` (`PAIRS`) and that file's staleness guard asks for
the entries to go — CORE's file, so say so in the review rather than editing
it. `LauncherReportView` stays: only the CLI reads it.

## Acceptance criteria

- [ ] Every web assertion LAI-1038's review note quotes is green, and no other
      changes colour.
- [ ] The chip says *on* only from `launcher.state === 'on'`; a stale report
      reads *not heard since …*, never *on* (mutation: chip from a stale
      report goes red).
- [ ] Ping is offered only for an agent the viewer may ping (their own
      selectable agent), and shows the answer or *pending → expired*
      (mutation: Ping shown for an ineligible agent goes red).
- [ ] Playwright evidence in light and dark.
- [ ] Repo-root gate exits 0 on the merge of LAI-1038 and this.

## Claim note (2026-11-03, shell, dispatched by CHIEF)

**Deviation from §2 step 1, recorded rather than read loosely:** `depends-on`
names LAI-1038, which is in `.tasks/review/`, not `.tasks/done/`. This is the
§4.4 case: LAI-1038 is submitted red on the five web mirrors by design, and
CHIEF dispatched this slice to land on top of it. The branch
`LAI-1102-capacity-web` is cut from `origin/LAI-1038-capacity-ping-presence`
at b913cb28 (PR #253), and its PR into `master` is stacked on #253 — merge
after it.
