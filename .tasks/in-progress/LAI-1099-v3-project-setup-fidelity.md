---
id: LAI-1099
title: 'Project setup matches the V3 prototype: the CLI-version text behind a Help popover, the prompt window reads like a terminal'
area: shell
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-1093
status: in-progress
started: 2026-11-03T13:04:15+05:30
---

## Why

Slice B of the V3 design-fidelity audit (`.polly/plans/v3-fidelity-gaps.md`,
§1 gaps #9 and #10, §2.3, §3). Project setup already has the prototype's
structure; two places still read unlike it:

- **#9, step 3.** A five-line paragraph with five inline code chips about CLI
  versions sits between the check command and the record line. The prototype
  shows a status head and two `.check` rows.
- **#10, step 2.** The prompt is hard-wrapped at about 80 columns and then
  re-wrapped by the narrower window, so lines break twice
  (`` project\n `onroute` ``, `(a\n line`).

Owner's direction: match the prototype's layout and simplicity, extras move
behind a click. Real data only; existing light/dark tokens only.

## Scope

SHELL, `server/web/` only, and only these files:
`src/routes/screens/developer/v3/ProjectSetupTab.tsx`, `project-setup.ts`,
`project-setup-design.css`; tests `test/browser/project-setup.test.ts` and
`test/routes/screens/developer/v3/project-setup.test.ts`.
`components/wizard/Help.tsx` is read, not edited. `design.css` is slice A's,
the update guide files are slice D's.

## Acceptance criteria

- [ ] #9: step 3's CLI-version paragraph is one short line plus a `Help`
      popover; the LAI-1093 hint text is unchanged inside it, and its guide
      placement is kept.
- [ ] #9: step 3's two option cards read as the prototype's `.check` rows,
      each a status plus its action, with no checkboxes.
- [ ] #10: the step-2 prompt window does not re-wrap the prompt's lines; the
      prompt text itself is unchanged (its tests pin it).
- [ ] Every LAI-1084/1090/1091/1093 behaviour is kept: the refused-tool
      *record it yourself* branch, `--harness` on the check command,
      *Checked by laika project check* against *Recorded by you, not
      verified*.
- [ ] Each changed behaviour has a test that fails when the change is undone.
- [ ] Side-by-side pairs (prototype left, ours right) for each step and the
      done state, light and dark, 1440 and 390, in `.polly/evidence/LAI-1099/`
      with an `index.html`.
- [ ] No new token and no raw hex; any token gap names the nearest token used.

## Taken over (Strelka, 2026-11-05)

The owner directed Strelka to take this over and land it with LAI-321:
*"no one is available. Only this device is available right now, so do
everything by yourself."* Belka's claim had expired on 2026-11-03 with only
the claim commit on the branch. The branch was merged into
`LAI-321-developer-access-cleanup` and the work continues there.

`laika-developer-access-v3.html` and `.polly/plans/v3-fidelity-gaps.md` are on
neither this machine nor any git ref. So the gaps are built from this file's
criteria and notes, and the side-by-side evidence is ours alone (light and
dark, 1440 and 390), with no prototype pane.
