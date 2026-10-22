---
id: LAI-863
title: Fleet dispatch — any machine with capacity can take a card (parent, ON HOLD)
area: docs
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

> **ON HOLD — waiting on the owner.** This is the parent of the fleet-dispatch
> work. Nobody claims it, and no children are filed, until Pawan has answered
> the open questions in §6 of the proposal and approved it. After approval CHIEF
> writes the decision and files one child task for each phase.

## Goal

Laika knows which execution resources exist, meaning the owner's laptops
(Belka, Strelka), cloud runners and teammates' laptops. It shows which ones are
online and what each one can run, from a command and in the UI. It can send a
card to one of them in two ways:

- **Manually**: only when a human says "run on X".
- **On autopilot**: opt-in per project and per machine. Laika places the card
  on an eligible machine that has free capacity.

Either way the work ends in Review with a PR, never in Done.

The full research and design is in
`docs/proposals/LAI-863-fleet-dispatch.md`.

## Acceptance criteria

- [ ] The owner has approved the proposal, or amended it, and answered its §6
      open questions. The answers are recorded on the LAI-863 card.
- [ ] `docs/DECISIONS.md` has a decision entry for fleet dispatch, written by
      Belka/CHIEF.
- [ ] One child task is filed for each phase in proposal §5, each with the
      correct `area:`, `depends-on`, and `discovered-from: LAI-863`.
      Three-owner activity-verb work is filed as one co-ordinated set (§4.4).

## Notes / context

- Research was done by Codex sub-agents on 2026-10-21. It covered three
  questions: what Laika's surface supports today, prior art for runner fleets,
  and Omnigent's host/runner API.
- Key facts the children must respect:
  - D-005 freezes the heartbeat payload.
  - `assignee_id` means the responsible person, not the machine running the
    work.
  - D-097's `host:` tag is rejected by the tag grammar.
  - WebSockets are a v1 non-goal.
  - Every new `ACTIVITY_TYPES` verb needs three owners.
