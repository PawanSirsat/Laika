---
id: LAI-961
title: 'A project''s visibility can only be chosen at creation: no public/private switch afterwards'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T13:30:40Z
finished: 2026-10-22T14:07:37Z
---

## Acceptance criteria

- [x] Project settings gain a **Visibility** control (Private — invited
      members only / Public — anyone in the org can join) for whoever holds
      `project.settings.edit`, calling the existing
      `PATCH /api/v1/projects/:slug {visibility}`; read-only for others.
- [x] Confirm before making a project public; the change is reflected on
      Projects at once.
- [x] Light/dark, 1440/390, browser test. Gate exit 0.

## Builder notes (SHELL, 2026-10-22)

- **Where.** "Project settings" is the board's View settings panel: Hide done
  is its only project-wide setting and the only place `board_hide_done_days`
  is edited. Visibility sits beside it as a radio pair, behind the same
  `canConfigureProject` (`project.settings.edit`) gate. Without the gate it
  shows the current label and *"Only a project lead can change this."*
- **Confirm.** Choosing Public opens an inline confirmation in the panel
  (`Make public` / `Cancel`). It is not `window.confirm` because the panel
  closes on blur. Nothing is sent until `Make public`. Choosing Private sends
  at once.
- **"Reflected on Projects at once".** The board keeps the PATCH response as
  its project. Projects reads `GET /projects` every time it mounts. The test
  uses a stateful stub, navigates in-app (popstate, not a reload) and reads
  `PUBLIC` on the card chip.
- **Labels.** The two labels are now `VISIBILITY_OPTIONS` in
  `api/projects.ts`. The create form and the panel both use it.
- **Beyond the visibility control.** At 390px, View settings opened at
  x = -296 (measured): it was positioned from the trigger's right offset with
  no clamp. Phone width is a criterion here, so `view-settings.css` now clamps
  `right`, and the panel is `border-box` at its existing 350px. The board's
  `⋯` menu is positioned the same way and is not fixed here: filed as
  **LAI-966**.
- **Gate** (repo root, final tree): `pnpm test` exit 0, `pnpm lint` exit 0,
  `pnpm format` exit 0. The first full run after the last edit exited 1 on
  `timeline-derive.test.ts` › *"the widest drawable window steps by month and
  week, not by day"* (`the header took 694.2 ms`). That is a wall-clock budget
  under suite load, in a file this task does not touch. Run alone it passed
  (29/29). The whole gate was then re-run and exited 0.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #56.
