# Agent identities and safe hand-off: evidence pack

LAI-532 (board LAIKA-785). Compiled by LAI-560 on **2026-10-31** from
`origin/master` **`1fe55ff1`**, GitHub's PR and Actions records, and the task
files. It is an index: it links evidence, it does not restate it.

**The rule for this document: nothing is claimed that was not checked.** Every
row says where its evidence is. Anything without evidence is in
[§ 6 *Not verified*](#6-not-verified), and that section is the one to read
before accepting the programme.

## 1. Where things stand

| Phase | State | Evidence |
| --- | --- | --- |
| 1 Identity and visible delegation | **Live**, accepted on production | [`LAI-582-phase-1-2-live.md`](LAI-582-phase-1-2-live.md), 9 rows PASS, PR #120 |
| 2 Exclusive sessions, connection state | **Live**, accepted on production | same document; *Working* / *Connection lost* landed later in #112 and #134 |
| 2.5 Identity model, devices, UI quality | Merged and deployed | PRs below; no live acceptance walk recorded |
| 3 Checkpoints and recovery | Merged and deployed (#153, #154, #158 …) | **not certified**: the two-device run (LAI-551) and the real-GitHub criteria (LAI-545) have not happened |
| 4 Watcher, notices, context | Mostly merged (#145, #146, #151, #162, #164 – #166, #168) | LAI-554's event helper is **open** (#171, its gate red) |
| 5 Adapters, launcher | Not merged | #169 open (LAI-557); LAI-558 parked behind D-117 |
| 6 Release qualification | **Not done** | LAI-559 is in `backlog/` on master and *In progress* on the board, with no PR; LAI-560 is this |

**Most children are in `.tasks/review/`, not `done/`**, although their PRs are
merged and deployed: CHIEF has not run the task-file accept step for them.
§ 3 gives the state of each.

## 2. Decisions

| Decision | Status | Where |
| --- | --- | --- |
| D-114 registered agents | Approved 2026-10-29, from Pawan's GitHub account on PR #99 | `docs/DECISIONS.md` |
| D-115 checkpoints are not heartbeats | Approved, same | `docs/DECISIONS.md` |
| D-116 checkpoints proved by push deliveries | Approved, same. **Its own text says recovery is not *tested* until LAI-545's real-repository criteria pass** | `docs/DECISIONS.md` |
| D-116a state is a function of the delivery set | Recorded by CHIEF under delegation | `docs/DECISIONS.md` |
| D-117 launcher versus the stop list | **Proposed only**; not in `DECISIONS.md` | proposal § 9 |
| D-118 one agent per harness per device; D-119 the selected agent owns the claim | **Proposed** in the identity-model proposal; D-118's substance restated and approved as D-120 / D-121 | `docs/proposals/LAI-532-agent-identity-model.md` |
| D-120 an agent is `<harness> · <device>` | Recorded from the owner's chat decision | `docs/DECISIONS.md` |
| D-121 one active per pair; `Cloud` tokens ≤ 24 h | Approved on Pawan's instruction, relayed | `docs/DECISIONS.md` |

## 3. Children: task state and PRs

Task-file state is where the file is on `origin/master` at `1fe55ff1`.

| Task | Phase | Task file | PR(s) |
| --- | --- | --- | --- |
| LAI-533 decisions and SPEC | 1 | **in-progress** | #99 (the decisions and SPEC draft); the identity-model decisions came in #121 and #152 |
| LAI-534 registered agents | 1 | done | #102 |
| LAI-535 selected agent, work requests | 1 | done | #105 |
| LAI-536 agent UI states | 1 | done | #101 |
| LAI-537 Agents tab | 1 | done | #104 |
| LAI-538 drawer Agent field | 1 | done | #106 |
| LAI-539 open streams re-check credentials | 1 | done | #100 |
| LAI-540 SPEC sessions and claims | 2 | done | inside #107 (no PR of its own) |
| LAI-541 sessions, exclusive claims | 2 | done | #107 |
| LAI-542 session helper | 2 | done | #108 |
| LAI-543 execution states | 2 | done | #110 |
| (integration of 1 + 2) | | | #111 |
| LAI-544 Phase 3 SPEC | 3 | review | #143 |
| LAI-545 checkpoints and verification | 3 | review, **criteria unticked** (§ 6) | #147 closed; landed by #153 |
| LAI-546 hand-off offers | 3 | review | #148 closed; landed by #153 |
| LAI-547 checkpoint helper | 3 | review | #154 |
| LAI-548 receiver accept flow | 3 | review | #158 |
| LAI-549 hand-off dialog, recovery panel | 3 | review | #150 closed; landed by #153 |
| LAI-550 Inbox › Hand-offs, policy | 3 | review | #157 |
| **LAI-551 two-device certification** | 3 | **backlog** | **none** |
| LAI-552 resource watcher | 4 | review | #168 |
| LAI-553 durable delivery, SSE | 4 | review | #165, #166 |
| **LAI-554 local event helper** | 4 | **backlog** | **#171 open, gate red** |
| LAI-555 versioned project context | 4 | review | #145, #146 |
| LAI-556 context history UI | 4 | **in-progress** | #151 merged |
| **LAI-557 harness adapters** | 5 | **backlog** | **#169 open** |
| **LAI-558 launcher** | 5 | backlog, parked (D-117) | none |
| **LAI-559 failure matrix, a11y** | 6 | **backlog** (board: In progress) | **none** |
| LAI-560 rollout and this pack | 6 | in-progress | this branch |

Programme work filed during the build:

| Task | Task file | PR(s) |
| --- | --- | --- |
| LAI-562 pinned token cannot mint unpinned | done | #103 |
| LAI-564 paired agent view types | done | #115 |
| LAI-565 Agents tab shared components | review | #133 |
| LAI-568 task view live claim | done | #112 |
| LAI-569 / 570 / 575 / 577 / 581 / 583 UI fixes | done | #126 / #127 / #114 / #119 / #124, #131 / #128 |
| LAI-571 task PATCH precondition | done | #113 |
| **LAI-572 certify Codex session hooks** | **backlog** | **none** |
| LAI-582 live acceptance, phases 1 + 2 | done | #120 |
| LAI-584 Review caps at the oldest 200 | **backlog** | none |
| LAI-586 / 587 / 588 / 589 identity model, agent line | done | #123 / #129 / #140, #144 / #125 |
| LAI-590 / 591 devices | done | #132 / #135 |
| LAI-592 cloud and shared devices | review | #141, #149 |
| LAI-593 / 597 live claim line, card states | done | #138 / #134 |
| LAI-594 / 596 | **backlog** | none |
| LAI-1000 one agent per harness·device | **in-progress** | #152 (docs), server rule in #141 |
| LAI-1001 label `<harness> · <device>` | review | #155 |
| LAI-1003 – 1007, 1009, 1011 | review | #162, #164, #159, #160, #161, #156, #167 |
| **LAI-1012 older agent privacy** | **backlog** | **#170 open** |
| LAI-1015, LAI-1016 (filed by LAI-560) | backlog | none |

## 4. Every PR: gate and master CI

All PRs **#96 and #98 – #171** (#97 is LAI-300, timeline work outside the
programme). A few in the range are adjacent fixes, kept so the list is the
whole range: #109, #116, #117, #130, #136, #137, #139, #163.

*PR gate* is the conclusion of the **last** "Gate — test, lint, format" run on
the PR. *Master CI* is the **CI / Deploy** push run on the PR's merge commit:
gate, build, deploy.

**How to read a red PR gate on a merged PR.** #98 – #108 and #110 merged into
`master` by the same push as their integration PR #111, whose PR gate was
green and whose master run on `fe49255c` was red; the next push, `4bb4846c`,
deployed green. #120,
#143, #145, #159 and #162 merged with their last PR gate red; the master run
on each merge commit is the next column. **No gate exit code is invented
here**: where neither the PR nor the merge commit has a green run, the table
says so.

| PR | State | Merged (UTC) | Branch | PR gate | Master CI on the merge | Title |
| --- | --- | --- | --- | --- | --- | --- |
| [#96](https://github.com/PawanSirsat/Laika/pull/96) | merged | 2026-10-28 14:07 | `H4-pinned-token-org-actions` | success | no run on this merge commit (a later push superseded it) | H4: a project-pinned token is refused org-wide admin actions |
| [#98](https://github.com/PawanSirsat/Laika/pull/98) | merged | 2026-10-28 14:07 | `LAI-532-agent-handoff-programme` | failure | no run on this merge commit (a later push superseded it) | LAI-532 · Agent identities and safe task hand-off — proposal and backlog |
| [#99](https://github.com/PawanSirsat/Laika/pull/99) | merged | 2026-10-28 14:07 | `LAI-533-agent-decisions-spec-draft` | failure | no run on this merge commit (a later push superseded it) | LAI-533 · D-114/D-115 (approved in substance) and revised D-116 for agent identities |
| [#100](https://github.com/PawanSirsat/Laika/pull/100) | merged | 2026-10-28 14:07 | `LAI-539-open-streams-recheck-credentials` | failure | no run on this merge commit (a later push superseded it) | LAI-539 · Open event streams re-check token revocation, expiry and project pin (LAIKA-542) |
| [#101](https://github.com/PawanSirsat/Laika/pull/101) | merged | 2026-10-28 14:07 | `LAI-536-agent-ui-reviewable-states` | failure | no run on this merge commit (a later push superseded it) | LAI-536 · Proposed agent UI as reviewable states (no tokens changed) |
| [#102](https://github.com/PawanSirsat/Laika/pull/102) | merged | 2026-10-28 14:07 | `LAI-534-registered-agents` | failure | no run on this merge commit (a later push superseded it) | LAI-534 · Registered agents and per-agent credentials |
| [#103](https://github.com/PawanSirsat/Laika/pull/103) | merged | 2026-10-28 14:07 | `LAI-562-pinned-token-cannot-mint-unpinned` | failure | no run on this merge commit (a later push superseded it) | LAI-562 · A project-pinned token cannot mint a wider token |
| [#104](https://github.com/PawanSirsat/Laika/pull/104) | merged | 2026-10-28 14:07 | `LAI-537-agents-tab` | failure | no run on this merge commit (a later push superseded it) | LAI-537 · Developer access → Agents: register, verify, rotate, revoke |
| [#105](https://github.com/PawanSirsat/Laika/pull/105) | merged | 2026-10-28 14:07 | `LAI-535-selected-agent-work-requests` | failure | no run on this merge commit (a later push superseded it) | LAI-535 · Selected agent and work requests on tasks; agent attribution |
| [#106](https://github.com/PawanSirsat/Laika/pull/106) | merged | 2026-10-28 14:07 | `LAI-538-drawer-agent-field` | failure | no run on this merge commit (a later push superseded it) | LAI-538 · Agent field in the task drawer, agent chip on cards, list column and filter |
| [#107](https://github.com/PawanSirsat/Laika/pull/107) | merged | 2026-10-28 14:07 | `LAI-541-sessions-exclusive-claims` | failure | no run on this merge commit (a later push superseded it) | LAI-541 · Agent sessions and exclusive claims with lease and generation fencing (+ LAI-540 |
| [#108](https://github.com/PawanSirsat/Laika/pull/108) | merged | 2026-10-28 14:07 | `LAI-542-agent-session-helper` | failure | no run on this merge commit (a later push superseded it) | LAI-542 · laika agent session: process-bound heartbeats; Claude Code and Codex adapters |
| [#109](https://github.com/PawanSirsat/Laika/pull/109) | merged | 2026-10-28 14:07 | `LAI-574-ci-lint-heap` | success | no run on this merge commit (a later push superseded it) | fix(ops): give CI lint a 4 GB heap [LAI-574] |
| [#110](https://github.com/PawanSirsat/Laika/pull/110) | merged | 2026-10-28 14:07 | `LAI-543-execution-states` | failure | no run on this merge commit (a later push superseded it) | LAI-543 · Working / Waiting / Connection lost on cards and drawer; demo fakes removed |
| [#111](https://github.com/PawanSirsat/Laika/pull/111) | merged | 2026-10-28 14:07 | `integration-agent-identities` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40702908482) | Agent identities Phase 1+2 integration (#96 #98-#110) |
| [#112](https://github.com/PawanSirsat/Laika/pull/112) | merged | 2026-10-29 08:52 | `LAI-568-task-view-live-claim` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40845327647) | LAI-568 · Serve the live claim on task reads |
| [#113](https://github.com/PawanSirsat/Laika/pull/113) | merged | 2026-10-29 10:57 | `LAI-571-task-patch-precondition` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40861661202) | LAI-571 · PATCH /tasks/:id takes a precondition |
| [#114](https://github.com/PawanSirsat/Laika/pull/114) | merged | 2026-10-29 09:14 | `LAI-575-all-tab-same-ms-order` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40848051156) | LAI-575 · All tab orders same-millisecond activity by seq |
| [#115](https://github.com/PawanSirsat/Laika/pull/115) | merged | 2026-10-29 07:47 | `LAI-564-pair-agent-view-types` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40837715398) | LAI-564 · Pair the agent response types |
| [#116](https://github.com/PawanSirsat/Laika/pull/116) | merged | 2026-10-28 18:26 | `LAI-576-pulse-390-dark` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40745122062) | fix(web): setTheme re-chooses its control when the session swaps it mid-click [LAI-576] |
| [#117](https://github.com/PawanSirsat/Laika/pull/117) | merged | 2026-10-28 20:23 | `LAI-578-settheme-narrow-retry` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40762828825) | fix(web): setTheme retries only a control the session replaced [LAI-578] |
| [#118](https://github.com/PawanSirsat/Laika/pull/118) | open | — | `LAI-579-deploy-test-nonblocking` | success | — | ci(deploy): test step does not block the master deploy for now [LAI-579] |
| [#119](https://github.com/PawanSirsat/Laika/pull/119) | merged | 2026-10-29 05:56 | `LAI-577-agent-field-withdraw-race` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40826238286) | LAI-577 · A save answered inside the read's render no longer loses the agent (master CI fl |
| [#120](https://github.com/PawanSirsat/Laika/pull/120) | merged | 2026-10-28 20:23 | `LAI-582-live-acceptance` | failure | [success](https://github.com/PawanSirsat/Laika/actions/runs/40762843080) | LAI-582 · Live acceptance of agent identities Phases 1+2 (docs only) |
| [#121](https://github.com/PawanSirsat/Laika/pull/121) | merged | 2026-10-29 06:15 | `LAI-532-identity-model-decisions` | success | [cancelled](https://github.com/PawanSirsat/Laika/actions/runs/40828153185) | docs: agent identity model — D-118 harness×device agents, D-119 selected agent owns the cl |
| [#122](https://github.com/PawanSirsat/Laika/pull/122) | merged | 2026-10-28 21:24 | `LAI-532-phase-2-5-tasks` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40771681892) | chore(tasks): Phase 2.5 devices and cloud slices — LAI-590, LAI-591, LAI-592 [LAI-590] |
| [#123](https://github.com/PawanSirsat/Laika/pull/123) | merged | 2026-10-29 07:47 | `LAI-586-selected-agent-owns-claim` | success | [cancelled](https://github.com/PawanSirsat/Laika/actions/runs/40837709114) | LAI-586: the selected agent owns the claim (D-119); sessions report harness, version, mode |
| [#124](https://github.com/PawanSirsat/Laika/pull/124) | merged | 2026-10-29 05:56 | `LAI-581-agents-tab-rename-settles` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40826243914) | test(web): agents-tab rename waits on the settled row name [LAI-581] |
| [#125](https://github.com/PawanSirsat/Laika/pull/125) | merged | 2026-10-29 07:43 | `LAI-589-polly-belka-identity` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40837288226) | LAI-589: Polly · Belka — task file and log (local config, no code) |
| [#126](https://github.com/PawanSirsat/Laika/pull/126) | merged | 2026-10-29 05:56 | `LAI-569-list-agent-column-1440` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40826250511) | fix(web): the List with the Agent column fits 1440 beside the sidebar [LAI-569] |
| [#127](https://github.com/PawanSirsat/Laika/pull/127) | merged | 2026-10-29 05:56 | `LAI-570-feeds-name-the-agent` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40826256867) | feat(web): Dashboard feed and Organisation → Activity name the agent [LAI-570] |
| [#128](https://github.com/PawanSirsat/Laika/pull/128) | merged | 2026-10-29 05:56 | `LAI-583-agent-label-and-wizard-copy` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40826263549) | fix(web): Agents wizard copy, and two agents on one device are told apart [LAI-583] |
| [#129](https://github.com/PawanSirsat/Laika/pull/129) | merged | 2026-10-29 06:17 | `LAI-587-agent-line` | none | merged into `LAI-586-selected-agent-owns-claim`, landed with its parent | LAI-587: agent line on cards, drawer and History, with Details and D-119 words (stacked on |
| [#130](https://github.com/PawanSirsat/Laika/pull/130) | merged | 2026-10-29 06:16 | `LAI-595-column-reorder-flake` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40828180124) | docs(tasks): file LAI-595, column-reorder keyboard flake on CI [LAI-595] |
| [#131](https://github.com/PawanSirsat/Laika/pull/131) | merged | 2026-10-29 07:07 | `LAI-581-dedupe-task-file` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40833464138) | chore(tasks): drop the stale backlog copy of LAI-581 [LAI-581] |
| [#132](https://github.com/PawanSirsat/Laika/pull/132) | merged | 2026-10-29 10:23 | `LAI-590-devices-server` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/40857157099) | LAI-590: Devices view, server side — agents by device, confirm, revoke a device [depends o |
| [#133](https://github.com/PawanSirsat/Laika/pull/133) | merged | 2026-10-29 17:50 | `LAI-565-agents-tab-shared-components` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40925123045) | LAI-565 · Agents tab uses the shared components/agent/ |
| [#134](https://github.com/PawanSirsat/Laika/pull/134) | merged | 2026-10-29 12:29 | `LAI-597-cards-working-connection-lost` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40873704028) | LAI-597: cards and the drawer say Working and Connection lost from the live claim |
| [#135](https://github.com/PawanSirsat/Laika/pull/135) | merged | 2026-10-29 09:52 | `LAI-591-devices-view` | none | merged into `LAI-590-devices-server`, landed with its parent | LAI-591: Devices view, web half (stacks on #132) |
| [#136](https://github.com/PawanSirsat/Laika/pull/136) | merged | 2026-10-29 10:46 | `LAI-598-build-test-port-race` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40860145061) | LAI-598: build.test.ts asks again on a new port when another process took it |
| [#137](https://github.com/PawanSirsat/Laika/pull/137) | merged | 2026-10-29 09:57 | `LAI-599-my-day-reads-as-settle` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40853679518) | LAI-599: a wheel's settle no longer overwrites a typed length (my-day 1 h 45 min flake) |
| [#138](https://github.com/PawanSirsat/Laika/pull/138) | merged | 2026-10-29 12:29 | `LAI-593-live-claim-session-line` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40873737351) | LAI-593: the live claim carries the session's harness, version and model; the drawer's ses |
| [#139](https://github.com/PawanSirsat/Laika/pull/139) | merged | 2026-10-29 13:17 | `LAI-595-column-reorder-fade-wait` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40880613650) | LAI-595 · column-reorder: wait for the fade, not for two reads agreeing |
| [#140](https://github.com/PawanSirsat/Laika/pull/140) | merged | 2026-10-29 13:46 | `LAI-588-session-helper-harness-model` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40885083723) | LAI-588 · session helper reports harness, version and model; released vs expired |
| [#141](https://github.com/PawanSirsat/Laika/pull/141) | merged | 2026-10-29 23:37 | `LAI-592-cloud-shared-devices` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40974444912) | LAI-592 · cloud agents: short-lived tokens and a stated owner (CORE half) |
| [#142](https://github.com/PawanSirsat/Laika/pull/142) | merged | 2026-10-29 14:39 | `LAI-532-accept-merged` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40893693367) | chore(tasks): accept 104 merged and deployed tasks [LAI-532] |
| [#143](https://github.com/PawanSirsat/Laika/pull/143) | merged | 2026-10-29 22:44 | `LAI-544-phase3-spec` | failure | no run on this merge commit (a later push superseded it) | LAI-544 · SPEC Phase 3: checkpoints, hand-off offers, approvals, policy; D-114–D-116 appro |
| [#144](https://github.com/PawanSirsat/Laika/pull/144) | merged | 2026-10-29 16:12 | `LAI-588-version-boundary-test` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40909362017) | LAI-588 follow-up: version and model length boundary tests |
| [#145](https://github.com/PawanSirsat/Laika/pull/145) | merged | 2026-10-29 18:18 | `LAI-555-context-revisions` | failure | no run on this merge commit (a later push superseded it) | LAI-555: versioned project context — immutable revisions, optimistic write, per-session de |
| [#146](https://github.com/PawanSirsat/Laika/pull/146) | merged | 2026-10-29 18:18 | `LAI-555-web` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40929606734) | LAI-555 web half: context save names its base revision (stacked on #145) |
| [#147](https://github.com/PawanSirsat/Laika/pull/147) | closed | — | `LAI-545-checkpoints` | none | — | LAI-545: checkpoints verified only by signed push deliveries (D-115, D-116, D-116a) |
| [#148](https://github.com/PawanSirsat/Laika/pull/148) | closed | — | `LAI-546-handoff-offers` | none | — | LAI-546: hand-off offers, approvals, acceptance and recovery (server) |
| [#149](https://github.com/PawanSirsat/Laika/pull/149) | merged | 2026-10-29 23:21 | `LAI-592-web` | none | merged into `LAI-592-cloud-shared-devices`, landed with its parent | LAI-320 · web: RegisteredAgent declares owner_display_name (client half of LAI-592) |
| [#150](https://github.com/PawanSirsat/Laika/pull/150) | closed | — | `LAI-549-handoff-ui` | none | — | LAI-549: hand-off dialog, drawer saves and recovery; Phase 3 client mirrors |
| [#151](https://github.com/PawanSirsat/Laika/pull/151) | merged | 2026-10-29 21:44 | `LAI-556-context-history` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40960344769) | LAI-556: context revision history, compare and the stale-save path |
| [#152](https://github.com/PawanSirsat/Laika/pull/152) | merged | 2026-10-29 21:40 | `LAI-1000-docs` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40959840179) | docs: land D-120 (CHIEF ids LAI-1000–1099) and file LAI-1003–LAI-1008 [LAI-1000] |
| [#153](https://github.com/PawanSirsat/Laika/pull/153) | merged | 2026-10-29 22:44 | `integration-phase-3` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/40968092168) | Phase 3 integration: checkpoints + hand-off (#143 #147 #148 #150) |
| [#154](https://github.com/PawanSirsat/Laika/pull/154) | merged | 2026-10-30 09:54 | `LAI-547-checkpoint-helper` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41036812731) | LAI-547: laika agent checkpoint — push then register, safe staging, consent-gated hooks |
| [#155](https://github.com/PawanSirsat/Laika/pull/155) | merged | 2026-10-30 08:00 | `LAI-1001-label-harness-device` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41023531401) | LAI-1001: every agent reads <harness> · <device>; wizard asks harness + device; 409 links  |
| [#156](https://github.com/PawanSirsat/Laika/pull/156) | merged | 2026-10-30 05:31 | `LAI-1009-person-handoff-inbox` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41008891994) | LAI-1009 · A person's hand-off inbox: GET /handoff-offers?view=…, with counts; D-121 recor |
| [#157](https://github.com/PawanSirsat/Laika/pull/157) | merged | 2026-10-30 06:29 | `LAI-550-inbox-handoffs-policy` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41014369962) | LAI-550: Inbox Hand-offs tab and hand-off policy on Access |
| [#158](https://github.com/PawanSirsat/Laika/pull/158) | merged | 2026-10-31 08:46 | `LAI-548-receiver-accept` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41185962218) | LAI-548: laika agent handoff — fetch, verify, worktree, then accept |
| [#159](https://github.com/PawanSirsat/Laika/pull/159) | merged | 2026-10-30 10:55 | `LAI-1005-task-handoff-summary` | failure | no run on this merge commit (a later push superseded it) | LAI-1005: task reads carry a checkpoint and offer summary |
| [#160](https://github.com/PawanSirsat/Laika/pull/160) | merged | 2026-10-30 10:55 | `LAI-1006-card-handoff-states` | success | [failure](https://github.com/PawanSirsat/Laika/actions/runs/41044334514) | LAI-1006: cards show Recovery available and Save needs attention (stacked on #159) |
| [#161](https://github.com/PawanSirsat/Laika/pull/161) | merged | 2026-10-30 11:28 | `LAI-1007-checkpoint-consent-switch` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41048300978) | LAI-1007: owner's Save checkpoints automatically switch on the Agents tab |
| [#162](https://github.com/PawanSirsat/Laika/pull/162) | merged | 2026-10-31 07:11 | `LAI-1003-context-deliveries` | failure | no run on this merge commit (a later push superseded it) | LAI-1003: GET /projects/:slug/context/deliveries — each session's latest delivered context |
| [#163](https://github.com/PawanSirsat/Laika/pull/163) | merged | 2026-10-30 20:22 | `docs-readme-refresh` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41122597170) | docs(readme): bring the README up to date with agent identities and hand-off [ops] |
| [#164](https://github.com/PawanSirsat/Laika/pull/164) | merged | 2026-10-31 07:11 | `LAI-1004-delivered-to` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41179621417) | LAI-1004: context History shows "Delivered to" for each revision (stacked on #162) |
| [#165](https://github.com/PawanSirsat/Laika/pull/165) | merged | 2026-10-31 11:42 | `LAI-553-durable-delivery` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41197978470) | LAI-553: durable delivery states and per-agent hand-off events on SSE [LAI-553] |
| [#166](https://github.com/PawanSirsat/Laika/pull/166) | merged | 2026-10-31 10:36 | `LAI-553-web` | none | merged into `LAI-553-durable-delivery`, landed with its parent | LAI-553-web: name the agent event routes in the web endpoint census [LAI-553] |
| [#167](https://github.com/PawanSirsat/Laika/pull/167) | merged | 2026-10-31 09:03 | `LAI-1011-activity-agent-privacy` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41187093245) | LAI-1011: activity rows name another person's agent only where the task shows it |
| [#168](https://github.com/PawanSirsat/Laika/pull/168) | merged | 2026-10-31 10:13 | `LAI-552-resource-watcher` | success | [success](https://github.com/PawanSirsat/Laika/actions/runs/41191891094) | feat(cli): laika agent watch, the resource watcher [LAI-552] |
| [#169](https://github.com/PawanSirsat/Laika/pull/169) | open | — | `LAI-557-harness-adapters` | success | — | LAI-557: harness adapters for Cursor, Copilot (CLI/VS Code/cloud), Gemini CLI, Antigravity |
| [#170](https://github.com/PawanSirsat/Laika/pull/170) | open | — | `LAI-1012-older-agent-privacy` | success | — | Hand-offs, inboxes, context revisions and checkpoints name another owner's agent only thro |
| [#171](https://github.com/PawanSirsat/Laika/pull/171) | open | — | `LAI-554-event-helper` | failure | — | LAI-554: local event helper — poll + scoped SSE, dedupe, truthful delivery states, bounded |

**Master CI, read plainly.** The current head `1fe55ff1` (#165) deployed
green. Red push runs in the range: `fe49255c` (#111), `a0954e69` (#122),
`b7293a11`, `61be2f2f`, `b12375cf`, `2e473ea4`, `4858ceb9` (#119, #124, #126 –
#128, the 05:56 batch), `52069e4b` (#130), `b5c232ea` (#114), `92997d7a`
(#132), `a5341d97` (#160); `ec39b7b5` (#121) and `1e584e3a` (#123) were
cancelled by the pushes after them. Each red run was followed by a green
push. Why each went
red is not recorded here; LAI-577 – LAI-580 were the flaky-test and deploy-gate
work of the time.

## 5. Acceptance documents, rehearsals and matrices

| Evidence | What it shows |
| --- | --- |
| [`LAI-582-phase-1-2-live.md`](LAI-582-phase-1-2-live.md) | Phases 1 + 2 walked on production, 2026-10-28: 9 deliverables PASS, 1 not delivered at the time (card states, since #134) |
| [`LAI-560-migration-rehearsal.md`](LAI-560-migration-rehearsal.md) | 0061 – 0069 forward on a synthetic 0060 database; restore; pre-programme code on the restored file; legacy token and historical activity working throughout; image-only rollback |
| [`docs/AGENTS-ROLLOUT.md`](../AGENTS-ROLLOUT.md) | Operator guide: migrations, enable order, every default, ruleset, recovery, rollback, retention, limitations |
| `cli/README.md` § *Harness capability matrix* | Session hooks: Claude Code 2.1.280 Verified-and-tested; every Codex cell Documented-not-tested |
| `cli/README.md` § *Capability matrix, checkpoints* | Manual save, push-then-tag, consent Verified-and-tested for Claude Code; hook-driven saves Documented-not-tested; GitHub's notice **Unverified** |
| `cli/README.md` § *Capability matrix, watcher* | macOS readings Verified-and-tested on Belka; Linux Documented-not-tested; real low battery or pressure **Unverified** |
| Proposal § 5 | Harness rows for Cursor, Copilot, Gemini CLI, Antigravity: all Documented-not-tested (LAI-557 unmerged) |
| Task files in `.tasks/review/` and `done/` | Each records its own verification commands and exit codes |

## 6. Not verified

Each item is something the programme claims, or the task files ask for, that
**has not been demonstrated**. None should be read as done.

**Release qualification**

1. **The two-device abrupt-failure experiment** (LAI-551): Belka as device A,
   Strelka as device B, Claude Code to Codex recovery from the exact
   checkpoint SHA, the restarted A refused on REST and MCP. Not run.
2. **The 9-step central demonstration on a release candidate** (LAI-559). Not
   run. This is the "demonstration evidence" LAI-560's criterion asks the
   pack to link, and **it does not exist yet**.
3. **The failure matrix, keyboard-only operation and an automated
   accessibility scan** of every agent screen in light and dark at 390 px and
   desktop (LAI-559). Not run.
4. **One cloud run** (`<harness> · Cloud`) end to end. Not run.

**GitHub, against a real repository** (LAI-545; D-116 *Testing*)

5. Whether GitHub sends a `push` delivery for creating and deleting a
   `laika-ckpt/*` tag (Documented-not-tested).
6. (a) redelivery of a delivery that failed before it was applied;
   (b) re-tagging after the 3-day window; (c) clearing `uncertain` by
   re-tagging; (e) an annotated tag giving `uncertain`; (g) deliveries for one
   ref applied one at a time. Asserted on **signed fixture deliveries** only.
7. (d) one tag per push, and four tags in one push producing no event;
   (f) the ruleset refusing to move or delete a checkpoint tag. **Not tested
   at all.**
8. Checkpoint retention's closed-offer half (LAI-545's unticked criterion).

**Harnesses**

9. **Codex hook certification** (LAI-572): every Codex cell in `cli/README.md`
   is Documented-not-tested; the hooks need the owner to trust them in
   `/hooks`.
10. Claude Code hooks firing the automatic checkpoint from a real `claude`
    process (`PreToolUse` / `PostToolUse` / `Stop` / `SessionEnd`): run with
    documented payloads by tests, not by the harness.
11. Cursor, Copilot, Gemini CLI, Antigravity adapters (LAI-557, #169 open).
12. The watcher on Linux, and on a real low battery or real memory pressure.

**Operations**

13. **A migration rehearsal on a copy of production data**, over SSM per the
    deploy runbook. LAI-560 rehearsed on a synthetic database only. How long
    the four `activity` rebuilds take on production's row count is unknown.
14. A production pre-deploy backup and restore of this release.
15. That revoking an agent's tokens from pre-release code works after an
    image-only rollback (`AGENTS-ROLLOUT.md` § 7).
16. That the `laika-ckpt/**/*` ruleset exists on the Laika repository.

**Gaps found while compiling this pack**

17. The checkpoint pending notice and retention are code constants, not the
    deploy-time variables SPEC §9.1 promises (LAI-1015).
18. The 5-minute "No save in the last 5 minutes" warning is not built
    (LAI-1016).
19. Open work that touches the programme: LAI-554 (#171, gate red), LAI-1012
    (#170), LAI-584, LAI-594, LAI-596, LAI-579 (#118, open since 2026-10-28).
20. The task-file accept step for every child in `review/` (§ 3).

## 7. What would close this pack

LAI-559 and LAI-551 produce the demonstration and the failure matrix; LAI-545's
real-repository criteria are run and recorded on LAIKA-797; LAI-572 certifies
Codex; a production-copy rehearsal follows `AGENTS-ROLLOUT.md` § 2 and § 7.
Then items 1 – 16 above each gain a link, and this document is updated rather
than replaced.
