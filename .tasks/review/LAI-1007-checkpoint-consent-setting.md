---
id: LAI-1007
title: 'Agents tab: the owner gives and withdraws consent to automatic checkpoints for each agent'
area: web
assignee: shell
priority: p2
depends-on: [LAI-545]
discovered-from: LAI-549
status: review
finished: 2026-10-30T16:30:00+02:00
started: 2026-10-30T16:20:00+02:00
---

Web only; the API ships in LAI-545 (#147). Board: child of LAIKA-785 (Sprint
10, `phase-3`, `host-belka`).

## Outcome

An agent's owner can turn automatic checkpoints on or off for that agent in
Settings › Agents, and see whether it is on, when it was given and by whom.
The consent API exists (`GET`/`PUT`/`DELETE
/api/v1/agents/:id/checkpoint-consent`, `agent_checkpoint_consents`, D-115
item 2), but there is no screen for it, so today nobody can give consent
without a raw request (found while building LAI-549).

## Scope

- On each of the owner's agents in the Agents tab (the agent's row or its
  detail, wherever LAI-537/565 put per-agent settings): a labelled toggle,
  **Save my work automatically** (wording to taste, but it must say what it
  allows). Under it, one line of what it means: *after tool activity or at
  the end of a session, without asking each time; saving by hand never
  needs this* (D-115 item 2).
- State from `GET …/checkpoint-consent`: on (given, with `given_at` and who
  gave it) or off (never given, or withdrawn, with `withdrawn_at`).
- Turning on is `PUT`, turning off is `DELETE`. The toggle shows the
  server's answer, not an optimistic guess. A refusal (not the owner, agent
  revoked, signed in by token) is said inline with the server's reason.
- **Only the owner sees the control.** Another person's agent is missing
  (D-121), and an agent's own token never reaches this screen. A revoked
  agent shows its last state read-only.
- Client type for the consent view, paired in
  `response-type-coverage.test.ts` (no new `UNPAIRED` entry).

## Acceptance criteria

- [x] The owner sees each agent's consent state, with when it was given or
      withdrawn
- [x] Turning it on sends `PUT`, off sends `DELETE`, and the control
      reflects the server's response; a refused request shows its reason
      inline and leaves the state unchanged
- [x] A revoked agent's consent is read-only
- [x] The control is a real labelled switch: keyboard operable, state
      announced, both themes, 390 px and desktop
- [x] Mutation-checked; the repo gate (`pnpm test`, `pnpm lint`,
      `pnpm format`) exits 0

## Delivered (SHELL, 2026-10-30)

- Switch on each of the owner's rows in Settings › Agents (the row is the
  agent's detail; there is no separate detail view): *Save checkpoints
  automatically*, with the D-115 sentence under it. `CheckpointConsentSwitch.tsx`,
  rules in `checkpoint-consent.ts`, client `CheckpointConsent` in `api/agents.ts`.
- The wizard's step 5 says automatic saves stay off and links to the switch.
- **Named cross-area edit (D-033):** the single `UNPAIRED` entry
  `CheckpointConsentView` removed from `server/test/tooling/response-type-coverage.test.ts`
  — the pairing this task asks for makes the staleness guard require it.
- The endpoint-coverage exemption for `api/v1/agents/*/checkpoint-consent` is
  gone; `getCheckpointConsent` / `setCheckpointConsent` are the real callers.
- Also, by CHIEF's dispatch: one line in `cli/README.md`'s *Automatic saves*.
