---
id: LAI-582
title: 'Live acceptance of agent identities Phases 1+2'
area: chief
assignee: chief
priority: p0
parent: LAIKA-785
depends-on: []
discovered-from: LAI-532
status: in-progress
started: 2026-10-28T19:18:41Z
---

## Goal

The owner sees every Phase 1+2 deliverable of *Agent identities and safe task
hand-off* (LAI-532, board LAIKA-785) working on **production**, with real
APIs and a real browser, and has a plain-language walkthrough to try each one
themselves. Real agents are registered for Belka's own workers along the way.

## Acceptance criteria

- [ ] Two agents owned by Pawan registered through the live UI — `Claude Code · Belka` and `Codex · Belka`, project `laika` only, full — each credential stored only via `laika agent login`, each wizard Verify completed with that agent's own token, and Pawan's own token shown not to complete it
- [ ] A throwaway `Acceptance · test` agent registered for the destructive checks and revoked at the end
- [ ] Every Phase 1+2 deliverable (rows 1–10 of the brief) recorded PASS / FAIL / NOT-TESTABLE / NOT-DELIVERED with evidence, against one sandbox card only
- [ ] Screenshots in `.polly/evidence/LAI-582/` (gitignored), light + dark at 1440 and 390 where there is UI, one-time secrets blurred or omitted
- [ ] `docs/acceptance/LAI-582-phase-1-2-live.md`: for each deliverable, what you can do now, how to try it in 3 clicks, result, evidence file names
- [ ] Every real FAIL filed as its own task and card, discovered-from LAI-582; no code fixed here
- [ ] The config change that would make future sub-agents act as these agents is reported, not applied

## Notes / context

Production is `LAIKA_URL` in `~/.laika/env`, running master `4bb4846c`. No token
value is printed, logged, screenshotted or committed (D-114). Claim expiry is
waited out at the production default; no server setting is changed. Docs only:
the PR touches `docs/acceptance/` and this task file.
