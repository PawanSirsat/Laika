---
id: LAI-1001
title: 'Every agent label reads <harness> · <device>; the wizard asks harness and device; the 409 links the existing agent'
area: web
assignee: shell
priority: p1
depends-on: [LAI-1000]
discovered-from: LAI-532
status: review
started: 2026-10-29T23:39:06Z
finished: 2026-10-30T00:06:38Z
---

D-120 (owner decision in chat, 2026-10-29). Web half; the server half is
LAI-1000. Board: child of LAIKA-785 (Sprint 10, `phase-2-5`, `host-belka`).

## Goal

Wherever the owner sees an agent it reads *Omnigent · Belka*, *Claude Code ·
Strelka* — never a free-text name — and registering a second agent of one
harness on one device tells them which agent already exists and how to rotate
its credential instead.

## Scope

- One label function, `<harness> · <device>`, used everywhere an agent is
  named: card chip, drawer picker, List agent column and its filter, drawer,
  the session line (`Omnigent · Belka · Claude Code · <model>`), activity /
  History, dashboard, org activity, Agents tab, Devices view.
- The registration wizard asks harness and device, both required; no
  free-text name as a label (it may survive only as an optional private note
  that is never shown as the label). The name sent to the server is derived.
- On `409 agent_exists_for_harness_device`: an inline message naming the existing
  agent, a link to it in the Agents tab and its Rotate action.
- Devices view: one row per harness under each device; a legacy duplicate is
  flagged (two active agents of one harness on that device).
- LAI-583's disambiguation (`twinNames`) stays only as the fallback for legacy
  duplicates.

## Acceptance criteria

- [x] An agent registered as `Polly`, harness `omnigent`, device `Belka`
      reads `Omnigent · Belka` on every surface above
- [x] The wizard has no free-text name field shown as the label; harness and
      device are required
- [x] A `409 agent_exists_for_harness_device` shows an inline message with a link to
      the existing agent and its Rotate action
- [x] Devices view lists one row per harness under each device and flags a
      legacy duplicate
- [x] Two legacy duplicates on one pair stay distinguishable (LAI-583 fallback)
- [x] Both themes, 390 px and desktop, keyboard reachable
- [x] Mutation-checked; touched tests, lint and format exit 0

## Claim note (SHELL, 2026-10-30)

`depends-on: [LAI-1000]` is not in `done/`. Claimed on CHIEF's dispatch: the
server rule LAI-1000 named (`409 agent_exists_for_harness_device`,
`owner_display_name` on agent reads) shipped on `origin/master` with #141
(LAI-592), which this branch is cut from.

## Submission (SHELL, 2026-10-30)

- **Label**: `agentLabel()` in `server/web/src/api/selected-agent.ts` is the
  pair and nothing typed — no device reads *No device*, an unknown harness
  *Other harness*; the device is trimmed. Every surface named in the scope
  already read through it (chip, picker, List column and filter, drawer,
  session line via `agentLine`, History, dashboard and org activity via
  `agentVia`, hand-off dialog via `AgentChip`), so they all follow.
  `AgentChip` reads *Other harness* too.
- **Wizard** (`AgentsTab.tsx`, `agent-wizard.ts`): harness and a required
  device, a live *Shown everywhere as …* line, no name field; the name the
  server still requires is derived, `<slug> on <device>`, so the token's
  first word keeps LAI-736's client match. The owner's own active agent on
  the pair — from the list, or named by the `409` — gets an inline notice
  with *Go to …* (focuses its row) and *Rotate its token* (that row's own
  confirm). *Rename* is shown only on a legacy duplicate, where the name is
  the twin mark.
- **Cloud**: the 24-hour note on step 1, *Token expires* on step 3, an
  `expires_at` inside a day on register and on rotate, and words for both
  `cloud_token_expiry_*` refusals.
- **Devices view**: one row per harness under each device; two active of one
  harness are flagged *Duplicate: 2 active*, told apart by LAI-583's marks,
  each linked to its row.
- **`/design/states`**: the identity step without a name, *that pair is
  taken*, and Cloud.

Evidence: `.polly/evidence/LAI-1001/` (not in git). D-121 named in the
dispatch does not exist on `origin/master`; worked from D-120.


## Round 2 (SHELL, 2026-10-30) — Codex review of #155 at 88381e72

Fixed as new commits:

1. `ContextHistory.tsx`: the chip's mark is `twinNames(agents)`'s, so it shows
   only where two of the reader's agents share a pair; the device is
   `agentDevice`. A single agent reads *Claude Code · Belka*, never *· Polly*.
2. `EvidenceSection.tsx` and `ReviewScreen.tsx` name the finisher through
   `roundAgentName`: `agentLabel(round.agent)`, or *unregistered agent
   (<client word>)* when no registered agent finished.
3. `AgentsTab.tsx`: a Cloud agent whose token expired offers *Rotate token*,
   both on its row and in the wizard's taken-pair notice, which rotates the
   newest unrevoked token with a fresh expiry under a day
   (`rotatableToken`, `agent-wizard.ts`).
4. The harness for an agent's token comes from `agents.harness`. *Rename*
   stays hidden except on legacy duplicates.

Also, from the non-blocking note: `AgentPicker` and `AgentChip` say *Other
harness* through the shared `harnessName`.

**Named crossings (CHIEF-authorised in the review):**
- `server/src/auth/tokens.ts`, `recordMcpUse`: a token linked to a registered
  agent records `agents.harness` as `last_client`. The first-word rule
  applies only to unregistered tokens. Test: `server/test/auth/tokens.test.ts`.
- `server/src/services/rounds.ts`: `RoundView` (and its mirror `Round` in
  `server/web/src/api/review.ts`) gains `agent: { id, harness, device_label }
  | null`, read through the round's token. Test:
  `server/test/http/routes/review.test.ts`.

**Not done here, for CHIEF:** SPEC §6.4's `GET /tasks/:id/rounds` sentence
lists the round's fields and does not yet name `agent`. `docs/` is CHIEF's.

## Round 3 (SHELL, 2026-10-30): Codex round 2 P1 on 7c8f4704

The `rounds.ts` crossing leaked another owner's agent through a round. Now
`RoundView.agent` is the agent only when the reader owns it, or when it is
the task's selected agent or holds its live (`active`/`paused`) claim.
Otherwise it is null, with `by_registered_agent: true`. The UI renders that
as *an agent* and never shows `client_name` in that case. Both
`GET /tasks/:id/rounds` and `GET /review` gate on the reader. Two-owner
tests are in `server/test/http/routes/review.test.ts`.

For CHIEF: `client_name` is unchanged and still carries the finishing token's
name (D-076), which for a registered agent is its display name. The screens
no longer show it for a withheld agent. Whether the API should also withhold
it is a decision this task does not make.
