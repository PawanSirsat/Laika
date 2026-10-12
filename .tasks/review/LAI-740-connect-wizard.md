---
id: LAI-740
title: 'Connect as a four-step wizard, with the agents’ real logos'
area: web
assignee: chief
priority: p1
depends-on: [LAI-737]
finished: 2026-10-12T11:30:00Z
started: 2026-10-12T10:20:00Z
status: review
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

- [x] Top bar: *Connect* title, one-line subtitle, a *Board* chip with the
      board URL in mono and a Copy button that flips to *Copied*.
- [x] Two columns: a rail (intro line; four step rows — *Choose your agent ·
      Mint a token · Add Laika to <agent> · Check it connected* — each a
      keyboard-reachable button with a 32px numbered circle, ✓ when done, a
      bold label and an ellipsised state line) and a card that shows one step:
      violet *STEP n OF 4* eyebrow, heavy title, one-line description, and a
      footer with *Back*, a hint, and *Continue →* disabled until it can go.
- [x] Steps 3 and 4 are locked (50%, not clickable) until a token is minted.
      A reader who brought a token from Tokens can say so on step 2, which
      opens them — so LAI-622's presence watch stays reachable.
- [x] Step 1: a search (*Search N agents*), the agents grouped under *Terminal
      agents / Editors & IDEs / Desktop apps / Anything else* with a count,
      a 4-column tile grid (34px mark + name, *beta* badge, selected = violet
      border, soft fill, ring, check). An empty search points at *Any MCP
      client* / *No MCP*.
- [x] Step 2: token name + *Mint a token* on one row, a helper line; after the
      mint a green *Token minted* box with the token in mono and the
      shown-once note.
- [x] Step 3: *Automatic / By hand* toggle where the agent has both (the
      existing `recommended` / `manual` blocks), grey chips for what the shown
      blocks need, command blocks whose lines wrap (no sideways scroll) under
      a max height, with every line holding the real token highlighted; the
      info note below.
- [x] Step 4: a status row (grey / amber / green dot with a soft ring, the
      token's name, the state in words, a green *LIVE* pill when connected),
      the existing live check, a collapsible *Nothing after a minute?*, and
      *Open the board* + *Connect another agent* once connected.
- [x] Real logos for every agent that has one: vendored inline SVG path data,
      no npm dependency, no runtime fetch; source URL and licence per logo in
      code and in `NOTICE.md`; brand colours on a light tile legible in both
      themes; `aria-hidden`. Capacity and the Agents chip use the same
      component, so they change with it.
- [x] Laika's tokens only, light and dark; at 390px the rail stacks above the
      card and nothing scrolls sideways.
- [x] Tests for navigation, locking until mint, the token highlight, copy, and
      logos rendering as SVG for every agent with no request leaving the
      origin — each seen red without its feature. Full gate from the repo
      root, each command to its own file with its own exit code.
- [x] Light and dark screenshots at 1366 and 390 for each of the four steps in
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

## Build notes (made on the owner's direct instruction)

**What moved, not what changed.** `ConnectScreen.tsx` keeps its state, the
two-phase `forget()`, `mint()` and the watch effect line for line; only the
render changed. The lead's block, the tool reference and the invite card sit
below the wizard as before. Prose changed only where a step number moved
(*mint one in step 1* → *step 2*, *above* → *in step 2*), the *Secret — copy it
now* heading became *Token minted* with *Copy it now — it is not shown again*
kept in bold beneath, and *Start <agent>* moved into step 4 above the check.
The block badge still reads **carries your token** (the owner's sketch said
*token included*): the step 2 note and an existing content test both name it,
so the wording was left alone.

**Behaviour added by the layout, all in `connect-wizard.ts` (pure, tested):**
grouping (every guide under exactly one heading, asserted from both sides),
search, step locking, the footer hint, the rail's state lines, the
Automatic/By hand modes (`recommended` / `manual` blocks; `alternative` stays
under *Other ways*), requirement chips read from the blocks shown, and
`commandRuns`, which cuts a block's text so every line holding the real token
can be `<mark>`ed **without changing a character** — what is shown, selected
and copied stay identical. The Claude Code prompt carries the token on three
lines (Token:, the installer's stdin, the `curl`), so three are marked.

**The brought-token path.** Locking steps 3–4 until a mint would have made the
presence watch (*Watch for my session*, for a token brought from Tokens)
unreachable. Step 2 offers *Use a token I already have*, which opens them;
the blocks then show the placeholder with Copy disabled, exactly the old
pre-mint page.

**Logos.** `agent-logos.ts` holds path data for 20 of the 21 client slugs;
`other` (*another agent*, also used by *Any MCP client* and *No MCP*) keeps its
monogram. Sources, in the owner's order: LobeHub Icons (MIT) for 16; Simple
Icons (CC0) for Zed and Warp; vendor assets for VS Code (Microsoft's brand
kit) and Continue (its repo); Omnigent from its site's favicon. Full table with
URLs and terms in `NOTICE.md`; `agent-logos.test.ts` checks NOTICE.md against
the module from both sides. Removed in cleaning: VS Code's drop-shadow filters
and blend overlay, Continue's full-frame clip path. Ids are prefixed per
instance with `useId`. The marks sit on a new `--logo-tile` (light in both
themes) and single-colour marks draw in `--logo-ink`; brand hex values live in
`agent-logos.ts`, now the second `EXEMPT` entry in
`theme-single-source.test.ts`. **This reverses LAI-737's monogram decision,
whose trademark research is kept in `NOTICE.md`** — several owners
(Anthropic, OpenAI, Google, Microsoft) say their marks need permission. The
owner chose to ship them; the reviewer should know that is on record.

**Tests adjusted because the layout moved things (content assertions kept):**
in `test/browser/connect.test.ts` every test now reaches its step through the
rail first (`goTo`, `mint`, `bring` helpers). Rewritten: *More reveals the
rest* → *every agent is a radio of the one group, and search narrows it*;
*the chosen agent stays in view when More is collapsed* → *a search that hides
the chosen agent does not change the choice*; *minting ticks step 1 and moves
"up next" to step 2* → *minting ticks the mint step, and hiding the token does
not un-tick it*; *every copy button names what it copies* visits each step;
*after a mint, the token appears only in blocks that say they carry it* walks
both modes and *Other ways*. Placeholder tests reach step 3 via the
brought-token path.

**New tests, each seen red with its feature removed** (mutation harness,
anchors checked, files restored and checksummed): lock (`stepOpen` always
true), highlight (`commandRuns` never marks), logos (`agentLogo` →
`undefined`), copied (rail never told), focus (no move to the title), wrap
(`white-space: pre`), search (`matchesAgent` always true), live pill — each
`# pass 0 / # fail 1` on its filtered browser run, plus the unit suites.

Screenshots: `/tmp/laika-connect-wizard-shots/step{1..4}-{light,dark}-{1366,390}.png`.

**Found by the gate, fixed before hand-back.** *Connect another agent* read
the step-3 lock one render early under load: `forget()` drops the blanked
token on a `setTimeout`, so the lock returns a tick later. The product settles
correctly; the test now waits for the lock instead of sampling it.
