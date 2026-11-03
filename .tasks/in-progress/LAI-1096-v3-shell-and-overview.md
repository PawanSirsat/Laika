---
id: LAI-1096
title: 'Developer access V3 fidelity, slice A: header, tabs and Overview'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
status: in-progress
started: 2026-11-03T12:11:57+05:30
---

## Why

The owner wants Developer access to match his V3 prototype
(`laika-developer-access-v3.html`): its layout and simplicity, with anything
extra we have behind a click. The audit `.polly/plans/v3-fidelity-gaps.md`
ranks the gaps; §5 slice **A** is this task — gaps #3, #6, #7, #14 and #15.
Slices B, C and D run in parallel and own other files.

## Acceptance criteria

- [ ] **Header (#7).** The page header shows an eyebrow *Developer access*
      above the title *Connect your work to Laika*, with the existing
      subline. `ScreenHeader` takes an `eyebrow?` prop on the page variant
      only. The nav-truth / route tests that pin page title = menu name get
      the narrowest change that keeps the menu name visible (the eyebrow
      carries it) for this page only; the PR says exactly what changed.
- [ ] **Tabs (#6).** Overview · Project setup · Devices · Tools are the four
      tabs; *Advanced* is a secondary link in the tab row and stays routable
      (`?tab=advanced` and every old redirect keep working). At 390px no tab
      is off-screen without a visible cue.
- [ ] **Overview (#3).** The *Needs your attention* note folds into the
      Connection status card (a chip that opens a popover with the same
      facts); the CLI-version notice is gone from the Overview (the update
      guide stays reachable from tool and device details, its text
      unchanged).
- [ ] **Copy (#14).** The setups section is titled *Project setup is the
      main outcome* (*Your repository setups* stays its accessible name);
      the Connection status tools line names tools only.
- [ ] **Rail (#15).** The active step in the `.dx-rail-card` rail is an
      `--accent-bg` fill with no border; Connect's own wizard is unchanged.
- [ ] No new design token and no raw hex; each spot where the prototype
      needs a value without a token is listed in the PR.
- [ ] Every changed behaviour has a test that fails when it is undone.
- [ ] Side-by-side evidence (prototype left, ours right), light and dark,
      1440 and 390, for every changed screen, in `.polly/evidence/LAI-1096/`
      with an `index.html`.

## Notes

- SHELL, `server/web/` only, and only the files the audit's §5 A lists.
  `design.css` is this slice's alone.
- Do not change `UpdateCliGuide`'s text: a concurrent PR
  (fix-old-cli-guidance) is rewriting it.
- Belka: one test file at a time, `--maxWorkers=1`; CI runs the gate.
