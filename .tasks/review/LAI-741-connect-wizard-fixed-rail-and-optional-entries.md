---
id: LAI-741
title: 'Connect wizard: a fixed rail, the optional sections folded in, and the LAI-740 review follow-ups'
area: web
assignee: chief
priority: p1
depends-on: [LAI-740]
discovered-from: LAI-740
finished: 2026-10-12T12:18:52Z
started: 2026-10-12T12:10:04Z
status: review
---

## Goal

The owner, 2026-10-12, **made on the owner's direct instruction**: a follow-up
to LAI-740 (the Connect wizard, now live), in
`server/web/src/routes/screens/connect/` (`ConnectScreen.tsx`, `connect.css`,
`connect-wizard.ts`) and their tests.

**The owner's rule, unchanged from LAI-740:** the setup-content wording, the
agent list, token handling, minting and the live check stay exactly as they
are. The text of the three folded-in sections is unchanged too.

## Acceptance criteria

- [x] **A. Fixed rail.** On desktop the page does not scroll: the top bar and
      the step rail stay put and the right card is the scroll container — its
      eyebrow and title scroll with the content, its *Back / Continue* footer
      stays pinned at the bottom of the card. The screen fits the viewport
      under the app shell with no double scrollbars, at 1366×768 and
      1920×1080, sidebar open. At 390px the rail stacks above the card and the
      page scrolls normally.
- [x] **B. Nothing outside the rail and the card.** *For the project lead*,
      *What an agent can do here* and *Invite a teammate* move into the rail as
      a separate *Optional* group under the four steps — *Share with your
      project*, *What agents can do*, *Invite a teammate* — same row style with
      an icon instead of a number, never locked, never counted in *STEP n OF
      4*. Each opens its content in the card (eyebrow *Optional*), whose footer
      offers *Back to steps* to the step the reader was on. Step 4, once
      connected, offers *Share with your project* as a next action.
- [x] **C1.** *Use a token I already have* moves focus to *Continue* rather
      than dropping it to `body`.
- [x] **C2.** The minted-token box is an alert only on the mint, not on every
      return to step 2.
- [x] **C3.** *Command copied* on the rail is set only when a main block's copy
      actually succeeded — not by a failed clipboard, not by *Other ways*.
- [x] **C4.** Where an agent has both paths, a line under the automatic block —
      *Prefer to do it by hand? Switch to By hand* — flips the toggle.
- [x] **C5.** A note that introduces a block sits above it again, as before
      LAI-740; follow-up notes stay below.
- [x] **C6.** Wrapped shell lines keep wrapping with a hanging indent, and the
      copied text is byte-identical.
- [x] **C7.** `connect.test.ts` compares the rendered prompt to the setup
      block's exact text; `agent-logos.test.ts` compares the NOTICE.md slugs to
      the logos as sets, not counts.
- [x] Each new browser test shown red without its change. Full gate from the
      repo root — `pnpm test`, `pnpm lint`, `pnpm format` — each exits 0.
- [x] Screenshots, light and dark, at 1366×768 and 390, in
      `/tmp/laika-connect-wizard-2-shots/`.

## Notes for the reviewer

Built in the temporary worktree `Laika-connect-wizard-2/` on
`build-connect-wizard-2` (from `origin/master` ed8738d). Committed locally; not
pushed, not merged, no PR — by instruction.

**Red without its change**, each an anchor-checked mutation of the committed
source, restored from `HEAD` afterwards (`/tmp/lw2-mutate.sh`):

| change removed | tests that went red |
| --- | --- |
| A — `.connect { height: 100% }` | the desktop scroll test; the light/dark 1366×768 fit |
| B — `extrasFor()` returns nothing | the entries open / Back to steps; no Invite for a member; step 4's Share |
| B — the whole pre-LAI-741 source | nothing outside the rail and the card |
| C1 — the focus to *Continue* | C1 |
| C2 — a standing `role="alert"` | C2 |
| C3 — the old click-capture | both C3 tests |
| C4 — the *Switch to By hand* line | C4 |
| C5 — `noteAbove()` always false | C5 |
| C6 — the `text-indent` | C6 |
| C7 — NOTICE.md lists `cursor` twice, `codex` never | the set comparison (the old count passed it) |

**Not done as a separate assertion:** the 1920×1080 case runs the same
no-document-scroll checks, but the card does not overflow there on step 1, so
the *rail does not move while the card scrolls* half is asserted at 1366×768
only.

**Outside the named files:** none. *Command copied* listens to the copy
button's own `data-outcome` with a `MutationObserver` rather than adding an
`onCopied` prop to the shared `CopyButton` — the prop would be cleaner, but
`components/` was not in this task's scope.
