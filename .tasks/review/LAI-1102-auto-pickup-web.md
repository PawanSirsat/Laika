---
id: LAI-1102
title: 'Auto-pickup slice C (web): agent.capacity_requested mirrors, Auto-pickup chips, Ping'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1038]
discovered-from: LAI-1038
status: review
started: 2026-11-03T15:26:56+05:30
finished: 2026-11-03T16:18:36+05:30
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

- [x] Every web assertion LAI-1038's review note quotes is green, and no other
      changes colour.
- [x] The chip says *on* only from `launcher.state === 'on'`; a stale report
      reads *not heard since …*, never *on* (mutation: chip from a stale
      report goes red).
- [x] Ping is offered only for an agent the viewer may ping (their own
      selectable agent), and shows the answer or *pending → expired*
      (mutation: Ping shown for an ineligible agent goes red).
- [x] Playwright evidence in light and dark.
- [x] Repo-root gate exits 0 on the merge of LAI-1038 and this.

## Claim note (2026-11-03, shell, dispatched by CHIEF)

**Deviation from §2 step 1, recorded rather than read loosely:** `depends-on`
names LAI-1038, which is in `.tasks/review/`, not `.tasks/done/`. This is the
§4.4 case: LAI-1038 is submitted red on the five web mirrors by design, and
CHIEF dispatched this slice to land on top of it. The branch
`LAI-1102-capacity-web` is cut from `origin/LAI-1038-capacity-ping-presence`
at b913cb28 (PR #253), and its PR into `master` is stacked on #253 — merge
after it.

## Builder's review note (2026-11-03, shell)

PR #255 into `master`, **merge after #253**. The branch carries LAI-1038's
final head (9ea96dee) by merge commit 469180d1. The log is
`logs/shell-2026-11-03-LAI-1102.md`.

**Criterion 1: LAI-1038's five web reds are green.** Each file was run on its
own with `node --test --test-concurrency=1`: `use-events`, `activity-labels`,
`dashboard-derive`, `view-type-drift` and `endpoint-coverage` all exit 0.
The other 235 non-browser web test files were run one at a time too, and all
exit 0.

The task asked for one more thing that this branch **does not do**:
`AgentCapacityView`, `CapacityPingView`, `LauncherView` and `PingAgentResult`
are **not** in `view-type-drift`'s `PAIRS`. A `PAIRS` entry turns CORE's
`response-type-coverage` staleness check red until `UNPAIRED` drops the same
entry, and the dispatch required a fully green gate. So:

- `test/api/capacity.test.ts` compares the six shapes' top-level fields in
  both directions, plus their closed word lists.
- **LAI-1106** (LAIKA-961) does the swap: SHELL's `PAIRS` entries plus a
  named crossing on CORE's `UNPAIRED`, for CHIEF to grant or split.

**Criteria 2 and 3: the mutations.** Seven edits, each on an anchor that
matched exactly once, each confirmed on disk, each file restored byte for
byte. Every one goes red on a named assertion:

- The chip re-derives *on* from `reported_at`.
- The chip says *on* for `unknown`.
- The grant check is dropped, so Ping shows for an ineligible tool.
- The drawer's `ineligibleReason` is dropped. This one first survived; see
  the log.
- The drawer's `mayEdit` is dropped.
- An early `pending` reads as *no answer*.
- `startsOnSelect` ignores `work_requests`.

**Criterion 4: evidence.** Twenty screenshots, light and dark at 1440 and
390 px, are in `.polly/evidence/LAI-1102/` on Belka.

**Criterion 5: the gate.** PR #255's Gate covers the merge of LAI-1038 and
this branch; the numbers are on the card and in the PR. First run:
`web 3/4` failed once, in `dropdown-global.test.ts` › *opens inside the
drawer's modal panel*: the panel was placed during the drawer's rise. That
file's stub serves no `/agents`, so nothing this branch adds renders there,
and three local runs pass. The re-run failed instead in this branch's own
429 case — *try again in 13 s* where the board said 12, two clock readings
rounding up a second. A real bug, fixed with one reading
(`PingButton.tsx`); the gate result on the final head is on the card.

## Review round 1 — fixed (2026-11-03, shell)

The review of #255 at 3ceb98f6 failed on two blockers, both reached only
when a request fails, plus four smaller items. All are fixed as new commits
on the same branch; nothing was rebased.

- **B1** (782b72f1): a quiet `/devices` re-read that fails keeps the list
  once one is shown, so focus stays where the reader put it. Test:
  `auto-pickup.test.ts` › *B1: a failed presence re-read keeps the list, and
  focus on the row control*.
- **B2** (3323042b): a failed `GET /capacity-pings/:id` backs off and keeps
  asking, bounded by the end of the wait and by `expires_at`. A failure
  inside the wait still reads *Waiting…, asking again*, and after the wait,
  *no answer, retrying until <time>*. At the expiry it reads *expired,
  answered or not unknown*. A ping whose checks are failing no longer holds
  the button. Tests: `auto-pickup.test.ts` ›
  - *B2: a check that fails inside the wait keeps waiting, says so, and the
    answer still arrives*;
  - *B2: checks that keep failing retry until the ping expires, then say so,
    and Ping is offered again*.
- **Live region** (3323042b): *answered N s ago* is outside the aria-atomic
  region, and the rate limit's wait is said once, not counted down aloud.
- **Both switches off** (1bd2512e): the chip reads *Auto-pickup: listening ·
  picks up nothing*, in neutral, and every reason is a whole sentence.
- **The drawer** (b064c101): `useMyAgents({ refresh: true })` re-reads
  quietly on focus, on return, and every 60 s, so *Starts automatically on …*
  cannot outlive the board's three minutes.
- **A viewer** (1bd2512e): the no-Ping note names the role.

Each fix was undone in turn by a mutation, and its named test went red:
seven runs in all, with every file restored byte for byte.
