---
id: LAI-740
title: 'Connect as a four-step wizard, with the agents’ real logos'
area: web
assignee: chief
priority: p1
depends-on: [LAI-737]
started: 2026-10-12T10:20:00Z
status: in-progress
---

## Goal

The owner, 2026-10-12, **made on the owner's direct instruction**: redesign the
web Connect screen (`server/web/src/routes/screens/connect/`, LAI-733 +
LAI-737) as a step-by-step wizard — a ~280px rail of four steps beside one card
that shows the current step — and draw every agent with its **real brand
mark** instead of LAI-737's two-letter monograms.

**The owner's rule:** take only the layout and visual pattern. The setup
prompts and commands, the agent list, token handling, minting, the minted-token
live check and everything the CLI or server relies on stay exactly as they are.
Behaviour stays identical; tests about content still pass.

## Acceptance criteria

- [ ] Top bar: *Connect* title, one-line subtitle, a *Board* chip with the
      board URL in mono and a Copy button that flips to *Copied*.
- [ ] Two columns: a rail (intro line; four step rows — *Choose your agent ·
      Mint a token · Add Laika to <agent> · Check it connected* — each a
      keyboard-reachable button with a 32px numbered circle, ✓ when done, a
      bold label and an ellipsised state line) and a card that shows one step:
      violet *STEP n OF 4* eyebrow, heavy title, one-line description, and a
      footer with *Back*, a hint, and *Continue →* disabled until it can go.
- [ ] Steps 3 and 4 are locked (50%, not clickable) until a token is minted.
      A reader who brought a token from Tokens can say so on step 2, which
      opens them — so LAI-622's presence watch stays reachable.
- [ ] Step 1: a search (*Search N agents*), the agents grouped under *Terminal
      agents / Editors & IDEs / Desktop apps / Anything else* with a count,
      a 4-column tile grid (34px mark + name, *beta* badge, selected = violet
      border, soft fill, ring, check). An empty search points at *Any MCP
      client* / *No MCP*.
- [ ] Step 2: token name + *Mint a token* on one row, a helper line; after the
      mint a green *Token minted* box with the token in mono and the
      shown-once note.
- [ ] Step 3: *Automatic / By hand* toggle where the agent has both (the
      existing `recommended` / `manual` blocks), grey chips for what the shown
      blocks need, command blocks whose lines wrap (no sideways scroll) under
      a max height, with every line holding the real token highlighted; the
      info note below.
- [ ] Step 4: a status row (grey / amber / green dot with a soft ring, the
      token's name, the state in words, a green *LIVE* pill when connected),
      the existing live check, a collapsible *Nothing after a minute?*, and
      *Open the board* + *Connect another agent* once connected.
- [ ] Real logos for every agent that has one: vendored inline SVG path data,
      no npm dependency, no runtime fetch; source URL and licence per logo in
      code and in `NOTICE.md`; brand colours on a light tile legible in both
      themes; `aria-hidden`. Capacity and the Agents chip use the same
      component, so they change with it.
- [ ] Laika's tokens only, light and dark; at 390px the rail stacks above the
      card and nothing scrolls sideways.
- [ ] Tests for navigation, locking until mint, the token highlight, copy, and
      logos rendering as SVG for every agent with no request leaving the
      origin — each seen red without its feature. Full gate from the repo
      root, each command to its own file with its own exit code.
- [ ] Light and dark screenshots at 1366 and 390 for each of the four steps in
      `/tmp/laika-connect-wizard-shots/`.

## Notes / context

Owner-directed (2026-10-12, direct instruction), built by a sub-agent the
orchestrator dispatched into the temporary worktree `Laika-connect-wizard/`
on `build-connect-wizard`. **Commit locally; do not push, merge or open a PR.**
This file did not exist on any branch when the build started, so it was
created directly in `.tasks/in-progress/` as the claim — the LAI-739
deviation from §2 step 1, recorded here rather than read loosely.

Files this task touches, named one by one (D-033): all under `server/web/`, the
SHELL area —

- `src/routes/screens/connect/ConnectScreen.tsx`, `connect.css`, and the new
  `connect-wizard.ts`
- `src/components/agent-mark/AgentMark.tsx`, `agent-mark.css`, `NOTICE.md`,
  and the new `agent-logos.ts`
- `src/styles/theme.css` and `src/theme/token-list.ts` — three new tokens,
  `--logo-tile`, `--logo-tile-border`, `--logo-ink`
- `test/theme-single-source.test.ts` — one `EXEMPT` entry for
  `agent-logos.ts`
- `test/browser/connect.test.ts`, and the new
  `test/routes/screens/connect/connect-wizard.test.ts` and
  `test/components/agent-mark/agent-logos.test.ts`
