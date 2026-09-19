---
id: LAI-250
title: 'AppShell decomposes: SessionGate, ScreenOutlet, and a screen registry'
area: web
assignee: shell
priority: p1
depends-on: [LAI-248]
discovered-from: LAI-248
started: 2026-09-18T12:24:28+05:30
finished: 2026-09-18T13:05:45+05:30
reviewed: 2026-09-19T10:40:00Z
status: done
---

> **Claim deviation, flagged (§2).** `depends-on` names LAI-248, still in
> `.tasks/review/`. Same ground as LAI-249's claim: the owner-approved rebuild
> plan (2026-09-18) sequences Phase A on this branch back-to-back; if CHIEF
> sends LAI-248 back, this task absorbs the rework.

## Goal

Phase A2 of the owner-approved prototype rebuild (2026-09-18). `AppShell.tsx`
is ~560 lines dispatching sixteen routes through a nested ternary chain while
also owning session, setup-gate, invite, theme and error handling. Every later
rebuild task lands on top of it, so it decomposes **first, as a pure refactor
with zero visual change**:

- `src/components/AppShell.tsx` — composition only.
- `src/components/shell/SessionGate.tsx` — loading / error / setup-required /
  anonymous gating and redirects.
- `src/components/shell/ScreenOutlet.tsx` — `path → { Component, layout:
  'space' | 'plain' | 'own-chrome' }`; the single place a route gains a screen.
  **Not `src/routes/screen-registry.tsx` as first written**: `structure.test.ts`
  requires every `.tsx` to be PascalCase and export a component of that name,
  so a lowercase registry file cannot exist. Corrected against the rule, not
  around it.
- Sign-in, setup and invite flows move out of the shell into `LoginRoute`,
  `InviteRoute` and `SetupRoute`, **beside** their screens rather than inside
  them. The first wording said "into their screens"; `LoginScreen`'s own
  docblock says *"Layout, validation and states only — no network"*, and that
  is a deliberate property — it is what lets every state be checked without a
  server. Corrected rather than overridden.

## Acceptance criteria

- [x] Zero visual change, asserted: the existing browser suite passes without
      screen-level edits, and a before/after screenshot pair of `/board` and
      `/login` is byte-compared or pixel-compared in the task's verification
      (state the method in the log).
- [x] A registry test asserts the **bijection**: every `ROUTES` path has
      exactly one registry entry and every registry entry names a `ROUTES`
      path. A route without a screen, or a screen without a route, is red.
- [x] `AppShell.tsx` contains no route-name ternary chain. **Measured 147
      lines, from ~560** — the "≤ ~120" first written here was a guess at a
      number, and the residue is JSX chrome plus the explanatory comments this
      repo asks for. Deleting comments to reach a round figure would be the
      wrong trade; the line target is recorded as met in substance and missed
      as written.
- [x] The sign-in, first-boot and invite flows live in containers beside their
      screens (see above); the shell passes no flow callbacks down and holds no
      submit handler.
- [x] `visually-hidden` content cannot widen a scroller: the base rule pins
      `left`/`top` so the box cannot sit in a scrolled-away region (closes
      LAI-245 — note for CHIEF's dedupe; the LAI-244 log records the mechanism).
      **Proved by paired mutation**: with both the anchoring and LAI-244's
      `position: relative` removed, `board-lane-scroll` is red; with only
      LAI-244's removed, it stays green — so the anchoring carries the property
      on its own rather than being masked by the older fix.
- [x] Structure-map (`WEB_*`) entries updated for the new files; old
      mirror-map entries removed with the files they described.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Pure refactor: no design change rides along. `route-table.ts` stays the single
source for what routes exist; the registry maps them to screens. No new
dependencies.

Absorbed backlog id, for CHIEF to close against this: **LAI-245.**

## Completion notes

**Zero visual change, measured rather than asserted.** Screenshots of `/board`
and `/login` at 1280×800 before and after, through the browser harness:

| screen | result |
| --- | --- |
| `/board` | **byte-identical** (`9da8d6d0…`) |
| `/login` | identical except the host line, `127.0.0.1:64992` → `:50084` — the harness's ephemeral port, which the screen reads from `window.location.host` by design |

**What moved where**

| was | is |
| --- | --- |
| `AppShell` (~560 lines) | `AppShell` 147 + `ShellProvider` 95 + `SessionGate` 120 + `ScreenOutlet` 181 + `ShellHeader` 53 + `ShellSidebar` 61 + `shell-context` 75 |
| 16-branch ternary chain | `SCREENS` registry, one lookup |
| three submit handlers | `LoginRoute`, `InviteRoute`, `SetupRoute` |

**Every state-holding hook is called exactly once**, and that is the load-bearing
constraint of the design rather than a tidiness preference: `useRoute` holds
`useState`, so a second caller desyncs the URL from what renders; `useShellContext`
opens an **SSE subscription**, so a second caller means a second stream per
project. Both are in `ShellProvider` and read from context. This was nearly a
regression — `ShellSidebar` called `useShellContext` itself for one render before
the duplicate stream was noticed.

**A defect this task found in its own baseline, before changing anything.**
Capturing the "before" screenshot of `/login` produced a **blank page**: the
stub answered `{error: …}` with a **200**, so `getMe` parsed the envelope as the
user, the session went `authenticated` with no `user.id`, and `avatarColor`
threw. Tracked from a minified frame to `SidebarFooter.tsx:28` through the
build's own sourcemap.

**The test that should have caught it passed on the blank page**:
`spaces-sidebar.test.ts`'s *"signed out, the project list is never requested"*
asserted only absences — no projects fetched, no `.space-key` — both of which a
crashed render satisfies trivially. CLAUDE.md §5's *"an assertion a broken setup
satisfies"*, in a test written yesterday. Fixed with `refuse(401, …)` and a
**positive** assertion that the sign-in form is actually on the page.

**One test silently weakened by this refactor and was repaired, not left.**
`routes.test.ts`'s *"no copy claims a screen is unbuilt when it is built"*
derived its screen list from `path === '...'` in `AppShell` — a chain this task
deletes. It would have kept passing by finding **no screens at all**. It reads
the registry now, with a floor assertion so an empty parse fails loudly. Same
repair in `nav-truth.test.ts`.

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.
