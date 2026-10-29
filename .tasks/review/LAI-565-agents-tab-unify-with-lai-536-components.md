---
id: LAI-565
title: 'Agents tab: use LAI-536''s AgentChip, AgentReadiness and RegistrationSteps once both have landed'
area: web
assignee: strelka
priority: p2
depends-on: [LAI-536, LAI-537]
discovered-from: LAI-537
status: review
started: 2026-10-29T07:25:47Z
finished: 2026-10-29T07:35:41Z
---

Filed by SHELL (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Why

LAI-537 (Developer access → Agents) was built on LAI-534's branch, where
LAI-536's reviewable agent components (`server/web/src/components/agent/`:
`AgentChip`, `AgentReadiness`, `RegistrationSteps`, PR #101) do not exist. So
LAI-537 drew its own minimal versions inside
`server/web/src/routes/screens/developer/AgentsTab.tsx` — the step rail, the
state pill (`agents-state`) and the harness/device line — rather than copy
LAI-536's files across branches.

## Scope

- Once LAI-536 and LAI-537 are both on `master`, replace those three pieces
  with LAI-536's components, keeping LAI-537's behaviour and tests
  (`test/browser/agents-tab.test.ts`) green.
- Nothing server-side.

## Acceptance criteria

- [x] The Agents tab renders the agent chip, readiness and step rail through
      `components/agent/`, and its own copies are gone.
- [x] `agents-tab.test.ts` and LAI-536's tests are green unchanged in intent.
- [x] Both themes and 390 px still work.
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Build notes (Strelka, LAI-565)

- Rail: the wizard's own clickable rail is gone; `RegistrationSteps` is not a
  control, so moving between steps is Back and Continue only. Every step the
  rail could open is reachable that way; the rail's direct jump from step 1 to
  3 (which skipped step 1's validation) is not.
- Step 5's title now reads *Verify a request from this agent*, LAI-536's name,
  where it said *Verify this agent* — the title and the rail read one list.
- Revoked agents have no `AgentReadiness` (none of its three facts can hold);
  the row says *Revoked — its credentials no longer work.* in words instead.
- `AGENT_STEP_NAMES` and `AGENT_STATE_LABELS` were deleted with their tests;
  `agent-readiness.ts` (new, tested) maps an agent to the three facts.
- Filed LAI-318: *No token yet.* reads wrong for an agent whose tokens expired.

## Review round 1 (Strelka, 2026-10-29) — Belka's Codex review at 099e75e5

Criteria are frozen and unchanged; this records what changed.

- **Blocking, fixed:** `agent-readiness.ts` sent every expired- or
  revoked-token agent to an empty set, so an agent Laika had seen read both
  *No token yet* and *has not seen a request*. Now *connected* comes from
  `last_seen_at` alone, whatever the credential does, and the row also says
  whether a credential existed and lapsed (`credentialLapsed`).
  `AgentReadiness` takes that as an optional prop and reads *Credential
  created — none live* with `CREDENTIAL_LAPSED` from `agent-states.ts`; an
  agent never given a token still reads *not yet* / *No token yet.* No new
  design tokens.
- Tests: `agent-readiness.test.ts`'s old *no credential, even once seen* case
  is corrected (seen stays connected, and it is lapsed), with new cases for
  never-issued and rotated agents. `agents-tab.test.ts` adds a rendered case: a
  seen agent with an expired token shows *none live* and neither *No token
  yet* nor *has not seen a request*. Mutation-checked: four mutations, each
  red.
- **This covers LAI-318**, which stays in `backlog/` with a note saying so.
- Merge of `origin/master`: master's `DevicesSection` (LAI-591) still draws
  the state pill, so `AGENT_STATE_LABELS`, its test and the `.agents-state`
  rules are restored as master has them. The Build notes above say they were
  deleted; that no longer holds. The Agents tab itself still draws no pill.
