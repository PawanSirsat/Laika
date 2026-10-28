---
id: LAI-583
title: 'Agents wizard says the name shows on cards and that the agent''s token is "your token"; two agents on one device share a label'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-582
started: 2026-10-28T21:53:57Z
status: in-progress
---

## Goal

What the Agents wizard tells the owner matches what the board then shows, and
two of the owner's agents can be told apart on a card, in the picker and in
History.

## Acceptance criteria

- [ ] Step 4's badge over the paste block no longer says "carries your token" when the block carries the agent's token (the line above it says "These carry Claude Code · Belka's token, not yours")
- [ ] Step 1's Name hint ("How it is named on cards, history and Capacity") is true, or is reworded to say what is shown; decide which with the owner
- [ ] Two agents with the same harness and device (e.g. two Claude Code agents on Belka) are distinguishable in the drawer picker, the card chip, the List's Agent column and History — or the wizard refuses/flags the clash
- [ ] Both themes, 1440 and 390

## Notes / context

Measured live on production (master `4bb4846c`) in LAI-582, 2026-10-28:

- An agent registered as `Acceptance · test renamed`, harness *No MCP (REST /
  CLI)*, device `Belka`, appears in the drawer picker as **"another agent —
  Pawan Sirsat · Belka"** and in its Agents row subtitle as "another agent ·
  Belka". Its chosen name appears nowhere outside the Agents tab.
- `agentLabel()` in `server/web/src/api/selected-agent.ts` is
  `product · device`, falling back to `display_name` only when there is no
  device — so the name the wizard asks for is not what cards carry.
- Step 4 badge: evidence `05-wizard-step4-instructions-masked-light-1440.png`
  (credential masked) in `.polly/evidence/LAI-582/`.

Not a Phase 1+2 functional failure — every flow worked. It is copy that
misleads, and a label that collides once an owner has two agents of one kind on
one machine.
