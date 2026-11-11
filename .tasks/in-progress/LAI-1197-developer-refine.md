---
id: LAI-1197
title: Refine Developer access (/developer) — v3 Overview, Project setup, Devices, Tools, Advanced
area: shell
assignee: shell
priority: p2
depends-on: []
status: in-progress
started: 2026-11-11T10:30:00+02:00
---

# LAI-1197 — Refine Developer access (v3)

Polly-dispatched builder, branch `LAI-1197-developer-refine` off
`origin/integration-ui-transformation` @ `8e6a2249`. Web only
(`server/web/`). UI only, existing public API, no new dependency, no demo
data, permissions stay server-authoritative. `theme.css` is not edited; the
classic layout code is not deleted (v3 imports parts of it).

Refines the default (v3) layout against the 17-state interaction contract
(`.polly/proposal/interaction-inventory.md`), keeping out of the regions open
PRs touch: #280 (Advanced load error, Tools empty states), #287 (Reconnect /
Disconnect reason text in Tool and Device details), #318 (shared Tabs).

## Acceptance criteria

- [ ] Overview: a re-read that fails after the page has loaded keeps what was
      shown and says so in place, with **Retry**, instead of replacing the page
      with an error. The first load still shows the full error with Retry.
- [ ] Devices and Tools: a re-read that fails after a list was shown keeps the
      list, with an in-place notice and **Retry**; the first load still shows
      the full error.
- [ ] Consequential actions say what happened on screen, not only to a screen
      reader: disconnecting a device, disconnecting a tool, confirming a device
      and revoking a personal credential each leave a visible, dismissible
      result note (`role="status"`), and the confirmations they already ask
      are kept.
- [ ] One-time secrets (a new personal credential, a tool's new credential):
      shown once with Copy, dismissed by **I've saved it**, after which a note
      says it cannot be shown again; leaving or reloading the page while a
      personal credential's secret is on screen asks the browser's warning.
- [ ] Theme tokens only, both themes, 390 / 768 / 1440, reduced motion
      respected by anything new that moves.
- [ ] Browser tests: revoke confirm + feedback, secret shown-once flow,
      Project setup wizard error recovery, Retry keeping last data; each
      mutated once to prove it fails.
- [ ] Gates: `pnpm lint`, `pnpm format`, `server/web` typecheck, the new test
      file and the existing `developer-*` / `devices-tab` browser tests, each
      run in the foreground to its own file with its own exit code.
