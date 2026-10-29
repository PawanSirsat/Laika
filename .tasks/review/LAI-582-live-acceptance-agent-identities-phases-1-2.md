---
id: LAI-582
title: 'Live acceptance of agent identities Phases 1+2'
area: chief
assignee: chief
priority: p0
parent: LAIKA-785
depends-on: []
discovered-from: LAI-532
status: review
started: 2026-10-28T19:18:41Z
finished: 2026-10-28T20:06:51Z
---

## Goal

The owner sees every Phase 1+2 deliverable of *Agent identities and safe task
hand-off* (LAI-532, board LAIKA-785) working on **production**, with real
APIs and a real browser, and has a plain-language walkthrough to try each one
themselves. Real agents are registered for Belka's own workers along the way.

## Acceptance criteria

- [x] Two agents owned by Pawan registered through the live UI — `Claude Code · Belka` and `Codex · Belka`, project `laika` only, full — each credential stored only via `laika agent login`, each wizard Verify completed with that agent's own token, and Pawan's own token shown not to complete it
- [x] A throwaway `Acceptance · test` agent registered for the destructive checks and revoked at the end
- [x] Every Phase 1+2 deliverable (rows 1–10 of the brief) recorded PASS / FAIL / NOT-TESTABLE / NOT-DELIVERED with evidence, against one sandbox card only
- [x] Screenshots in `.polly/evidence/LAI-582/` (gitignored), light + dark at 1440 and 390 where there is UI, one-time secrets blurred or omitted
- [x] `docs/acceptance/LAI-582-phase-1-2-live.md`: for each deliverable, what you can do now, how to try it in 3 clicks, result, evidence file names
- [x] Every real FAIL filed as its own task and card, discovered-from LAI-582; no code fixed here
- [x] The config change that would make future sub-agents act as these agents is reported, not applied

## Notes / context

Production is `LAIKA_URL` in `~/.laika/env`, running master `4bb4846c`. No token
value is printed, logged, screenshotted or committed (D-114). Claim expiry is
waited out at the production default; no server setting is changed. Docs only:
the PR touches `docs/acceptance/` and this task file.

## Result

Walked 2026-10-28 19:20–20:05 UTC on production `4bb4846c`. Rows 1–9
**PASS**; row 10 (*Working*, *Connection lost*) **NOT-DELIVERED** — LAI-568,
PR #112, still draft. No Phase 1+2 deliverable failed. Walkthrough:
`docs/acceptance/LAI-582-phase-1-2-live.md`.

Filed (discovered-from LAI-582): **LAI-583** (web, LAIKA-837) — wizard copy says
the agent's token is "your token" and that the chosen name shows on cards;
two agents on one device share a label. **LAI-584** (server, LAIKA-838) — Inbox
› Review lists only the oldest 200, so a just-finished task cannot be accepted
from the queue.

Sandbox LAIKA-836 ends Done (accepted by Pawan in the browser), agent withdrawn.
Throwaway agent revoked. Claude Code · Belka and Codex · Belka stay registered;
no harness config was changed.
