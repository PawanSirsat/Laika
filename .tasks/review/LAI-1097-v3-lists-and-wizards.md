---
id: LAI-1097
title: 'Developer access V3 fidelity, slice C: Devices and Tools lists, both add wizards, chip tones'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
status: review
started: 2026-11-03T12:16:58+05:30
finished: 2026-11-03T12:56:00+05:30
---

## Why

The owner wants Developer access to match his V3 prototype
(`laika-developer-access-v3.html`): its layout and simplicity, with anything
extra we have behind a click. The audit `.polly/plans/v3-fidelity-gaps.md`
ranks the gaps; §5 slice **C** is this task — gaps #1, #2, #4, #5, #8 and
#13. Slices A, B and D run in parallel and own other files.

## Acceptance criteria

- [x] **Add tool, step 1 (#1).** The Automatic and MCP-only tools show as
      the prototype's option tiles, each with a one-line sub, derived from
      the catalog (no hardcoded count). Every other tool sits behind a
      *More tools* disclosure that opens the same tiles. Add tool stays at
      three steps; there is no Authorize step.
- [x] **Add tool, verify (#2).** One status line and a four-line checklist
      (paired, credential installed, the tool's own request, hooks where
      the tool supports them), each line saying what is missing when it is
      not met. The footer is Back plus one primary. The checkpoint consent
      switch is gone from the wizard and stays in Tool details. Nothing
      reads Ready without the server's evidence.
- [x] **Add device, step 3 (#8).** *Approve* is the footer primary; the
      body shows the prototype's four detail tiles; the fingerprint
      comparison stays prominent.
- [x] **Add device, step 1 (#13).** The kind options are the prototype's
      size, the name input is full width, and the helper question is a
      compact control rather than a second pair of large cards.
- [x] **Lists (#4).** A Devices or Tools row shows an update chip only when
      there is something to do (update available, update required, could
      not check). The row itself opens its details, by mouse and keyboard
      and with an accessible name; focus returns to the row when the panel
      closes. There is no separate *Details* button.
- [x] **Chip tones (#5).** *Needs setup* uses the warn tokens, distinct
      from *Connected* and *Ready*. Status words and reasons are unchanged;
      `status-vocabulary.ts` stays the single source and the legend
      follows it.
- [x] No new design token and no raw hex; each spot where the prototype
      needs a value without a token is listed in the PR.
- [x] Every changed behaviour has a test that fails when it is undone.
- [x] Side-by-side evidence (prototype left, ours right), light and dark,
      1440 and 390, for every changed screen and wizard step, in
      `.polly/evidence/LAI-1097/` with an `index.html`.

## Notes

- SHELL, `server/web/` only, and only the files the audit's §5 C lists.
  `design.css` is slice A's; `ToolUpdate.tsx` and `UpdateCliGuide.tsx` are
  slice D's; `components/wizard/*` is frozen; `developer-v3-fixtures.ts`
  takes additions only.
- A concurrent PR (fix-old-cli-guidance) rewrites the *Already have Laika
  installed?* hint in both add wizards. Keep its text if it lands first;
  restyle or relocate around it only.
- Belka: one test file at a time, `--maxWorkers=1`; CI runs the gate.
