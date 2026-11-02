---
id: LAI-1079
title: 'Developer access design: Overview — next step, setup journey, connection status, repository setups'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1077, LAI-1078]
discovered-from: LAI-1075
status: in-progress
started: 2026-11-02T11:06:32+05:30
---

## Why

The owner's V3 design's Overview (plan
`~/.claude/plans/we-have-match-this-lovely-torvalds.md` §Overview). Today's
Overview is a stats card and a prose card.

## Acceptance criteria

- [ ] Hero "Your next step", one state each from real data: no device; device
      with no tool; tool registered never seen; connected with no setup; all
      done. Attention (tools not connected, update required) as a note block.
- [ ] "Your setup journey": three flow rows (done / active / pending), real
      one-line subs, Manage / Start / Open, chip "n of 3 complete".
- [ ] Connection status: devices, tools, repositories set up — counts, names,
      chips.
- [ ] "Access ≠ repository setup" card replaces "How this works", with a link
      to Advanced for scripts and the API.
- [ ] Your repository setups: "Set up a new repository →", then one row per
      recorded setup with its chip (Checked / Recorded by you).
- [ ] Numbers agree with Devices and Tools (same reads). Live region kept.
- [ ] Tests: each hero state, counts, links; both themes; 390px.

## Notes

- SHELL, `server/web/` only. PR into `integration-dev-access-design`.
