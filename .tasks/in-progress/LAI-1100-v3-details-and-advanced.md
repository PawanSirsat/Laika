---
id: LAI-1100
title: 'Developer access V3 fidelity, slice D: Tool and Device details, Advanced'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
status: in-progress
started: 2026-11-03T13:12:09+05:30
---

## Why

The owner wants Developer access to match his V3 prototype
(`laika-developer-access-v3.html`): its layout and simplicity, with anything
extra we have one click away. The audit `.polly/plans/v3-fidelity-gaps.md`
ranks the gaps; §5 slice **D** is this task: gaps #11 and #12 and the §3
placements that land in the detail panels. Slices A (LAI-1096), B (LAI-1099)
and C (LAI-1097) run in parallel and own other files.

## Acceptance criteria

- [ ] **Tool details (#12).** The top of the panel is short: the status and
      the one next action. Every other section (helper and its update status,
      projects, credential with Reconnect, automatic checkpoints, the
      verification evidence) is a one-line summary row that expands. The
      danger action stays at the foot.
- [ ] **Device details.** The same shape: status and the one next action on
      top, the rest in collapsible sections. Duplicate resolution and the
      imported-device confirmation stay here and are visible when they need
      action.
- [ ] **Checkpoint consent.** Tool details carries the consent switch for
      every tool that supports checkpoints (slice C removes it from Add
      tool), and its section summary names the current state.
- [ ] **Advanced (#11).** No card is nested in a card. There are two
      sections, personal tokens and activity sharing. The normal `full`
      scope chip is not red. The 90-day default expiry, the *Personal
      (legacy)* labels, *Upgrade connection*, one-time secret handling and
      revoke under ⋯ with a confirmation are kept.
- [ ] Real data only. No new design token and no raw hex; each spot where
      the prototype needs a value without a token is listed in the PR.
- [ ] Every changed behaviour has a test that fails when it is undone.
- [ ] Side-by-side evidence (prototype left, ours right) for Tool details,
      Device details and Advanced, light and dark, 1440 and 390, in
      `.polly/evidence/LAI-1100/` with an `index.html`.

## Notes

- **The id is past D-120's range.** CHIEF's `LAI-1000` – `LAI-1099` block is
  full (every id is a file on some branch; `LAI-1042` is the V3 plan). The
  polly manager chose `LAI-1100` on 2026-11-03; `get_task_context LAI-1100`
  answered `not_found`. A decision should record the next block.
- SHELL, `server/web/` only, and only §5 D's files: `DeviceDetails.tsx`,
  `ToolDetails.tsx`, `ToolUpdate.tsx`, `UpdateCliGuide.tsx`, `update-cli.css`,
  `update-status.css`, `AdvancedTab.tsx`, `advanced.ts`, `v3.css`, and
  `../CheckpointConsentSwitch.tsx` if a compact variant is needed. Tests:
  `developer-update-status.test.ts`, `developer-advanced.test.ts`,
  `checkpoint-consent.test.ts`, `developer-insights.test.ts`.
- Slice A (PR #249) removed the Overview CLI notice. If it has merged when
  this finishes, the now-unused `cliNotice`/`cliNoticeText` in
  `update-cli.ts` and `place="overview"` in `UpdateCliGuide` go, and
  `developer-update-cli.test.ts` stays true.
- `design.css` is slice A's; `components/wizard/*` and `SidePanel.tsx` are
  frozen; `developer-v3-fixtures.ts` takes additions only.
- Belka: one test file at a time, `--maxWorkers=1`; CI runs the gate.
