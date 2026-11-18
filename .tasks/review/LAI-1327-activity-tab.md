---
id: LAI-1327
title: 'Developer access: Activity becomes its own tab with a live setup checklist; Advanced holds credentials only'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1325
status: review
started: 2026-11-18T07:42:29Z
finished: 2026-11-18T12:10:00Z
---

## Goal

The owner's decision, 2026-11-18. Board card LAIKA-1097. Plan: Part 2 of
`~/.claude/plans/now-you-have-very-validated-perlis.md`.

*Share local activity* sat last on Developer access → Advanced, under 14 credentials (revoked
ones included), and the page never showed the steps to set it up.

The owner chose:
- **Activity becomes its own tab** right after Overview, shown as a step checklist with live
  status.
- **Owners and admins get an inline Developer insights switch.**

**Tabs.** Overview · Activity · Project setup · Devices · Tools · Advanced ›.
- `tab=activity` stays on Activity.
- `tab=advanced&section=activity` goes to Activity.

**The Activity tab.** A header status line, then a live checklist. Steps lock in order, as the
Overview journey does.
1. **The organisation collects** (`GET /me/activity-sharing` → `org_enabled`). Owners and
   admins get an inline switch: the same `PATCH /org {developer_insights}`, gated
   `org.developer_insights.set`. Everyone else is told to ask an owner or admin.
2. **This machine is paired**: a live device. The action is Add device.
3. **A coding tool is connected**: an active tool on a device. The action is Add tool.
4. **Turn it on**: a copy block holding `laika update --board <origin>`, then
   `laika activity on`. It uses this machine's tool connection (LAI-1325), so there is no
   credential to paste.
5. **First data arrives**: the new `last_received_at`, plus `collectors`.

**Below the checklist:**
- the existing scope choice;
- the existing folds;
- a new "It isn't working" fold, mapping each CLI message to its fix.

The classic and preview `ShareActivity` panel stays as it is.

**Overview.** `journeyRows` gains a fourth step, *Share activity*, shown only when the
organisation collects. It links to `?tab=activity`.

**Advanced** holds credentials only:
- revoked and expired credentials are hidden by default, behind *Show N revoked/expired*;
- legacy rows are collapsed into one *Move them to Tools* callout, each with a short *Used by
  …* chip;
- the activity card is removed.

**Server.** `last_received_at` (ms or null) is added to `OwnLocalActivityView`, as
`max(local_activity_days.updated_at)` for the person. It is mirrored on the client and in
`view-type-drift`, and in SPEC §6.4.

Scope: area `web` (`server/web/`), plus the one server field and its SPEC §6.4 line
(CHIEF, 2026-11-18). SPEC §11.4.2 and §11.4.2.1 for Developer access. D-159 and D-160 are
CHIEF's.

## Acceptance criteria

- [x] The tab order is as above. Browser tests cover the checklist's states: org off, owner
      switch, viewer asks, no device, no tool, waiting, received.
- [x] Advanced hides revoked and expired credentials by default and shows the legacy callout.
- [x] `last_received_at` is present on both sides, and `view-type-drift` is green.
- [x] Screenshots at 1440 and 390, in light and dark: Activity off as owner, all done with data
      received, and Advanced.
- [ ] CI is green on the PR. It merges together with LAI-1325 (#376), which goes first.
      *(Builder: #376 merged first, at 19eaa3338, and is in this branch. CI is read on the
      PR after this commit, so this one is CHIEF's to tick from the run.)*

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR. CHIEF merges.
